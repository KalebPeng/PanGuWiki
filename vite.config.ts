import path from "path"
import { readFileSync, existsSync } from "fs"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const host = process.env.TAURI_DEV_HOST

// Read version from package.json at config-load time so the Settings
// UI can show the running app version without duplicating the string.
const pkgJson = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"))

// Load VITE_* vars from .env.deploy into the build so import.meta.env works
function loadDeployEnv(): Record<string, string> {
  const envPath = path.resolve(__dirname, ".env.deploy")
  if (!existsSync(envPath)) return {}
  const vars: Record<string, string> = {}
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^(VITE_[^=\s]+)=(.*)$/)
    if (m) vars[m[1]] = m[2].trim()
  }
  return vars
}
const deployEnv = loadDeployEnv()

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },

  define: {
    __APP_VERSION__: JSON.stringify(pkgJson.version),
    ...Object.fromEntries(
      Object.entries(deployEnv).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)])
    ),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  test: {
    environment: "node",
    // Loads .env.test.local into process.env for real-LLM tests.
    // The loader itself is a no-op if the file is absent, so this is
    // safe to keep on for every test run.
    setupFiles: ["./src/test-helpers/load-test-env.ts"],
  },
}))
