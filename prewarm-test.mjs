import { createServer } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"

const cwd = process.cwd()
const root = path.resolve(cwd, ".medusa/client")
const cacheDir = path.resolve(cwd, "node_modules/.cache/medusa-admin-vite")

const server = await createServer({
  root,
  configFile: false,
  cacheDir,
  logLevel: "info",
  optimizeDeps: {
    include: [
      "react", "react/jsx-runtime", "react-dom/client", "react-router-dom",
      "react-router", "react-router/dom", "react-i18next", "@medusajs/ui",
      "@medusajs/dashboard", "@medusajs/js-sdk", "@tanstack/react-query",
    ],
  },
  plugins: [react()],
  server: { middlewareMode: true },
  appType: "spa",
})

// middleware mode: no listen(); touching the transform pipeline starts the optimizer
await server.transformRequest("/entry.jsx").catch((e) => console.log("transform:", e.message))
console.log("PREWARM: transform requested")
await new Promise((r) => setTimeout(r, 45000))
await server.close()
console.log("PREWARM: done")
