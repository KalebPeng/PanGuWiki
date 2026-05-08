/**
 * Shared HTTP fetch helper using the browser's native fetch API.
 * Every part of the app that hits a user-configured URL (LLM chat,
 * embedding, web search) should import from here so CORS handling
 * can be centralized.
 *
 * In unit tests (vitest / node), falls back to `globalThis.fetch`.
 */

let nativeFetchPromise: Promise<typeof globalThis.fetch> | null = null

/**
 * Returns the platform's native fetch function.
 * Call this once per request:
 *
 *   const httpFetch = await getHttpFetch()
 *   const response = await httpFetch(url, opts)
 */
export function getHttpFetch(): Promise<typeof globalThis.fetch> {
  if (!nativeFetchPromise) {
    // Bind so `this === globalThis` — Node's fetch requires it.
    nativeFetchPromise = Promise.resolve(globalThis.fetch.bind(globalThis))
  }
  return nativeFetchPromise
}

/**
 * Detect fetch-level network failures across Tauri's different webview
 * backends. Each platform phrases the same failure class differently:
 *
 *   macOS / iOS (WebKit):       Error,  message === "Load failed"
 *   Windows    (Edge WebView2): TypeError, message === "Failed to fetch"
 *   Linux      (WebKitGTK):     Error,  message === "Load failed"
 *
 * They all collapse DNS / TLS / connection-refused / CORS-preflight
 * into a single opaque error with no structured detail. The only
 * reliable cross-platform signal is "not an AbortError AND one of
 * these generic network error shapes", which this helper centralizes.
 */
export function isFetchNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.name === "AbortError") return false
  // Chromium / Edge WebView2
  if (err.name === "TypeError") return true
  // WebKit (macOS / Linux GTK)
  if (err.message === "Load failed") return true
  // Chromium mid-stream drop
  if (err.message === "Failed to fetch") return true
  if (err.message.includes("network error")) return true
  return false
}
