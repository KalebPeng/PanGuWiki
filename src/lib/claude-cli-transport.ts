/**
 * Claude Code CLI subprocess transport.
 *
 * Two implementations:
 *  - Tauri (default): uses Tauri events and invoke()
 *  - .NET (VITE_DOTNET_BACKEND=1): uses WebSocket at ws://localhost:5200/ws/claude
 */

import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type { LlmConfig } from "@/stores/wiki-store"
import type { ChatMessage, RequestOverrides } from "./llm-providers"
import type { StreamCallbacks } from "./llm-client"

const USE_DOTNET = import.meta.env.VITE_DOTNET_BACKEND === '1'
const DOTNET_WS_URL = (() => {
  const base = import.meta.env.VITE_DOTNET_URL ?? 'http://localhost:5200'
  return base.replace(/^http/, 'ws')
})()

// ── Public parse helpers (unchanged) ─────────────────────────────────────

export function createClaudeCodeStreamParser() {
  let sawDelta = false
  let emittedFromAssistant = ""

  return function parseLine(rawLine: string): string | null {
    const line = rawLine.trim()
    if (!line) return null

    let evt: unknown
    try {
      evt = JSON.parse(line)
    } catch {
      return null
    }

    if (!evt || typeof evt !== "object") return null
    const obj = evt as Record<string, unknown>
    const type = obj.type

    if (type === "stream_event") {
      const event = obj.event as Record<string, unknown> | undefined
      if (event?.type === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          sawDelta = true
          return delta.text
        }
      }
      return null
    }

    if (type === "assistant") {
      const message = obj.message as Record<string, unknown> | undefined
      const content = message?.content
      if (!Array.isArray(content)) return null
      const text = content
        .map((c) => {
          const cc = c as Record<string, unknown>
          return cc.type === "text" && typeof cc.text === "string" ? cc.text : ""
        })
        .join("")
      if (!text) return null

      if (sawDelta) return null
      if (text.startsWith(emittedFromAssistant)) {
        const novel = text.slice(emittedFromAssistant.length)
        emittedFromAssistant = text
        return novel || null
      }
      emittedFromAssistant = text
      return text
    }

    return null
  }
}

// ── Main export ───────────────────────────────────────────────────────────

export async function streamClaudeCodeCli(
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  overrides?: RequestOverrides,
): Promise<void> {
  if (USE_DOTNET) {
    return streamClaudeCodeCliDotnet(config, messages, callbacks, signal)
  }
  return streamClaudeCodeCliTauri(config, messages, callbacks, signal, overrides)
}

// ── .NET WebSocket implementation ─────────────────────────────────────────

async function streamClaudeCodeCliDotnet(
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const { onToken, onDone, onError } = callbacks
  const streamId = crypto.randomUUID()
  const parse = createClaudeCodeStreamParser()
  let finished = false

  const finish = (cb: () => void) => {
    if (finished) return
    finished = true
    cb()
  }

  let ws: WebSocket
  try {
    ws = new WebSocket(`${DOTNET_WS_URL}/ws/claude`)
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)))
    return
  }

  const cleanup = () => {
    try { ws.close() } catch { /* ignore */ }
  }

  const abortListener = () => {
    try { ws.send(JSON.stringify({ type: 'kill', streamId })) } catch { /* ignore */ }
    cleanup()
    finish(onDone)
  }
  signal?.addEventListener('abort', abortListener)

  try {
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({ type: 'spawn', streamId, model: config.model, messages }))
          resolve()
        } catch (err) {
          reject(err)
        }
      }
      ws.onerror = () => reject(new Error('WebSocket connection to .NET backend failed — is it running on port 5200?'))
    })

    await new Promise<void>((resolve) => {
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as Record<string, unknown>
        if (msg.streamId !== streamId) return

        if (msg.type === 'line') {
          const token = parse(msg.payload as string)
          if (token !== null) onToken(token)
        } else if (msg.type === 'done') {
          const code = msg.code as number | null
          const stderr = (msg.stderr as string | undefined)?.trim() ?? ''
          if (code !== null && code !== undefined && code !== 0) {
            finish(() => onError(new Error(buildExitError(code, stderr))))
          } else {
            finish(onDone)
          }
          resolve()
        } else if (msg.type === 'error') {
          finish(() => onError(new Error(msg.message as string)))
          resolve()
        }
      }
      ws.onclose = () => { finish(onDone); resolve() }
    })
  } catch (err) {
    finish(() => onError(err instanceof Error ? err : new Error(String(err))))
  } finally {
    signal?.removeEventListener('abort', abortListener)
    cleanup()
  }
}

// ── Tauri implementation (unchanged from original) ────────────────────────

type SpawnPayload = Record<string, unknown> & {
  streamId: string
  model: string
  messages: ChatMessage[]
}

async function streamClaudeCodeCliTauri(
  config: LlmConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  overrides?: RequestOverrides,
): Promise<void> {
  const { onToken, onDone, onError } = callbacks

  if (import.meta.env?.DEV && overrides) {
    for (const key of ["temperature", "top_p", "top_k", "max_tokens", "stop"] as const) {
      if (overrides[key] !== undefined) {
        // eslint-disable-next-line no-console
        console.warn(`[claude-code] ignoring unsupported override "${key}": CLI has no equivalent flag`)
      }
    }
  }

  const streamId = crypto.randomUUID()
  const parse = createClaudeCodeStreamParser()

  let unlistenData: UnlistenFn | undefined
  let unlistenDone: UnlistenFn | undefined
  let finished = false

  const UNPARSED_BUFFER_CAP = 4096
  const unparsedLines: string[] = []
  let unparsedSize = 0
  function captureUnparsed(line: string) {
    if (unparsedSize >= UNPARSED_BUFFER_CAP) return
    const trimmed = line.trim()
    if (trimmed.length === 0) return
    unparsedLines.push(line)
    unparsedSize += line.length + 1
  }

  const cleanup = () => {
    unlistenData?.()
    unlistenDone?.()
  }

  const finishWith = (cb: () => void) => {
    if (finished) return
    finished = true
    cleanup()
    cb()
  }

  const abortListener = () => {
    void invoke("claude_cli_kill", { streamId }).catch(() => {})
    finishWith(onDone)
  }
  signal?.addEventListener("abort", abortListener)

  try {
    unlistenData = await listen<string>(`claude-cli:${streamId}`, (event) => {
      const token = parse(event.payload)
      if (token !== null) {
        onToken(token)
      } else {
        captureUnparsed(event.payload)
      }
    })

    unlistenDone = await listen<{ code: number | null; stderr: string }>(
      `claude-cli:${streamId}:done`,
      (event) => {
        const code = event.payload?.code
        const stderr = event.payload?.stderr?.trim() ?? ""
        if (code !== null && code !== undefined && code !== 0) {
          finishWith(() =>
            onError(
              new Error(buildExitError(code, stderr, unparsedLines.join("\n"))),
            ),
          )
        } else {
          finishWith(onDone)
        }
      },
    )

    const payload: SpawnPayload = {
      streamId,
      model: config.model,
      messages,
    }
    await invoke("claude_cli_spawn", payload)
  } catch (err) {
    finishWith(() => {
      const message = err instanceof Error ? err.message : String(err)
      if (/not found|No such file|executable file not found/i.test(message)) {
        onError(new Error(
          "Claude Code CLI not found. Install `claude` (https://www.anthropic.com/claude-code) or pick a different provider.",
        ))
      } else {
        onError(err instanceof Error ? err : new Error(message))
      }
    })
  } finally {
    signal?.removeEventListener("abort", abortListener)
  }
}

// ── Error formatting (unchanged) ──────────────────────────────────────────

export function buildExitError(
  code: number,
  stderr: string,
  unparsedStdout: string = "",
): string {
  if (/unauthenticated|please.*log\s*in|authentication.*failed/i.test(stderr)) {
    return [
      "Claude Code CLI is not authenticated.",
      "Please open a terminal and run `claude` to complete the OAuth login,",
      "then retry. (LLM Wiki only spawns the binary — it can't run the",
      "login flow on your behalf.)",
      stderr ? `\n\n— stderr —\n${stderr}` : "",
    ].join(" ").trim()
  }
  if (stderr) {
    return `claude CLI exited with code ${code}: ${stderr}`
  }
  if (unparsedStdout.trim()) {
    return [
      `claude CLI exited with code ${code} (no stderr).`,
      "Captured stdout output that LLM Wiki couldn't parse — pasting it",
      "here so you can see what the CLI actually emitted:\n",
      unparsedStdout.trim(),
    ].join(" ")
  }
  return [
    `claude CLI exited silently with code ${code}.`,
    "No stdout or stderr was captured — try running `claude -p` in a",
    "terminal with the same prompt to see what's wrong, or switch to",
    "the official Anthropic API in Settings.",
  ].join(" ")
}
