// src/api/sse-client.ts
import { httpPost } from "@/api/dotnet-client"

const BASE_URL = import.meta.env.VITE_DOTNET_URL ?? 'http://localhost:5200'

interface SseTokenResponse {
  token: string
  expiresAt: string
}

interface IngestSseEvent {
  taskId: string
  step: string
  detail: string
  timestamp?: string
  isSnapshot?: boolean
}

type IngestEventHandler = (event: IngestSseEvent) => void

export class IngestSseClient {
  private es: EventSource | null = null
  private token: string | null = null
  private lastEventId = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly deptId: string,
    private readonly baseUrl: string,
    private readonly onEvent: IngestEventHandler,
    private readonly onError?: (err: Event) => void,
  ) {}

  async connect(): Promise<void> {
    this.disconnect()
    await this._fetchToken()
    this._openEventSource()
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.es) { this.es.close(); this.es = null }
  }

  private async _fetchToken(): Promise<void> {
    const res = await httpPost<SseTokenResponse>(
      `/api/departments/${this.deptId}/events/token`,
      {},
    )
    this.token = res.token
  }

  private _openEventSource(): void {
    if (!this.token) return
    const url = `${this.baseUrl}/api/departments/${this.deptId}/events?token=${this.token}&lastEventId=${this.lastEventId}`
    this.es = new EventSource(url)

    this.es.onmessage = (e) => {
      if (e.lastEventId) this.lastEventId = parseInt(e.lastEventId, 10)
      try {
        const data = JSON.parse(e.data) as IngestSseEvent
        this.onEvent(data)
      } catch { /* malformed event — ignore */ }
    }

    this.es.onerror = async (e) => {
      this.es?.close()
      this.es = null
      this.onError?.(e)
      // re-fetch token then reconnect (token may have expired)
      this.reconnectTimer = setTimeout(async () => {
        try {
          await this._fetchToken()
          this._openEventSource()
        } catch { /* no network — will retry later */ }
      }, 3000)
    }
  }
}

export { BASE_URL as SSE_BASE_URL }
