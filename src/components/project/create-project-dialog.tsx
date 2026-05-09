import { useEffect, useState } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createProject, writeFile, createDirectory, discoverProjects } from "@/commands/fs"
import { getTemplate } from "@/lib/templates"
import { TemplatePicker } from "@/components/project/template-picker"
import type { WikiProject } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"
import { OUTPUT_LANGUAGE_OPTIONS } from "@/lib/output-language-options"
import { useWikiStore, type OutputLanguage } from "@/stores/wiki-store"
import { saveOutputLanguage } from "@/lib/project-store"
import { useTranslation } from "react-i18next"

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (project: WikiProject) => void
}

const FALLBACK_PROJECT_PARENT_DIR = import.meta.env.VITE_WIKI_PARENT_DIR || "/data/wiki"

export function CreateProjectDialog({ open: isOpen, onOpenChange, onCreated }: CreateProjectDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [selectedTemplate, setSelectedTemplate] = useState("general")
  const [language, setLanguage] = useState<string>("")
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)
  const [projectRoot, setProjectRoot] = useState(FALLBACK_PROJECT_PARENT_DIR)
  const setOutputLanguage = useWikiStore((s) => s.setOutputLanguage)

  useEffect(() => {
    if (!isOpen) return
    discoverProjects()
      .then((result) => {
        if (result.rootPath?.trim()) {
          setProjectRoot(result.rootPath)
        }
      })
      .catch(() => {
        setProjectRoot(FALLBACK_PROJECT_PARENT_DIR)
      })
  }, [isOpen])

  async function handleCreate() {
    if (!name.trim()) {
      setError("项目名称不能为空")
      return
    }
    if (!language) {
      setError("请选择 AI 输出语言")
      return
    }
    setCreating(true)
    setError("")
    try {
      const project = await createProject(name.trim(), projectRoot)
      const pp = normalizePath(project.path)

      const template = getTemplate(selectedTemplate)
      await writeFile(`${pp}/schema.md`, template.schema)
      await writeFile(`${pp}/purpose.md`, template.purpose)
      for (const dir of template.extraDirs) {
        await createDirectory(`${pp}/${dir}`)
      }

      const lang = language as OutputLanguage
      setOutputLanguage(lang)
      await saveOutputLanguage(lang, project.id)

      onCreated(project)
      onOpenChange(false)
      setName("")
      setSelectedTemplate("general")
      setLanguage("")
    } catch (err) {
      setError(String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("project.createTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">{t("project.name")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("project.namePlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("project.template")}</Label>
            <TemplatePicker selected={selectedTemplate} onSelect={setSelectedTemplate} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="language">
              AI 输出语言 <span className="text-destructive">*</span>
            </Label>
            <select
              id="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="" disabled>
                请选择语言…
              </option>
              {OUTPUT_LANGUAGE_OPTIONS.filter((l) => l.value !== "auto").map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              所有 AI 生成内容（Wiki 页面、聊天回复、研究结果）都会使用这个语言。
              之后也可以在“设置 → 输出偏好”中修改。
            </p>
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            项目会自动创建到 <code className="font-mono">{projectRoot}</code>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("project.cancel")}</Button>
          <Button onClick={handleCreate} disabled={creating}>{creating ? t("project.creating") : t("project.create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
