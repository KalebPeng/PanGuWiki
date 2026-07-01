import { useNavigate } from "react-router-dom"

import { DashboardSidebar } from "@/pages/WikiDashboardPage"

interface Props {
  deptId: string
}

export function ImageGenerationPage({ deptId }: Props) {
  const navigate = useNavigate()

  return (
    <div
      className="flex min-h-screen"
      style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro SC','PingFang SC','Helvetica Neue','Microsoft YaHei',system-ui,sans-serif" }}
    >
      <DashboardSidebar
        deptId={deptId}
        activeView="images"
        onChangeView={(view) => {
          if (view === "home") navigate(`/d/${deptId}`)
          if (view === "settings") navigate(`/d/${deptId}/settings`)
          if (view === "admin") navigate(`/d/${deptId}`)
        }}
      />

      <main className="min-w-0 flex-1 bg-white">
        <div className="mx-auto max-w-[960px] px-12 pb-20 pt-14">
          <div className="mb-8">
            <h1 className="m-0 mb-1.5 text-[28px] font-semibold leading-tight tracking-tight text-[#1A1A2E]">
              AI 图片生成
            </h1>
            <p className="m-0 text-[14.5px] text-[#5C5C66]">
              图片生成工作区占位页。完整生成体验将在后续任务中实现。
            </p>
          </div>
          <div className="rounded-[10px] border border-[#EDEDEB] bg-[#FAFAF9] px-[18px] py-4 text-[13.5px] text-[#5C5C66]">
            当前部门：{deptId}
          </div>
        </div>
      </main>
    </div>
  )
}
