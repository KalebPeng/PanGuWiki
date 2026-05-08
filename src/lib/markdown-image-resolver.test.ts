/**
 * Tests for `resolveMarkdownImageSrc`.
 *
 * Now that we've removed Tauri's `convertFileSrc`, absolute filesystem
 * paths are returned as-is and relative paths are resolved to
 * `<projectPath>/wiki/<cleaned>`.
 */
import { describe, it, expect } from "vitest"

import { resolveMarkdownImageSrc } from "./markdown-image-resolver"

describe("resolveMarkdownImageSrc", () => {
  const PROJECT = "/Users/me/MyWiki"

  it("passes http(s) URLs through unchanged", () => {
    expect(resolveMarkdownImageSrc("https://example.com/img.png", PROJECT)).toBe(
      "https://example.com/img.png",
    )
    expect(resolveMarkdownImageSrc("http://insecure.test/x.png", PROJECT)).toBe(
      "http://insecure.test/x.png",
    )
  })

  it("passes data: URIs through unchanged (inline base64)", () => {
    const src = "data:image/png;base64,iVBORw0K..."
    expect(resolveMarkdownImageSrc(src, PROJECT)).toBe(src)
  })

  it("passes blob: URIs through unchanged", () => {
    expect(resolveMarkdownImageSrc("blob:abc-123", PROJECT)).toBe("blob:abc-123")
  })

  it("passes file: URIs through unchanged", () => {
    expect(resolveMarkdownImageSrc("file:///Users/me/img.png", PROJECT)).toBe(
      "file:///Users/me/img.png",
    )
  })

  it("passes tauri: URIs through unchanged (legacy content)", () => {
    // tauri:// is no longer in the passthrough list, but paths starting
    // with tauri:// are absolute and treated as absolute filesystem paths
    // (they don't start with / or a drive letter, so they pass through
    // the isAbsolute check as false, but the PASSTHROUGH_RE won't catch
    // them either). In practice, no new content will use tauri:// URIs.
    // This test just documents current behavior.
    expect(resolveMarkdownImageSrc("tauri://asset/foo.png", PROJECT)).toBe(
      `${PROJECT}/wiki/tauri://asset/foo.png`,
    )
  })

  it("treats a wiki-rooted relative path as media under <project>/wiki/", () => {
    // This is the canonical case — ingest emits exactly this shape:
    //   ![](media/<source-slug>/img-1.png)
    expect(
      resolveMarkdownImageSrc("media/rope-paper/img-1.png", PROJECT),
    ).toBe("/Users/me/MyWiki/wiki/media/rope-paper/img-1.png")
  })

  it("strips a leading ./ for cleanliness", () => {
    expect(
      resolveMarkdownImageSrc("./media/foo/img-2.png", PROJECT),
    ).toBe("/Users/me/MyWiki/wiki/media/foo/img-2.png")
  })

  it("resolves nested paths (e.g. user-organized subfolders) under wiki/ root", () => {
    expect(
      resolveMarkdownImageSrc("entities/transformer/diagram.png", PROJECT),
    ).toBe("/Users/me/MyWiki/wiki/entities/transformer/diagram.png")
  })

  it("treats an absolute POSIX path as a literal filesystem path", () => {
    expect(
      resolveMarkdownImageSrc("/var/data/screenshot.png", PROJECT),
    ).toBe("/var/data/screenshot.png")
  })

  it("treats a Windows drive-letter path as absolute", () => {
    expect(
      resolveMarkdownImageSrc("C:/Users/me/Pictures/x.png", PROJECT),
    ).toBe("C:/Users/me/Pictures/x.png")
  })

  it("treats a UNC path as absolute", () => {
    expect(
      resolveMarkdownImageSrc("\\\\share\\folder\\img.png", PROJECT),
    ).toBe("\\\\share\\folder\\img.png")
  })

  it("returns the raw src unchanged when no project is loaded", () => {
    // Resolver is intentionally safe to call before a project is
    // open — preview surfaces (welcome screen, settings) might
    // render markdown without a project context.
    expect(resolveMarkdownImageSrc("media/foo/img.png", null)).toBe(
      "media/foo/img.png",
    )
  })

  it("normalizes Windows backslashes in projectPath via path-utils", () => {
    // normalizePath flips backslashes, so the assembled abs path
    // uses forward slashes regardless of OS.
    expect(
      resolveMarkdownImageSrc(
        "media/x/y.png",
        "C:\\Users\\me\\MyWiki",
      ),
    ).toBe("C:/Users/me/MyWiki/wiki/media/x/y.png")
  })

  it("returns empty string verbatim for empty src", () => {
    expect(resolveMarkdownImageSrc("", PROJECT)).toBe("")
  })
})
