import { describe, expect, it } from "vitest"
import { SIDEBAR_TAB_LABELS } from "./sidebar-panel"

describe("SidebarPanel", () => {
  it("uses Chinese labels for sidebar tabs", () => {
    expect(SIDEBAR_TAB_LABELS).toEqual({
      knowledge: "知识库",
      files: "文件",
    })
  })
})
