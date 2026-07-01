export type DashboardNavItemId = "home" | "images"
export type DashboardRouteView = "home" | "settings" | "admin"

export interface DashboardNavItem {
  id: DashboardNavItemId
  label: string
  path: string
  disabled: boolean
}

export function getDashboardNavItems(deptId: string): DashboardNavItem[] {
  return [
    {
      id: "home",
      label: "Wiki 知识库",
      path: `/d/${deptId}`,
      disabled: false,
    },
    {
      id: "images",
      label: "AI 图片生成",
      path: `/d/${deptId}/images`,
      disabled: false,
    },
  ]
}

export function getDashboardViewPath(deptId: string, view: DashboardRouteView): string {
  if (view === "home") return `/d/${deptId}`
  return `/d/${deptId}?view=${view}`
}
