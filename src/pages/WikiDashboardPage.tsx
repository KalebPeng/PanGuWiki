import { useState, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import {
  BookOpen, Command, Users, Settings, ChevronUp,
  Building2, Check, LogOut, ArrowUpRight,
  FileText, Folder, TrendingUp, AlertCircle,
  ShieldCheck as ShieldCheckIcon,
} from "lucide-react"
import { useAuthStore } from "@/stores/auth-store"
import { useOrgStore } from "@/stores/org-store"
import { httpGet } from "@/api/dotnet-client"
import { isSuperAdminFromToken } from "@/lib/auth-utils"
import { DeptSettingsContent } from "@/pages/DeptSettingsPage"
import { AdminUsersPage } from "@/pages/admin/AdminUsersPage"
import { AdminOrgsPage } from "@/pages/admin/AdminOrgsPage"
import { AdminOrgDetailPage } from "@/pages/admin/AdminOrgDetailPage"
type DashboardView = "home" | "settings" | "admin"

interface Props {
  deptId: string
  onEnterWiki: () => void
}

interface WikiPage {
  title: string
  relative_path: string
}

interface IngestTask {
  id: string
  source_file_name: string
  source_file_path: string
  status: string
  wiki_pages_count: number | null
  triggered_by: string | null
  queued_at: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
  progress_detail: string | null
}

interface Member {
  id: string
  user_id: string
  role: string
  joined_at: string
}

function formatRelativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "刚刚"
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })
}

function isThisWeek(iso: string): boolean {
  const then = new Date(iso).getTime()
  return Date.now() - then < 7 * 24 * 60 * 60 * 1000
}

// Stable color from string hash
const AVATAR_COLORS = [
  { bg: "#DCE5FF", text: "#2D5BFF" },
  { bg: "#F8E5C2", text: "#8C5B14" },
  { bg: "#D6EBDD", text: "#1F6B47" },
  { bg: "#F5D7DD", text: "#9B2D45" },
  { bg: "#E8D5FF", text: "#6B2DB4" },
]
function avatarColor(str: string) {
  let hash = 0
  for (const c of str) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

// ─── Dept Dropdown ─────────────────────────────────────────────────────────────

function DeptDropdown({
  onClose,
  deptId,
}: {
  onClose: () => void
  deptId: string
}) {
  const navigate = useNavigate()
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const depts = useOrgStore((s) => s.depts)
  const orgs = useOrgStore((s) => s.orgs)
  const setActiveDeptId = useOrgStore((s) => s.setActiveDeptId)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    setTimeout(() => document.addEventListener("mousedown", onDown), 0)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  function handleSwitchDept(id: string) {
    setActiveDeptId(id)
    onClose()
    navigate(`/d/${id}`)
  }

  function handleLogout() {
    clearAuth()
    navigate("/login", { replace: true })
  }

  return (
    <div
      ref={ref}
      className="absolute bottom-[calc(100%+4px)] left-2.5 right-2.5 z-30 rounded-xl border border-[#E2E2DF] bg-white py-1.5 shadow-[0_4px_16px_rgba(20,20,30,0.08),0_12px_32px_rgba(20,20,30,0.08)]"
      style={{ animation: "dropdownIn 140ms cubic-bezier(0.16,1,0.3,1)" }}
    >
      <style>{`@keyframes dropdownIn{from{opacity:0;transform:translateY(4px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}`}</style>

      <div className="px-2.5 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-wider text-[#8E8E94]">
        切换部门
      </div>

      {depts.map((d) => {
        const org = orgs.find((o) => o.id === d.orgId)
        const isActive = d.id === deptId
        return (
          <button
            key={d.id}
            onClick={() => handleSwitchDept(d.id)}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-[#F2F2F0]"
          >
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] bg-[#ECECE8] text-[#5C5C66]">
              <Building2 size={12} />
            </span>
            <span className="min-w-0 flex-1">
              <div className="text-[13px] text-[#1A1A2E]">{d.name}</div>
              {org && <div className="mt-0.5 text-[11px] text-[#8E8E94]">{org.name}</div>}
            </span>
            {isActive && <Check size={14} className="shrink-0 text-[#2D5BFF]" />}
          </button>
        )
      })}

      <div className="my-1.5 mx-1 h-px bg-[#EDEDEB]" />

      <button
        onClick={handleLogout}
        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-[#B5384E] hover:bg-[#FDF1F3]"
      >
        <LogOut size={14} />
        退出登录
      </button>
    </div>
  )
}

// ─── Sidebar ───────────────────────────────────────────────────────────────────

function DashboardSidebar({
  deptId,
  activeView,
  onChangeView,
}: {
  deptId: string
  activeView: DashboardView
  onChangeView: (v: DashboardView) => void
}) {
  const user = useAuthStore((s) => s.user)
  const activeDept = useOrgStore((s) => s.activeDept)
  const orgs = useOrgStore((s) => s.orgs)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isDeptAdmin, setIsDeptAdmin] = useState(false)

  const isAdmin = isSuperAdminFromToken() || isDeptAdmin

  const org = orgs.find((o) => activeDept && o.id === activeDept.orgId)
  const initials = user?.displayName?.slice(0, 1) ?? "?"
  const col = avatarColor(user?.displayName ?? "")

  // 查询当前用户在本部门的角色
  useEffect(() => {
    if (isSuperAdminFromToken()) return // super admin 不需要再查
    if (!deptId || !user?.id) return
    httpGet<{ id: string; user_id: string; role: string }[]>(
      `/api/departments/${deptId}/members`,
    )
      .then((members) => {
        const me = members.find((m) => m.user_id === user.id)
        setIsDeptAdmin(me?.role === "admin")
      })
      .catch(() => {})
  }, [deptId, user?.id])

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-[#EDEDEB] bg-[#F9F9F9]" style={{ position: "sticky", top: 0 }}>
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 pb-3.5 pt-[18px]">
        <div
          className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[13px] font-semibold tracking-tight text-white"
          style={{ background: "#1A1A2E", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)" }}
        >
          W
        </div>
        <span className="text-[14px] font-semibold tracking-tight text-[#1A1A2E]">Wiki 知识库</span>
      </div>

      {/* Section label */}
      <div className="px-5 pb-1.5 pt-3.5 text-[11px] font-medium uppercase tracking-widest text-[#8E8E94]">
        工作区
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-1.5">
        {/* Wiki 知识库 */}
        <button
          onClick={() => onChangeView("home")}
          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors ${
            activeView === "home"
              ? "bg-[#ECECE8] font-medium text-[#1A1A2E]"
              : "text-[#5C5C66] hover:bg-[#F2F2F0] hover:text-[#1A1A2E]"
          }`}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center"><BookOpen size={15} /></span>
          <span className="flex-1 text-left">Wiki 知识库</span>
        </button>

        {/* 任务中心 — 即将推出 */}
        <button disabled className="flex w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] text-[#B5B5BB] transition-colors">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center"><Command size={15} /></span>
          <span className="flex-1 text-left">任务中心</span>
          <span className="rounded border border-[#EDEDEB] bg-[#ECECE8] px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[#8E8E94]">即将推出</span>
        </button>

        {/* 人员目录 — 即将推出 */}
        <button disabled className="flex w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] text-[#B5B5BB] transition-colors">
          <span className="flex h-4 w-4 shrink-0 items-center justify-center"><Users size={15} /></span>
          <span className="flex-1 text-left">人员目录</span>
          <span className="rounded border border-[#EDEDEB] bg-[#ECECE8] px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[#8E8E94]">即将推出</span>
        </button>

        {/* 工作区设置 — admin 可见且可切换，其他人隐藏 */}
        {isAdmin && (
          <button
            onClick={() => onChangeView("settings")}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors ${
              activeView === "settings"
                ? "bg-[#ECECE8] font-medium text-[#1A1A2E]"
                : "text-[#5C5C66] hover:bg-[#F2F2F0] hover:text-[#1A1A2E]"
            }`}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center"><Settings size={15} /></span>
            <span className="flex-1 text-left">工作区设置</span>
          </button>
        )}

        {/* 系统管理 — 仅超级管理员可见 */}
        {isSuperAdminFromToken() && (
          <button
            onClick={() => onChangeView("admin")}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors ${
              activeView === "admin"
                ? "bg-[#ECECE8] font-medium text-[#1A1A2E]"
                : "text-[#5C5C66] hover:bg-[#F2F2F0] hover:text-[#1A1A2E]"
            }`}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center"><ShieldCheckIcon size={15} /></span>
            <span className="flex-1 text-left">系统管理</span>
          </button>
        )}
      </nav>

      {/* User area */}
      <div className="relative border-t border-[#EDEDEB] p-2.5">
        {menuOpen && (
          <DeptDropdown deptId={deptId} onClose={() => setMenuOpen(false)} />
        )}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className={`flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors ${
            menuOpen ? "bg-[#F2F2F0]" : "hover:bg-[#F2F2F0]"
          }`}
        >
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
            style={{ background: col.bg, color: col.text }}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-[#1A1A2E]">
              {user?.displayName ?? "—"}
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-[#8E8E94]">
              {activeDept?.name ?? "—"}{org ? ` · ${org.name}` : ""}
            </div>
          </div>
          <ChevronUp
            size={14}
            className={`shrink-0 text-[#8E8E94] transition-transform ${menuOpen ? "rotate-180" : ""}`}
          />
        </button>
      </div>
    </aside>
  )
}

// ─── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  delta,
  up,
}: {
  label: string
  value: string | number
  delta?: string
  up?: boolean
}) {
  return (
    <div className="rounded-[10px] border border-[#EDEDEB] bg-white px-[18px] py-4 shadow-[0_1px_2px_rgba(20,20,30,0.04)]">
      <div className="mb-1.5 text-[12px] text-[#8E8E94]">{label}</div>
      <div className="text-[24px] font-semibold leading-none tracking-tight text-[#1A1A2E]">
        {value}
      </div>
      {delta && (
        <div
          className={`mt-1 flex items-center gap-1 text-[11.5px] ${up ? "text-[#138060]" : "text-[#8E8E94]"}`}
        >
          {up && <TrendingUp size={11} strokeWidth={2} />}
          <span>{delta}</span>
        </div>
      )}
    </div>
  )
}

// ─── Recent Item ───────────────────────────────────────────────────────────────

function RecentItem({ task }: { task: IngestTask }) {
  const name = task.source_file_name
  const col = avatarColor(task.id)
  const time = task.completed_at ? formatRelativeTime(task.completed_at) : "—"
  // Build a readable path from source_file_path
  const pathParts = task.source_file_path
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
  const displayPath = pathParts.length > 2
    ? pathParts.slice(-2).join(" / ")
    : pathParts.join(" / ")

  return (
    <div className="grid cursor-pointer items-center gap-4 border-b border-[#EDEDEB] px-[18px] py-3.5 transition-colors last:border-b-0 hover:bg-[#FAFAF9]"
      style={{ gridTemplateColumns: "1fr auto auto" }}>
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-[#EDEDEB] bg-[#FAFAF9] text-[#5C5C66]">
          <FileText size={15} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium text-[#1A1A2E]">{name}</div>
          <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-[#8E8E94]">
            <Folder size={11} strokeWidth={1.7} />
            <span className="truncate">{displayPath}</span>
          </div>
        </div>
      </div>
      <div
        className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[10px] font-semibold"
        style={{ background: col.bg, color: col.text }}
        title={task.id}
      >
        W
      </div>
      <div className="min-w-[80px] text-right font-[variant-numeric:tabular-nums] text-[12px] text-[#8E8E94]">
        {time}
      </div>
    </div>
  )
}

// ─── Admin View ────────────────────────────────────────────────────────────────

type AdminSubView = "users" | "orgs" | "org-detail"

function AdminView() {
  const [sub, setSub] = useState<AdminSubView>("users")
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)

  function handleSelectOrg(orgId: string) {
    setSelectedOrgId(orgId)
    setSub("org-detail")
  }

  return (
    <div className="mx-auto max-w-[960px] px-12 pb-20 pt-14">
      <div className="mb-8">
        <h1 className="m-0 mb-1.5 text-[28px] font-semibold leading-tight tracking-tight text-[#1A1A2E]">
          系统管理
        </h1>
        <p className="m-0 text-[14.5px] text-[#5C5C66]">管理用户、组织与全局配置</p>
      </div>

      {/* 子导航 */}
      <div className="mb-6 flex gap-1 rounded-xl border border-border bg-muted/30 p-1">
        {([
          { key: "users", label: "用户管理" },
          { key: "orgs", label: "组织管理" },
        ] as { key: AdminSubView; label: string }[]).map((item) => (
          <button
            key={item.key}
            onClick={() => { setSub(item.key); setSelectedOrgId(null) }}
            className={[
              "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              sub === item.key || (sub === "org-detail" && item.key === "orgs")
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* 内容 */}
      {sub === "users" && <AdminUsersPage />}
      {sub === "orgs" && <AdminOrgsPage onSelectOrg={handleSelectOrg} />}
      {sub === "org-detail" && selectedOrgId && (
        <>
          <button
            onClick={() => setSub("orgs")}
            className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            返回组织列表
          </button>
          <AdminOrgDetailPage orgId={selectedOrgId} />
        </>
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function WikiDashboardPage({ deptId, onEnterWiki }: Props) {
  const [activeView, setActiveView] = useState<DashboardView>("home")
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [weeklyTasks, setWeeklyTasks] = useState<number | null>(null)
  const [recentTasks, setRecentTasks] = useState<IngestTask[]>([])
  const activeDept = useOrgStore((s) => s.activeDept)

  useEffect(() => {
    if (!deptId) return

    // Wiki page count
    httpGet<{ pages: WikiPage[] }>(`/api/departments/${deptId}/wiki/pages`)
      .then((res) => setPageCount(res.pages.length))
      .catch(() => setPageCount(null))

    // Member count
    httpGet<Member[]>(`/api/departments/${deptId}/members`)
      .then((members) => setMemberCount(members.length))
      .catch(() => setMemberCount(null))

    // Ingest tasks → this-week count + recent list
    httpGet<IngestTask[]>(`/api/departments/${deptId}/ingest-tasks`)
      .then((tasks) => {
        const done = tasks.filter((t) => t.status === "done")
        setWeeklyTasks(done.filter((t) => t.completed_at && isThisWeek(t.completed_at)).length)
        setRecentTasks(
          done
            .filter((t) => t.completed_at)
            .sort((a, b) =>
              new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime()
            )
            .slice(0, 6),
        )
      })
      .catch(() => {})
  }, [deptId])

  return (
    <div className="flex min-h-screen" style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro SC','PingFang SC','Helvetica Neue','Microsoft YaHei',system-ui,sans-serif" }}>
      <DashboardSidebar deptId={deptId} activeView={activeView} onChangeView={setActiveView} />

      <main className="min-w-0 flex-1 bg-white">
        {/* 工作区设置视图 */}
        {activeView === "settings" && (
          <div className="mx-auto max-w-[960px] px-12 pb-20 pt-14">
            <div className="mb-8">
              <h1 className="m-0 mb-1.5 text-[28px] font-semibold leading-tight tracking-tight text-[#1A1A2E]">
                工作区设置
              </h1>
              <p className="m-0 text-[14.5px] text-[#5C5C66]">管理成员、角色与模块权限</p>
            </div>
            <DeptSettingsContent deptId={deptId} />
          </div>
        )}

        {/* 系统管理视图 */}
        {activeView === "admin" && <AdminView />}

        {/* 首页视图 */}
        {activeView === "home" && (
        <div className="mx-auto max-w-[960px] px-12 pb-20 pt-14">
          {/* Page header */}
          <div className="mb-8">
            <h1 className="m-0 mb-1.5 text-[28px] font-semibold leading-tight tracking-tight text-[#1A1A2E]">
              {activeDept?.name ?? "Wiki 知识库"}
            </h1>
            <p className="m-0 text-[14.5px] text-[#5C5C66]">管理和探索团队知识</p>
          </div>

          {/* 快速操作 */}
          <div className="mb-7">
            <div className="mb-3 text-[12px] font-medium uppercase tracking-[0.08em] text-[#8E8E94]">
              快速操作
            </div>
            <button
              onClick={onEnterWiki}
              className="group relative flex w-full cursor-pointer flex-col gap-3.5 rounded-xl border border-[#EDEDEB] bg-white px-[22px] py-[22px] text-left shadow-[0_1px_2px_rgba(20,20,30,0.04)] transition-all duration-[160ms] hover:-translate-y-px hover:border-[#E2E2DF] hover:shadow-[0_1px_3px_rgba(20,20,30,0.04),0_4px_12px_rgba(20,20,30,0.04)]"
            >
              <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-[#EDEDEB] bg-[#FAFAF9] text-[#1A1A2E]">
                <BookOpen size={18} />
              </div>
              <div>
                <div className="text-[15px] font-semibold tracking-tight text-[#1A1A2E]">浏览页面</div>
                <div className="mt-0.5 text-[13px] leading-relaxed text-[#5C5C66]">
                  按部门、标签或层级结构查看全部 Wiki 页面
                </div>
              </div>
              <span className="absolute right-[22px] top-[22px] text-[#B5B5BB] transition-all duration-[160ms] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#5C5C66]">
                <ArrowUpRight size={14} />
              </span>
            </button>
          </div>

          {/* 本周概览 */}
          <div className="mb-7">
            <div className="mb-3 text-[12px] font-medium uppercase tracking-[0.08em] text-[#8E8E94]">
              本周概览
            </div>
            <div className="grid grid-cols-4 gap-3">
              <StatCard
                label="页面总数"
                value={pageCount ?? "—"}
                delta={pageCount !== null ? "已导入知识库" : undefined}
              />
              <StatCard
                label="本周更新"
                value={weeklyTasks ?? "—"}
                delta={weeklyTasks !== null ? "次 Ingest 完成" : undefined}
                up={!!weeklyTasks}
              />
              <StatCard
                label="团队成员"
                value={memberCount ?? "—"}
                delta={memberCount !== null ? "位成员" : undefined}
              />
              <StatCard
                label="待处理"
                value="—"
                delta="暂无数据"
              />
            </div>
          </div>

          {/* 最近更新 */}
          <div>
            <div className="mb-3 text-[12px] font-medium uppercase tracking-[0.08em] text-[#8E8E94]">
              最近更新
            </div>
            <div className="overflow-hidden rounded-xl border border-[#EDEDEB] bg-white shadow-[0_1px_2px_rgba(20,20,30,0.04)]">
              {recentTasks.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-[#8E8E94]">
                  <AlertCircle size={28} strokeWidth={1.5} className="opacity-40" />
                  <span className="text-[13px]">暂无已完成的 Ingest 记录</span>
                </div>
              ) : (
                <>
                  {recentTasks.map((task) => (
                    <RecentItem key={task.id} task={task} />
                  ))}
                  <div className="border-t border-[#EDEDEB] bg-[#FAFAF9] px-[18px] py-3 text-center">
                    <button
                      onClick={onEnterWiki}
                      className="text-[12.5px] font-medium text-[#5C5C66] hover:text-[#1A1A2E]"
                    >
                      进入 Wiki 查看全部 →
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        )}
      </main>
    </div>
  )
}
