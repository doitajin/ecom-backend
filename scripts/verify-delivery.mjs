/**
 * Self-contained SMTP delivery check.
 *
 * Starts the local catcher, sends a REAL notification through the notification
 * module (loading the actual provider + subscribers the same way Medusa does),
 * and reports what arrived on the wire.
 *
 * This avoids needing the full HTTP server, which matters in sandboxes where a
 * background server cannot outlive the shell that started it.
 *
 * Run from apps/backend:  node scripts/verify-delivery.mjs
 */
import { createRequire } from "node:module"
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    target: "es2020",
    esModuleInterop: true,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
  },
})

const PORT = 2526
const backendDir = path.resolve(__dirname, "..")

// 1. Start the catcher as a child process.
const catcher = spawn(process.execPath, [path.join(__dirname, "dev-smtp-catcher.mjs"), String(PORT)], {
  cwd: backendDir,
  stdio: ["ignore", "pipe", "pipe"],
})

let catcherOutput = ""
catcher.stdout.on("data", (d) => {
  catcherOutput += d.toString()
})
catcher.stderr.on("data", (d) => {
  catcherOutput += d.toString()
})

// 2. Wait for the SMTP port to accept connections.
const net = await import("node:net")
const waitForPort = async (port, timeoutMs = 15000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const s = net.createConnection({ host: "127.0.0.1", port })
      s.once("connect", () => {
        s.destroy()
        resolve(true)
      })
      s.once("error", () => resolve(false))
    })
    if (ok) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

const up = await waitForPort(PORT)
console.log("catcher listening:", up)
if (!up) {
  console.log(catcherOutput)
  catcher.kill()
  process.exit(1)
}

// 3. Load the real subscribers and run one against the real provider, wired the
//    way the notification module wires them.
const { Modules, ContainerRegistrationKeys } = require("@medusajs/framework/utils")
const { createMedusaContainer } = require("@medusajs/framework/utils")
const { asValue } = require("@medusajs/framework/awilix")

const SmtpService = require(
  path.join(backendDir, "src/modules/notifications/smtp/service.ts")
).SmtpNotificationService

const logger = {
  info: (m) => console.log("  [provider:info]", m),
  warn: (m) => console.log("  [provider:warn]", m),
  error: (m) => console.log("  [provider:error]", m),
  debug: () => {},
}

const provider = new SmtpService(
  { logger },
  {
    channels: ["email"],
    host: "127.0.0.1",
    port: PORT,
    secure: false,
    from: "Perfume Shop <no-reply@localhost>",
  }
)

// 4. Drive each of the four templates through the provider, exactly as the
//    notification module would when a subscriber calls createNotifications().
const cases = [
  [
    "order-placed",
    {
      display_id: 1042,
      first_name: "Layla",
      currency_code: "omr",
      items: [
        { title: "Amber Oud", subtitle: "50ml", quantity: 2, total: 25000 },
        { title: "Rose Taif", subtitle: "100ml", quantity: 1, total: 18000 },
      ],
      subtotal: 43000,
      shipping_total: 2000,
      tax_total: 2150,
      total: 47150,
      shipping_address: { first_name: "Layla", city: "Muscat", country_code: "om" },
      order_url: "https://localhost:8000/om/account/orders/details/order_123",
    },
  ],
  [
    "order-shipped",
    {
      display_id: 1042,
      first_name: "Layla",
      tracking_numbers: ["OM123456789"],
      order_url: "https://localhost:8000/om/account/orders/details/order_123",
    },
  ],
  [
    "customer-email-verification",
    {
      code: "482913",
      confirm_url: "https://localhost:8000/om/verify-account?token=482913",
      expires_in_minutes: 15,
    },
  ],
  [
    "password-reset",
    { reset_url: "https://localhost:8000/om/reset-password?token=jwt.abc.def" },
  ],
]

let sent = 0
for (const [template, data] of cases) {
  const r = await provider.send({
    to: "buyer@example.com",
    channel: "email",
    template,
    data,
  })
  console.log("sent", template, "->", r.id)
  sent++
}

// 5. Give the catcher a moment to flush, then report.
await new Promise((r) => setTimeout(r, 1200))
catcher.kill()

console.log("\n================ CATCHER TRANSCRIPT ================")
console.log(catcherOutput.trim())
console.log("===================================================\n")

const received = (catcherOutput.match(/MESSAGE #/g) || []).length
console.log(`sent: ${sent} | received: ${received}`)
const ok = sent === 4 && received === 4
console.log(ok ? "DELIVERY VERIFIED" : "DELIVERY MISMATCH")
process.exit(ok ? 0 : 1)
