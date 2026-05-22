import { useState } from "react"
import { KnowledgeTree } from "./knowledge-tree"
import { FileTree } from "./file-tree"

export const SIDEBAR_TAB_LABELS = {
  knowledge: "知识库",
  files: "文件",
} as const

export function SidebarPanel() {
  const [mode, setMode] = useState<"knowledge" | "files">("knowledge")

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 border-b">
        <button
          onClick={() => setMode("knowledge")}
          className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "knowledge"
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {SIDEBAR_TAB_LABELS.knowledge}
        </button>
        <button
          onClick={() => setMode("files")}
          className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "files"
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {SIDEBAR_TAB_LABELS.files}
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {mode === "knowledge" ? <KnowledgeTree /> : <FileTree />}
      </div>
    </div>
  )
}
