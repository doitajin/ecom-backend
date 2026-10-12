/**
 * Throwaway verification harness for the SMTP notification provider.
 *
 * Not part of the app: it spins up an in-process SMTP server, points the real
 * provider at it, and drives all four templates so we can assert on the raw
 * messages that actually reach the wire.
 *
 * Requires the dev-only test deps, which are intentionally not declared:
 *   npm install --no-save smtp-server
 *
 * Run from `apps/backend`:
 *   node scripts/verify-smtp-provider.mjs
 */
import { SMTPServer } from "smtp-server"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

// The provider is authored in TypeScript, so mirror what Medusa does at runtime
// and register a TS loader before requiring it.
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

const received = []

const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  onData(stream, session, callback) {
    let raw = ""
    stream.on("data", (chunk) => {
      raw += chunk.toString("utf8")
    })
    stream.on("end", () => {
      received.push({ raw, recipients: session.envelope.rcptTo.map((r) => r.address) })
      callback()
    })
  },
})

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
const port = server.server.address().port

// Load framework + the provider exactly as the Medusa module loader would.
// The provider path mirrors `medusa-config.ts`, resolved from the backend dir.
const { Modules } = require("@medusajs/framework/utils")
const providerPath = require.resolve(
  "./src/modules/notifications/smtp/index.ts",
  { paths: [process.cwd()] }
)
const providerModule = require(providerPath)
const moduleProvider = providerModule.default ?? providerModule

const services = moduleProvider.services ?? []
const Service = services[0]

const logger = {
  info: () => {},
  warn: (m) => console.log("   [warn]", m),
  error: (m) => console.log("   [error]", m),
  debug: () => {},
}

const options = {
  channels: ["email"],
  host: "127.0.0.1",
  port,
  secure: false,
  from: "Perfume Shop <no-reply@example.com>",
}

let failures = 0
const check = (label, ok, detail = "") => {
  if (!ok) failures++
  console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` -> ${detail}` : ""}`)
}

console.log("== 1. ModuleProvider contract ==")
check("default export is a ModuleProvider", Boolean(moduleProvider?.services))
check("exposes 1 service", services.length === 1, `got ${services.length}`)
check("service class name is SmtpNotificationService", Service?.name === "SmtpNotificationService", Service?.name)
check("static identifier === 'smtp'", Service?.identifier === "smtp", Service?.identifier)
check("targets the notification module", moduleProvider?.moduleName === Modules.NOTIFICATION || moduleProvider?.module === Modules.NOTIFICATION, `moduleName=${moduleProvider?.moduleName} module=${moduleProvider?.module}`)

console.log("\n== 2. validateOptions guards ==")
try {
  Service.validateOptions(options)
  check("accepts valid options", true)
} catch (e) {
  check("accepts valid options", false, e.message)
}

try {
  Service.validateOptions({ ...options, channels: [] })
  check("rejects missing 'email' channel", false, "no throw")
} catch {
  check("rejects missing 'email' channel", true)
}

try {
  Service.validateOptions({ ...options, from: undefined })
  check("rejects missing From address", false, "no throw")
} catch {
  check("rejects missing From address", true)
}

const service = new Service({ logger }, options)

console.log("\n== 3. send all four templates over real SMTP ==")
const cases = [
  {
    template: "order-placed",
    expectSubject: "Order confirmed #1042",
    data: {
      display_id: 1042,
      first_name: "Layla",
      currency_code: "omr",
      items: [
        { title: "Amber Oud", subtitle: "50ml", quantity: 2, unit_price: 12500, total: 25000 },
        { title: "Rose Taif", subtitle: "100ml", quantity: 1, total: 18000 },
      ],
      subtotal: 43000,
      shipping_total: 2000,
      tax_total: 2150,
      total: 47150,
      shipping_address: {
        first_name: "Layla",
        last_name: "Al Rashdi",
        address_1: "12 Al Qurm St",
        city: "Muscat",
        postal_code: "112",
        country_code: "om",
      },
      order_url: "http://localhost:8000/om/account/orders/details/order_123",
    },
  },
  {
    template: "order-shipped",
    expectSubject: "Your order #1042 has shipped",
    data: {
      display_id: 1042,
      first_name: "Layla",
      currency_code: "omr",
      tracking_numbers: ["OM123456789"],
      order_url: "http://localhost:8000/om/account/orders/details/order_123",
    },
  },
  {
    template: "customer-email-verification",
    expectSubject: "Confirm your email address",
    data: {
      code: "482913",
      confirm_url: "http://localhost:8000/om/verify-account?token=482913",
      expires_in_minutes: 15,
    },
  },
  {
    template: "password-reset",
    expectSubject: "Reset your password",
    data: { reset_url: "http://localhost:8000/om/reset-password?token=jwt.abc.def" },
  },
]

const results = []
for (const c of cases) {
  const result = await service.send({
    to: "buyer@example.com",
    channel: "email",
    template: c.template,
    data: c.data,
  })
  results.push(result)
  check(`${c.template} returned a messageId`, Boolean(result?.id), result?.id)
}

console.log("\n== 4. unknown template fails loudly ==")
try {
  await service.send({ to: "x@example.com", channel: "email", template: "nope", data: {} })
  check("unknown template throws", false, "no throw")
} catch (e) {
  check("unknown template throws", true, e.constructor?.name)
}

console.log("\n== 5. wire assertions ==")
check("4 messages received", received.length === 4, `got ${received.length}`)

const find = (subject) => received.find((m) => m.raw.includes(subject))

const placed = find("Order confirmed #1042")
check("order-placed delivered", Boolean(placed))
if (placed) {
  check("order-placed has HTML part", /text\/html/i.test(placed.raw))
  check("order-placed has plain-text part", /text\/plain/i.test(placed.raw))
  check("order-placed shows OMR total", /OMR/.test(placed.raw), "no OMR in body")
  check("order-placed lists a line item", /Amber Oud/.test(placed.raw))
  check("order-placed includes shipping city", /Muscat/.test(placed.raw))
}

const shipped = find("has shipped")
check("order-shipped delivered", Boolean(shipped))
if (shipped) {
  check("order-shipped includes tracking number", /OM123456789/.test(shipped.raw))
}

const verify = find("Confirm your email address")
check("verification email delivered", Boolean(verify))
if (verify) {
  check("verification email carries the 6-digit code", /482913/.test(verify.raw))
  check("verification link points at /verify-account?token=", /\/om\/verify-account\?token=482913/.test(verify.raw))
}

const reset = find("Reset your password")
check("password-reset delivered", Boolean(reset))
if (reset) {
  check("reset link points at /reset-password?token=", /\/om\/reset-password\?token=/.test(reset.raw))
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`)

server.close()
process.exit(failures === 0 ? 0 : 1)
