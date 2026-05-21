import { useState, useEffect, useCallback, useRef } from "react"
import { Plus, FileText, RefreshCw, BookOpen, Trash2, Folder, ChevronRight, ChevronDown, FolderPlus, Pencil, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import { useWikiStore } from "@/stores/wiki-store"
import { useOrgStore } from "@/stores/org-store"
import { listDirectory, readFile, writeFile, deleteFile, findRelatedWikiPages, preprocessFile, uploadFiles, createDirectory, moveFile, renameFile } from "@/commands/fs"
import { openFilePreview, httpGet } from "@/api/dotnet-client"
import type { FileNode } from "@/types/wiki"
import { enqueueIngest } from "@/lib/ingest-queue"
import { useTranslation } from "react-i18next"
import { normalizePath } from "@/lib/path-utils"
import { parseSources, writeSources } from "@/lib/sources-merge"
import { decidePageFate } from "@/lib/source-delete-decision"
import { removeFromIngestCache } from "@/lib/ingest-cache"
import {
  collectAllFilesIncludingDot,
  decideDeleteClick,
} from "@/lib/sources-tree-delete"


export function SourcesView() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setFileContent = useWikiStore((s) => s.setFileContent)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const [sources, setSources] = useState<FileNode[]>([])
  const [importing, setImporting] = useState(false)
  const [ingestingPath, setIngestingPath] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  /**
   * Path of the source-tree node currently in "click again to
   * confirm delete" state. Lifted up here (rather than living
   * inside SourceTree) for two reasons:
   *   1. Only one button can be armed at a time across the whole
   *      tree — clicking another delete disarms the prior one.
   *      Lifting state to the common ancestor makes that natural.
   *   2. The auto-disarm timer (5s) needs to survive across re-
   *      renders triggered by tree mutation; useEffect cleanup
   *      anchored here is the right scope.
   */
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null)

  // 已写入 Wiki 的文件名集合（从 API 加载）
  const activeDeptId = useOrgStore(s => s.activeDeptId)
  const [ingestedFiles, setIngestedFiles] = useState<Set<string>>(new Set())
  const [inProgressFiles, setInProgressFiles] = useState<Set<string>>(new Set())
  // 等待二次确认的 re-ingest 节点
  const [reingestConfirmNode, setReingestConfirmNode] = useState<FileNode | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const newFolderInputRef = useRef<HTMLInputElement>(null)

  // Auto-disarm: 5 seconds without a second click resets the
  // pending state. Prevents a stale armed button from firing if
  // the user walked away and came back. Cleared whenever the
  // pending path changes (so a fresh arm restarts the clock).
  useEffect(() => {
    if (!pendingDeletePath) return
    const t = setTimeout(() => setPendingDeletePath(null), 5000)
    return () => clearTimeout(t)
  }, [pendingDeletePath])

  const loadSources = useCallback(async () => {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      const tree = await listDirectory(`${pp}/raw/sources`)
      const filtered = filterTree(tree)
      setSources(filtered)
    } catch {
      setSources([])
    }
    // 从数据库加载已入库文件名（多租户模式）
    if (activeDeptId) {
      try {
        const tasks = await httpGet<{ source_file_name: string; status: string }[]>(
          `/api/departments/${activeDeptId}/ingest-tasks`
        )
        setIngestedFiles(new Set(
          tasks.filter(t => t.status === 'done').map(t => t.source_file_name)
        ))
        setInProgressFiles(new Set(
          tasks.filter(t => t.status === 'running' || t.status === 'queued').map(t => t.source_file_name)
        ))
      } catch {
        setIngestedFiles(new Set())
        setInProgressFiles(new Set())
      }
    }
  }, [project, activeDeptId])

  useEffect(() => {
    loadSources()
  }, [loadSources])

  async function handleCreateFolder() {
    const name = newFolderName.trim()
    if (!name || !project) return
    const pp = normalizePath(project.path)
    try {
      await createDirectory(`${pp}/raw/sources/${name}`)
      setCreatingFolder(false)
      setNewFolderName("")
      await loadSources()
    } catch (e) {
      alert(e instanceof Error ? e.message : '创建文件夹失败')
    }
  }

  async function handleMoveFile(srcPath: string, destFolderPath: string) {
    const fileName = srcPath.split('/').pop()!
    const destPath = `${destFolderPath}/${fileName}`
    try {
      await moveFile(srcPath, destPath)
      await loadSources()
    } catch (e) {
      alert(e instanceof Error ? e.message : '移动文件失败')
    }
  }

  function handleImport() {
    fileInputRef.current?.click()
  }

  function handleImportFolder() {
    folderInputRef.current?.click()
  }

  async function processUploadedFiles(files: { blob: File; relativePath: string }[]) {
    if (!project || files.length === 0) return
    setImporting(true)
    const pp = normalizePath(project.path)
    const destDir = `${pp}/raw/sources`
    try {
      const savedPaths = await uploadFiles(destDir, files)
      // 仅预处理（文本提取缓存），不自动 ingest
      for (const p of savedPaths) preprocessFile(p).catch(() => {})
      await loadSources()
    } catch (err) {
      console.error("Upload failed:", err)
    } finally {
      setImporting(false)
    }
  }



  async function handleOpenSource(node: FileNode) {
    setSelectedFile(node.path)
    try {
      const content = await readFile(node.path)
      setFileContent(content)
    } catch (err) {
      console.error("Failed to read source:", err)
    }
  }

  async function handleDelete(node: FileNode) {
    if (!project) return
    const pp = normalizePath(project.path)
    // Confirmation now lives in the SourceTree component as a
    // two-stage button (click once = "Confirm", click again =
    // delete). Reaching this handler means the user has already
    // confirmed via the inline UI, so we proceed unconditionally.
    try {
      const result = await deleteSourceWithCascade(pp, node)
      // Step 8: Refresh everything (UI side — must run with parent
      // context, hence kept here rather than inside the helper).
      await loadSources()
      const tree = await listDirectory(pp)
      setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()
      if (
        selectedFile === node.path ||
        result.deletedWikiPaths.includes(selectedFile ?? "")
      ) {
        setSelectedFile(null)
      }
    } catch (err) {
      console.error("Failed to delete source:", err)
      window.alert(`Failed to delete: ${err}`)
    }
  }

  /**
   * Recursive folder delete. Walks the folder tree, runs the
   * wiki-cascade for every individual file inside (so any
   * derived wiki pages, embeddings, log entries get cleaned up
   * the same way as a single-file delete), then removes the
   * folder itself with `deleteFile` — which dispatches to
   * `remove_dir_all` Rust-side, taking the now-empty (or near-
   * empty) directory tree with it including any leftover dotdir
   * cache files we didn't explicitly target.
   *
   * Errors on individual files are logged and skipped; the batch
   * keeps going so partial cleanup is preferred over an all-or-
   * nothing failure that leaves the tree half-deleted.
   */
  async function handleDeleteFolder(folder: FileNode) {
    if (!project) return
    const pp = normalizePath(project.path)
    try {
      const allFiles = collectAllFilesIncludingDot(folder)
      const allDeletedWikiPaths: string[] = []
      for (const file of allFiles) {
        try {
          const r = await deleteSourceWithCascade(pp, file)
          allDeletedWikiPaths.push(...r.deletedWikiPaths)
        } catch (err) {
          console.warn(`Failed to delete ${file.path} during folder delete:`, err)
        }
      }
      // Now remove the folder (and any leftover empty subdirs / dot
      // cache dirs) in one shot. Files we just deleted above are
      // gone; this call mostly tears down empty directories.
      try {
        await deleteFile(folder.path)
      } catch (err) {
        console.warn(`Failed to remove folder ${folder.path}:`, err)
      }
      await loadSources()
      const tree = await listDirectory(pp)
      setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()
      if (
        selectedFile?.startsWith(folder.path + "/") ||
        allDeletedWikiPaths.includes(selectedFile ?? "")
      ) {
        setSelectedFile(null)
      }
    } catch (err) {
      console.error("Failed to delete folder:", err)
      window.alert(`Failed to delete folder: ${err}`)
    }
  }

  /**
   * Per-file deletion: the wiki cascade portion (steps 1-7 of the
   * old handleDelete), without the confirmation dialog or the
   * UI-state refresh (callers do those once at the end of a batch).
   *
   * Returns the wiki page paths we actually removed so the caller
   * can reset selectedFile if one of them was open.
   */
  async function deleteSourceWithCascade(
    pp: string,
    node: FileNode,
  ): Promise<{ deletedWikiPaths: string[] }> {
    const fileName = node.name
    // Step 1: Find related wiki pages before deleting
    const relatedPages = await findRelatedWikiPages(pp, fileName)

    // Step 2: Delete the source file
    await deleteFile(node.path)

    // Step 3: Delete preprocessed cache
    try {
      await deleteFile(`${pp}/raw/sources/.cache/${fileName}.txt`)
    } catch {
      // cache file may not exist
    }

      // Step 4: For each page that findRelatedWikiPages surfaced,
      // consult decidePageFate to pick one of three actions:
      //
      //   keep   — page has OTHER sources too; just drop this one from
      //            its sources[] list and rewrite.
      //   delete — this was the page's sole source; remove the page
      //            and record { slug, title } so downstream cleanup
      //            can wipe every stale reference to it.
      //   skip   — the page's sources[] doesn't actually include the
      //            file being deleted. Must have been surfaced by the
      //            Rust findRelatedWikiPages loose-match path (fs.rs
      //            Strategy 3 — substring of title / description /
      //            elsewhere in the frontmatter). Leaving the page
      //            alone prevents silent data loss when a filename
      //            happens to appear in an unrelated page's metadata.
      // Pass 1: keep / skip — rewrite sources for shared pages, no
      // deletion needed. The "delete" decisions are deferred to a
      // single batch call after the loop so we can route them
      // through the unified cascade helper.
      const pagesToDelete: string[] = []
      for (const pagePath of relatedPages) {
        try {
          const content = await readFile(pagePath)
          const sourcesList = parseSources(content)
          const decision = decidePageFate(sourcesList, fileName)

          if (decision.action === "skip") {
            // Nothing to do — page isn't really derived from this source.
            continue
          }

          if (decision.action === "keep") {
            // Multi-source page — rewrite sources with the deleted one
            // filtered out. writeSources preserves every other
            // frontmatter field and position.
            const updated = writeSources(content, decision.updatedSources)
            await writeFile(pagePath, updated)
            continue
          }

          // action === "delete" → defer.
          pagesToDelete.push(pagePath)
        } catch (err) {
          console.error(`Failed to process wiki page ${pagePath}:`, err)
        }
      }

      // Pass 2: full cascade for every page whose sole source was
      // this file. The helper deletes the file + drops embeddings
      // + sweeps every other wiki .md to clean stale body
      // wikilinks, index.md listings, AND `related:` frontmatter
      // arrays. The previous inline cleanup loop did 1 and 2 but
      // left `related:` slugs pointing at deleted pages, which
      // FrontmatterPanel renders as a broken-ref warning icon.
      const { cascadeDeleteWikiPagesWithRefs } = await import(
        "@/lib/wiki-page-delete"
      )
      const cascadeResult =
        pagesToDelete.length > 0
          ? await cascadeDeleteWikiPagesWithRefs(pp, pagesToDelete)
          : { deletedPaths: [], rewrittenFiles: 0 }
      const actuallyDeleted = cascadeResult.deletedPaths

    // Step 7: Append deletion record to log.md
    try {
      const logPath = `${pp}/wiki/log.md`
      const logContent = await readFile(logPath).catch(() => "# Wiki Log\n")
      const date = new Date().toISOString().slice(0, 10)
      const keptCount = relatedPages.length - actuallyDeleted.length
      const logEntry = `\n## [${date}] delete | ${fileName}\n\nDeleted source file and ${actuallyDeleted.length} wiki pages.${keptCount > 0 ? ` ${keptCount} shared pages kept (have other sources).` : ""}\n`
      await writeFile(logPath, logContent.trimEnd() + logEntry)
    } catch {
      // non-critical
    }

    // Step 8: Drop the source's ingest-cache entry so a future
    // re-import doesn't hit a stale "already ingested" record.
    // The cache's existence-check fallback would have caught this
    // anyway (it falls through to re-ingest when wiki/sources/<slug>.md
    // is gone), but removing the entry up front keeps the cache
    // file small and avoids confusing log lines like "cache miss
    // for foo.pdf: wiki/sources/foo.md no longer on disk" on
    // every search after a delete.
    try {
      await removeFromIngestCache(pp, fileName)
    } catch {
      // non-critical
    }

    return { deletedWikiPaths: actuallyDeleted }
  }

  async function doIngest(node: FileNode) {
    if (!project || ingestingPath) return
    setIngestingPath(node.path)
    try {
      await enqueueIngest(project.id, node.path, "", activeDeptId ?? undefined)
      // 乐观更新：立即显示绿点，不等 API 回调
      setIngestedFiles(prev => new Set([...prev, node.name]))
    } catch (err) {
      console.error("Failed to enqueue ingest:", err)
    } finally {
      setIngestingPath(null)
    }
  }

  function handleIngest(node: FileNode) {
    if (!project || ingestingPath) return
    // 已经 ingest 过：弹出二次确认框
    if (ingestedFiles.has(node.name)) {
      setReingestConfirmNode(node)
      return
    }
    void doIngest(node)
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Re-ingest 二次确认弹窗 */}
      <Dialog
        open={reingestConfirmNode !== null}
        onOpenChange={(open) => { if (!open) setReingestConfirmNode(null) }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-amber-500" />
              重新 Ingest？
            </DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground">
                {reingestConfirmNode?.name}
              </span>{" "}
              已经 ingest 过，Wiki 中存在对应的分析页面。
              <br />
              继续将重新入队处理，原有内容会被覆盖。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <DialogClose>
              <Button variant="outline" size="sm">取消</Button>
            </DialogClose>
            <Button
              size="sm"
              onClick={() => {
                const node = reingestConfirmNode
                setReingestConfirmNode(null)
                if (node) void doIngest(node)
              }}
            >
              继续 Ingest
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) =>
          processUploadedFiles(
            Array.from(e.target.files ?? []).map((f) => ({ blob: f, relativePath: f.name })),
          )
        }
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...({ webkitdirectory: "" } as any)}
        className="hidden"
        onChange={(e) =>
          processUploadedFiles(
            Array.from(e.target.files ?? []).map((f) => ({
              blob: f,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              relativePath: (f as any).webkitRelativePath || f.name,
            })),
          )
        }
      />
      <div className="flex flex-col border-b">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold">{t("sources.title")}</h2>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={loadSources} title="刷新">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" title="新建文件夹"
              onClick={() => {
                setCreatingFolder(true)
                setTimeout(() => newFolderInputRef.current?.focus(), 50)
              }}>
              <FolderPlus className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={handleImport} disabled={importing}>
              <Plus className="mr-1 h-4 w-4" />
              {importing ? t("sources.importing") : t("sources.import")}
            </Button>
            <Button size="sm" onClick={handleImportFolder} disabled={importing}>
              <Plus className="mr-1 h-4 w-4" />
              {t("sources.importFolder", "文件夹")}
            </Button>
          </div>
        </div>
        {creatingFolder && (
          <div className="flex items-center gap-2 px-4 pb-3">
            <Folder className="h-4 w-4 shrink-0 text-amber-500" />
            <input
              ref={newFolderInputRef}
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreateFolder()
                if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName("") }
              }}
              placeholder="文件夹名称..."
              className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <Button size="sm" onClick={handleCreateFolder}>确认</Button>
            <Button size="sm" variant="ghost" onClick={() => { setCreatingFolder(false); setNewFolderName("") }}>取消</Button>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        {sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
            <p>{t("sources.noSources")}</p>
            <p>{t("sources.importHint")}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleImport}>
                <Plus className="mr-1 h-4 w-4" />
                {t("sources.importFiles")}
              </Button>
              <Button variant="outline" size="sm" onClick={handleImportFolder}>
                <Plus className="mr-1 h-4 w-4" />
                文件夹
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-2">
            <SourceTree
              nodes={sources}
              onOpen={handleOpenSource}
              onIngest={handleIngest}
              onDelete={handleDelete}
              onDeleteFolder={handleDeleteFolder}
              onMoveFile={handleMoveFile}
              onRefresh={loadSources}
              pendingDeletePath={pendingDeletePath}
              setPendingDeletePath={setPendingDeletePath}
              ingestingPath={ingestingPath}
              ingestedFiles={ingestedFiles}
              inProgressFiles={inProgressFiles}
              depth={0}
            />
          </div>
        )}
      </ScrollArea>

      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        {t("sources.sourceCount", { count: countFiles(sources) })}
      </div>
    </div>
  )
}


function filterTree(nodes: FileNode[]): FileNode[] {
  return nodes
    .filter((n) => !n.name.startsWith("."))
    .map((n) => {
      if (n.is_dir) {
        // 确保 children 始终是数组（后端空目录可能返回 null/undefined）
        return { ...n, children: filterTree(n.children ?? []) }
      }
      return n
    })
}

function countFiles(nodes: FileNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.is_dir && node.children) {
      count += countFiles(node.children)
    } else if (!node.is_dir) {
      count++
    }
  }
  return count
}


function SourceTree({
  nodes,
  onOpen,
  onIngest,
  onDelete,
  onDeleteFolder,
  onMoveFile,
  onRefresh,
  pendingDeletePath,
  setPendingDeletePath,
  ingestingPath,
  ingestedFiles,
  inProgressFiles,
  depth,
}: {
  nodes: FileNode[]
  onOpen: (node: FileNode) => void
  onIngest: (node: FileNode) => void
  onDelete: (node: FileNode) => void
  onDeleteFolder: (node: FileNode) => void
  onMoveFile: (srcPath: string, destFolderPath: string) => void
  onRefresh: () => void
  ingestedFiles: Set<string>
  inProgressFiles: Set<string>
  /** Path of the node currently in "click again to confirm" state.
   *  Lifted to the parent so only ONE button is armed at a time
   *  across the whole tree — clicking another delete arms that one
   *  and disarms the previous. */
  pendingDeletePath: string | null
  setPendingDeletePath: (path: string | null) => void
  ingestingPath: string | null
  depth: number
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renamingValue, setRenamingValue] = useState("")
  const [addingSubIn, setAddingSubIn] = useState<string | null>(null)  // 正在哪个文件夹下建子文件夹
  const [subFolderName, setSubFolderName] = useState("")

  const toggle = (path: string) => {
    setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }))
  }

  async function handleRename(node: FileNode) {
    const newName = renamingValue.trim()
    if (!newName || newName === node.name) { setRenamingPath(null); return }
    const parent = node.path.substring(0, node.path.lastIndexOf('/'))
    const newPath = `${parent}/${newName}`
    try {
      await renameFile(node.path, newPath)
      onRefresh()
    } catch (e) { alert(e instanceof Error ? e.message : '重命名失败') }
    setRenamingPath(null)
    setRenamingValue("")
  }

  async function handleCreateSub(node: FileNode) {
    const name = subFolderName.trim()
    if (!name) { setAddingSubIn(null); return }
    try {
      await createDirectory(`${node.path}/${name}`)
      setCollapsed(prev => ({ ...prev, [node.path]: false }))
      onRefresh()
    } catch (e) { alert(e instanceof Error ? e.message : '创建失败') }
    setAddingSubIn(null)
    setSubFolderName("")
  }

  /**
   * Two-stage delete handler. Decision logic lives in
   * `decideDeleteClick` (pure, unit-tested in
   * `sources-tree-delete.test.ts`); this wrapper just dispatches
   * the resulting action onto the React state + handler props.
   */
  const handleDeleteClick = (node: FileNode) => {
    const action = decideDeleteClick(pendingDeletePath, node)
    switch (action.kind) {
      case "arm":
        setPendingDeletePath(action.path)
        return
      case "fire-file":
        setPendingDeletePath(null)
        onDelete(action.node)
        return
      case "fire-folder":
        setPendingDeletePath(null)
        onDeleteFolder(action.node)
        return
    }
  }

  // Sort: folders first, then files, alphabetical within each group
  const sorted = [...nodes].sort((a, b) => {
    if (a.is_dir && !b.is_dir) return -1
    if (!a.is_dir && b.is_dir) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <>
      {sorted.map((node) => {
        const isPendingDelete = pendingDeletePath === node.path
        if (node.is_dir) {
          const children = node.children ?? []
          const isCollapsed = collapsed[node.path] ?? true
          const isDragOver = dragOverPath === node.path
          return (
            <div key={node.path}>
              <div
                className={`group flex w-full items-center gap-1 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors ${isDragOver ? 'bg-accent/60 ring-1 ring-primary' : ''}`}
                style={{ paddingLeft: `${depth * 16 + 4}px` }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverPath(node.path) }}
                onDragLeave={(e) => { e.stopPropagation(); setDragOverPath(null) }}
                onDrop={(e) => {
                  e.preventDefault(); e.stopPropagation()
                  const src = e.dataTransfer.getData('text/plain')
                  if (src && src !== node.path) onMoveFile(src, node.path)
                  setDragOverPath(null)
                }}
              >
                {renamingPath === node.path ? (
                  <div className="flex flex-1 items-center gap-1.5 px-1 py-0.5">
                    <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                    <input
                      autoFocus
                      value={renamingValue}
                      onChange={e => setRenamingValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRename(node)
                        if (e.key === 'Escape') { setRenamingPath(null); setRenamingValue("") }
                      }}
                      className="flex-1 rounded border border-border bg-background px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button onClick={() => handleRename(node)} className="text-xs text-primary hover:underline shrink-0">确认</button>
                    <button onClick={() => { setRenamingPath(null); setRenamingValue("") }} className="text-xs text-muted-foreground hover:underline shrink-0">取消</button>
                  </div>
                ) : (
                  <button
                    onClick={() => toggle(node.path)}
                    className="flex flex-1 items-center gap-1.5 px-1 py-1 text-left"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                    <span className="truncate font-medium">{node.name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground/60 shrink-0">
                      {countFiles(children)}
                    </span>
                  </button>
                )}
                {renamingPath !== node.path && (
                  <>
                    {/* 新建子文件夹 */}
                    <button
                      className="hidden group-hover:flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-accent/50"
                      title="新建子文件夹"
                      onClick={() => { setAddingSubIn(node.path); setSubFolderName(""); setCollapsed(prev => ({ ...prev, [node.path]: false })) }}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    {/* 重命名 */}
                    <button
                      className="hidden group-hover:flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-accent/50"
                      title="重命名"
                      onClick={() => { setRenamingPath(node.path); setRenamingValue(node.name) }}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <DeleteButton
                      isPending={isPendingDelete}
                      onClick={() => handleDeleteClick(node)}
                      hint={
                        isPendingDelete
                          ? `Click again to delete folder ${node.name} and ALL its contents`
                          : `Delete folder ${node.name} (recursive)`
                      }
                    />
                  </>
                )}
              </div>
              {!isCollapsed && (
                <SourceTree
                  nodes={children}
                  onOpen={onOpen}
                  onIngest={onIngest}
                  onDelete={onDelete}
                  onDeleteFolder={onDeleteFolder}
                  onMoveFile={onMoveFile}
                  onRefresh={onRefresh}
                  pendingDeletePath={pendingDeletePath}
                  setPendingDeletePath={setPendingDeletePath}
                  ingestingPath={ingestingPath}
                  ingestedFiles={ingestedFiles}
                  inProgressFiles={inProgressFiles}
                  depth={depth + 1}
                />
              )}
              {addingSubIn === node.path && (
                <div className="flex items-center gap-2 py-1" style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}>
                  <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <input
                    autoFocus
                    value={subFolderName}
                    onChange={e => setSubFolderName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleCreateSub(node)
                      if (e.key === 'Escape') { setAddingSubIn(null); setSubFolderName("") }
                    }}
                    placeholder="子文件夹名..."
                    className="flex-1 rounded border border-border bg-background px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button onClick={() => handleCreateSub(node)} className="text-xs text-primary hover:underline">确认</button>
                  <button onClick={() => { setAddingSubIn(null); setSubFolderName("") }} className="text-xs text-muted-foreground hover:underline">取消</button>
                </div>
              )}
            </div>
          )
        }

        const previewExts = ['pdf', 'xlsx', 'xls', 'docx']
        const ext = node.name.split('.').pop()?.toLowerCase() ?? ''
        const canPreview = previewExts.includes(ext)

        return (
          <div
            key={node.path}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', node.path)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDoubleClick={() => canPreview && openFilePreview(node.path)}
            className={`flex w-full items-center gap-1 rounded-md px-1 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-grab active:cursor-grabbing ${canPreview ? 'group' : ''}`}
            style={{ paddingLeft: `${depth * 16 + 4}px` }}
            title={canPreview ? '双击预览' : undefined}
          >
            <button
              onClick={() => onOpen(node)}
              className="flex flex-1 items-center gap-2 truncate px-2 py-1 text-left"
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">{node.name}</span>
              {inProgressFiles.has(node.name) && (
                <span className="ml-1 shrink-0 h-2 w-2 rounded-full bg-yellow-400" title="入库中..." />
              )}
              {ingestedFiles.has(node.name) && !inProgressFiles.has(node.name) && (
                <span className="ml-1 shrink-0 h-2 w-2 rounded-full bg-green-500" title="已写入 Wiki" />
              )}
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              title="Ingest"
              disabled={ingestingPath === node.path}
              onClick={() => onIngest(node)}
            >
              <BookOpen className="h-4 w-4" />
            </Button>
            <DeleteButton
              isPending={isPendingDelete}
              onClick={() => handleDeleteClick(node)}
              hint={
                isPendingDelete
                  ? `Click again to delete ${node.name}`
                  : `Delete ${node.name}`
              }
            />
          </div>
        )
      })}
    </>
  )
}

/**
 * Two-stage delete button. Default = ghost trash icon (subtle).
 * Armed = solid red "Confirm" pill with the icon — visually
 * unmistakable, so the user can't miss the second-click warning.
 *
 * Same component is used for both files and folders; the parent
 * decides which delete handler to call from the click. The pending
 * state is owned by SourceTree (lifted to its parent SourcesView)
 * so only one button is armed across the entire tree at a time.
 */
function DeleteButton({
  isPending,
  onClick,
  hint,
}: {
  isPending: boolean
  onClick: () => void
  hint: string
}) {
  if (isPending) {
    return (
      <Button
        variant="destructive"
        size="sm"
        className="h-7 shrink-0 px-2 text-[11px] font-semibold animate-pulse"
        title={hint}
        onClick={onClick}
      >
        <Trash2 className="mr-1 h-3.5 w-3.5" />
        Confirm
      </Button>
    )
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
      title={hint}
      onClick={onClick}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  )
}

