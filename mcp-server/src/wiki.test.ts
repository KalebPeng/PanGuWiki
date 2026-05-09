import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createWikiService } from "./wiki.js"

let root: string

async function write(relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(root, relativePath)
  await mkdir(path.dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content, "utf-8")
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "llm-wiki-mcp-"))
  await write(
    "purpose.md",
    "# 项目目标\n\n这个知识库用于整理盘古人资产品资料。",
  )
  await write(
    "wiki/overview.md",
    "---\ntitle: 产品总览\n---\n\n# 产品总览\n\n盘古人资覆盖招聘、组织、薪酬和员工档案。",
  )
  await write(
    "wiki/entities/pangu-hr.md",
    "---\ntitle: 盘古人资\n---\n\n# 盘古人资\n\n盘古人资是一套面向企业的人力资源知识系统。",
  )
  await write(
    "wiki/concepts/payroll.md",
    "# 薪酬管理\n\n薪酬模块处理工资核算、社保和个税。",
  )
  await write("raw/source.txt", "outside wiki")
})

afterEach(async () => {
  await import("node:fs/promises").then((fs) => fs.rm(root, { recursive: true, force: true }))
})

describe("createWikiService", () => {
  it("lists markdown pages under wiki with titles", async () => {
    const wiki = await createWikiService(root)

    const pages = await wiki.listPages()

    expect(pages.map((p) => p.relativePath).sort()).toEqual([
      "wiki/concepts/payroll.md",
      "wiki/entities/pangu-hr.md",
      "wiki/overview.md",
    ])
    expect(pages.find((p) => p.relativePath === "wiki/entities/pangu-hr.md")?.title).toBe("盘古人资")
  })

  it("searches Chinese wiki content and ranks title matches first", async () => {
    const wiki = await createWikiService(root)

    const results = await wiki.search("盘古人资", 5)

    expect(results[0]).toMatchObject({
      title: "盘古人资",
      relativePath: "wiki/entities/pangu-hr.md",
    })
    expect(results[0].snippet).toContain("盘古人资")
  })

  it("reads a page by title, wiki-relative path, and bare filename", async () => {
    const wiki = await createWikiService(root)

    await expect(wiki.readPage("盘古人资")).resolves.toMatchObject({
      title: "盘古人资",
      relativePath: "wiki/entities/pangu-hr.md",
    })
    await expect(wiki.readPage("wiki/concepts/payroll.md")).resolves.toMatchObject({
      title: "薪酬管理",
    })
    await expect(wiki.readPage("payroll.md")).resolves.toMatchObject({
      relativePath: "wiki/concepts/payroll.md",
    })
  })

  it("aggregates purpose, overview, and index into overview context", async () => {
    await write("wiki/index.md", "# Wiki Index\n\n- [[盘古人资]]\n")
    const wiki = await createWikiService(root)

    const overview = await wiki.getOverview()

    expect(overview).toContain("# purpose.md")
    expect(overview).toContain("项目目标")
    expect(overview).toContain("# wiki/overview.md")
    expect(overview).toContain("产品总览")
    expect(overview).toContain("# wiki/index.md")
    expect(overview).toContain("Wiki Index")
  })

  it("rejects paths outside the project", async () => {
    const secret = path.join(root, "..", "secret.md")
    await writeFile(secret, "secret", "utf-8")
    const wiki = await createWikiService(root)

    await expect(wiki.readPage(secret)).rejects.toThrow(/outside/i)
    await expect(readFile(secret, "utf-8")).resolves.toBe("secret")
  })
})
