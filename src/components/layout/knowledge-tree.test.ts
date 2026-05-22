import { describe, expect, it } from "vitest"
import { DEFAULT_EXPANDED_KNOWLEDGE_TYPES } from "./knowledge-tree"

describe("KnowledgeTree", () => {
  it("starts all knowledge sections collapsed by default", () => {
    expect(DEFAULT_EXPANDED_KNOWLEDGE_TYPES).toEqual([])
  })
})
