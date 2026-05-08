import { describe, it, expect } from "vitest"
import { buildResearchOutputPath } from "./deep-research"

describe("buildResearchOutputPath", () => {
  it("keeps non-ASCII topics instead of collapsing them to an empty slug", () => {
    const out = buildResearchOutputPath(
      "/proj",
      "旋转位置编码",
      new Date("2026-05-08T12:34:56.000Z"),
    )

    expect(out.slug).toBe("旋转位置编码")
    expect(out.fileName).toBe("research-旋转位置编码-2026-05-08-123456.md")
    expect(out.filePath).toBe("/proj/wiki/queries/research-旋转位置编码-2026-05-08-123456.md")
  })

  it("falls back to the shared query filename policy for punctuation-only topics", () => {
    const out = buildResearchOutputPath(
      "/proj",
      "!!! ???",
      new Date("2026-05-08T00:00:01.000Z"),
    )

    expect(out.slug).toBe("query")
    expect(out.fileName).toBe("research-query-2026-05-08-000001.md")
  })
})
