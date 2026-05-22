import { describe, expect, it } from "vitest"
import {
  DEFAULT_EXPANDED_KNOWLEDGE_TYPES,
  KNOWLEDGE_TYPE_LABELS,
  RAW_SOURCES_LABEL,
} from "./knowledge-tree"

describe("KnowledgeTree", () => {
  it("starts all knowledge sections collapsed by default", () => {
    expect(DEFAULT_EXPANDED_KNOWLEDGE_TYPES).toEqual([])
  })

  it("uses Chinese labels for knowledge sections", () => {
    expect(KNOWLEDGE_TYPE_LABELS).toMatchObject({
      overview: "概览",
      entity: "实体",
      concept: "概念",
      source: "来源",
      synthesis: "综合",
      comparison: "对比",
      query: "问题",
      other: "其他",
    })
    expect(RAW_SOURCES_LABEL).toBe("原始资料")
  })
})
