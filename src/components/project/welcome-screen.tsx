import { useEffect, useState } from "react"
import { FolderOpen, Plus, Clock, Server, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { discoverProjects } from "@/commands/fs"
import { getRecentProjects, removeFromRecentProjects } from "@/lib/project-store"
import type { WikiProject } from "@/types/wiki"
import { useTranslation } from "react-i18next"

interface WelcomeScreenProps {
  onCreateProject: () => void
  onOpenProject: () => void
  onSelectProject: (project: WikiProject) => void
}

export function WelcomeScreen({
  onCreateProject,
  onOpenProject,
  onSelectProject,
}: WelcomeScreenProps) {
  const { t } = useTranslation()
  const [recentProjects, setRecentProjects] = useState<WikiProject[]>([])
  const [serverProjects, setServerProjects] = useState<WikiProject[]>([])
  const [projectRoot, setProjectRoot] = useState("")
  const [loadingServerProjects, setLoadingServerProjects] = useState(true)

  useEffect(() => {
    getRecentProjects().then(setRecentProjects).catch(() => {})
    discoverProjects()
      .then((result) => {
        setServerProjects(result.projects)
        setProjectRoot(result.rootPath)
      })
      .catch(() => {})
      .finally(() => setLoadingServerProjects(false))
  }, [])

  async function handleRemoveRecent(e: React.MouseEvent, path: string) {
    e.stopPropagation()
    await removeFromRecentProjects(path)
    const updated = await getRecentProjects()
    setRecentProjects(updated)
  }

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-8 px-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold">{t("app.title")}</h1>
          <p className="mt-2 text-muted-foreground">
            {t("app.subtitle")}
          </p>
        </div>

        <div className="flex gap-3">
          <Button onClick={onCreateProject}>
            <Plus className="mr-2 h-4 w-4" />
            {t("welcome.newProject")}
          </Button>
          <Button variant="outline" onClick={onOpenProject}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {t("welcome.openProject")}
          </Button>
        </div>

        {(loadingServerProjects || serverProjects.length > 0) && (
          <div className="w-full max-w-md">
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Server className="h-3.5 w-3.5" />
              {t("welcome.serverProjects", { defaultValue: "服务器项目" })}
            </div>
            <div className="rounded-lg border">
              {loadingServerProjects ? (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  {t("welcome.loadingServerProjects", { defaultValue: "正在加载服务器项目..." })}
                </div>
              ) : (
                serverProjects.map((proj) => (
                  <button
                    key={proj.path}
                    onClick={() => onSelectProject(proj)}
                    className="flex w-full items-center justify-between border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{proj.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {proj.path}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
            {!!projectRoot && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("welcome.serverProjectsRoot", {
                  root: projectRoot,
                  defaultValue: `当前根目录：${projectRoot}`,
                })}
              </p>
            )}
          </div>
        )}

        {recentProjects.length > 0 && (
          <div className="w-full max-w-md">
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {t("welcome.recentProjects")}
            </div>
            <div className="rounded-lg border">
              {recentProjects.map((proj) => (
                <button
                  key={proj.path}
                  onClick={() => onSelectProject(proj)}
                  className="group flex w-full items-center justify-between border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-accent"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{proj.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {proj.path}
                    </div>
                  </div>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleRemoveRecent(e, proj.path)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRemoveRecent(e as unknown as React.MouseEvent, proj.path)
                    }}
                    className="ml-2 shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-destructive/10 group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
