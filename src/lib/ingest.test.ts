import { describe, it, expect } from "vitest"
import { getProjectMetaPaths } from "./ingest"

describe("getProjectMetaPaths", () => {
  it("reads schema and purpose from the project root, not wiki/", () => {
    expect(getProjectMetaPaths("/proj")).toEqual({
      schema: "/proj/schema.md",
      purpose: "/proj/purpose.md",
      index: "/proj/wiki/index.md",
      overview: "/proj/wiki/overview.md",
    })
  })
})
