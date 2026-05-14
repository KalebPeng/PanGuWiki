import { NavLink, Outlet } from 'react-router-dom'

export function AdminLayout() {
  return (
    <div className="flex min-h-screen bg-background">
      {/* 左侧导航 */}
      <aside className="w-52 shrink-0 border-r border-border bg-card px-4 py-6 flex flex-col gap-1">
        <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          系统管理
        </p>
        {[
          { to: '/admin/users', label: '用户管理' },
          { to: '/admin/orgs', label: '组织管理' },
        ].map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
        <div className="mt-auto">
          <NavLink
            to="/select-dept"
            className="block rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ← 返回主页
          </NavLink>
        </div>
      </aside>

      {/* 内容区 */}
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}
