import { describe, expect, it } from "vitest"

import { getDashboardNavItems, getDashboardViewPath } from "./dashboard-navigation"

describe("getDashboardNavItems", () => {
  it("places AI image generation directly below the wiki item", () => {
    const items = getDashboardNavItems("dept-1")

    expect(items.slice(0, 2).map((item) => item.label)).toEqual([
      "Wiki 知识库",
      "AI 图片生成",
    ])
  })

  it("links the AI image generation item to the department images route", () => {
    const imagesItem = getDashboardNavItems("dept-1").find((item) => item.id === "images")

    expect(imagesItem).toMatchObject({
      disabled: false,
      path: "/d/dept-1/images",
    })
  })

  it("builds dashboard handoff routes for settings and admin views", () => {
    expect(getDashboardViewPath("dept-1", "settings")).toBe("/d/dept-1?view=settings")
    expect(getDashboardViewPath("dept-1", "admin")).toBe("/d/dept-1?view=admin")
  })
})
