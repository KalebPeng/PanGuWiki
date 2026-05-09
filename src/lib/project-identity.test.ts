import { afterEach, describe, expect, it, vi } from "vitest"
import { generateProjectId } from "./project-identity"

describe("generateProjectId", () => {
  const originalCrypto = globalThis.crypto

  afterEach(() => {
    vi.unstubAllGlobals()
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      configurable: true,
    })
  })

  it("uses crypto.randomUUID when available", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: () => "fixed-id" },
      configurable: true,
    })

    expect(generateProjectId()).toBe("fixed-id")
  })

  it("falls back when crypto.randomUUID is unavailable", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: {
        getRandomValues: (bytes: Uint8Array) => {
          for (let i = 0; i < bytes.length; i++) bytes[i] = i
          return bytes
        },
      },
      configurable: true,
    })

    expect(generateProjectId()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f")
  })
})
