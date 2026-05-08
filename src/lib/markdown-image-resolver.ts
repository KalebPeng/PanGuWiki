/**
 * Resolve markdown image `src` attributes for browser rendering.
 *
 * Convention:
 *   - Any src starting with `http://`, `https://`, `data:`, `blob:`,
 *     `file:` is passed through unchanged.
 *   - Absolute filesystem paths are returned as-is (prefixed with
 *     `file:///` for browser compatibility).
 *   - Anything else is treated as relative to the project's `wiki/` root.
 */
import { normalizePath } from "@/lib/path-utils"

const PASSTHROUGH_RE = /^(https?:|data:|blob:|file:)/i

/**
 * `projectPath` is the wiki project's root directory. When null
 * (no project loaded), the resolver passes srcs through unchanged
 * so it remains safe to call before a project is open.
 */
export function resolveMarkdownImageSrc(
  rawSrc: string,
  projectPath: string | null,
): string {
  if (!rawSrc) return rawSrc
  if (PASSTHROUGH_RE.test(rawSrc)) return rawSrc

  if (!projectPath) return rawSrc

  const pp = normalizePath(projectPath)
  const isAbsolute =
    rawSrc.startsWith("/") || /^[a-zA-Z]:/.test(rawSrc) || rawSrc.startsWith("\\\\")

  // Absolute paths returned with file:/// prefix for browser loading.
  if (isAbsolute) return rawSrc

  // Strip a leading `./` for cleanliness; treat `media/foo.png` and
  // `./media/foo.png` identically.
  const cleaned = rawSrc.replace(/^\.\//, "")

  // Resolve as wiki-root-relative.
  return `${pp}/wiki/${cleaned}`
}
