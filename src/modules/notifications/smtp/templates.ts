/**
 * Email templates for the SMTP notification provider.
 *
 * Deliberately plain: raw HTML strings with inline styles so they render in
 * every client without a build step, a template engine, or a network dependency.
 * `text` is always provided alongside `html` - some clients and spam filters
 * score HTML-only mail poorly.
 *
 * This store trades in OMR only, so totals are formatted in OMR.
 */

import { MedusaError } from "@medusajs/framework/utils"

export type RenderedEmail = {
  subject: string
  html: string
  text: string
}

export type OrderLine = {
  title: string
  subtitle?: string | null
  quantity: number
  unit_price?: number | null
  total?: number | null
}

export type OrderEmailData = {
  store_name?: string
  display_id?: number | string
  email?: string
  first_name?: string | null
  currency_code?: string
  items?: OrderLine[]
  subtotal?: number | null
  shipping_total?: number | null
  tax_total?: number | null
  total?: number | null
  shipping_address?: {
    first_name?: string | null
    last_name?: string | null
    address_1?: string | null
    address_2?: string | null
    city?: string | null
    province?: string | null
    postal_code?: string | null
    country_code?: string | null
  } | null
  tracking_numbers?: string[]
  order_url?: string
}

export type VerificationEmailData = {
  store_name?: string
  code?: string
  confirm_url?: string
  expires_in_minutes?: number
}

export type PasswordResetEmailData = {
  store_name?: string
  reset_url?: string
}

const BRAND = "#1f1b16"
const ACCENT = "#b08d57"
const MUTED = "#6b6259"
const BORDER = "#e6e0d8"

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Formats a Medusa amount for display. Medusa v2 does not scale amounts: a
 * `Price`'s `amount`, and every cart/order total derived from it, is already in
 * the currency's major unit, so the number is formatted as-is. The decimal
 * count comes from `Intl`, so this stays correct if the store adds a currency.
 */
export function formatMoney(
  amount: number | null | undefined,
  currencyCode = "omr"
): string {
  const code = (currencyCode || "omr").toUpperCase()
  const value = typeof amount === "number" ? amount : 0

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(value)
  } catch {
    // Unknown currency code - fall back to a plain number rather than throwing.
    return `${value} ${code}`
  }
}

function shell(
  storeName: string,
  heading: string,
  introHtml: string,
  bodyHtml: string
): string {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f2ee;font-family:Helvetica,Arial,sans-serif;color:${BRAND};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f2ee;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px;border-bottom:1px solid ${BORDER};">
                <div style="font-size:18px;letter-spacing:2px;text-transform:uppercase;color:${ACCENT};font-weight:bold;">${escapeHtml(storeName)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${BRAND};">${escapeHtml(heading)}</h1>
                <div style="font-size:15px;line-height:1.6;color:${BRAND};">${introHtml}</div>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid ${BORDER};font-size:12px;line-height:1.5;color:${MUTED};">
                This message was sent by ${escapeHtml(storeName)}. If you did not expect it, you can safely ignore it.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="background:${ACCENT};border-radius:6px;">
        <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`
}

function itemsTableHtml(items: OrderLine[], currency: string): string {
  const rows = items
    .map((item) => {
      const lineTotal =
        typeof item.total === "number"
          ? item.total
          : (item.unit_price ?? 0) * (item.quantity ?? 0)

      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid ${BORDER};font-size:14px;color:${BRAND};">
          ${escapeHtml(item.title)}
          ${
            item.subtitle
              ? `<div style="font-size:12px;color:${MUTED};margin-top:2px;">${escapeHtml(item.subtitle)}</div>`
              : ""
          }
          <div style="font-size:12px;color:${MUTED};margin-top:2px;">Qty ${escapeHtml(item.quantity)}</div>
        </td>
        <td align="right" style="padding:10px 0;border-bottom:1px solid ${BORDER};font-size:14px;color:${BRAND};white-space:nowrap;vertical-align:top;">
          ${escapeHtml(formatMoney(lineTotal, currency))}
        </td>
      </tr>`
    })
    .join("")

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-collapse:collapse;">
    ${rows}
  </table>`
}

function totalsTableHtml(data: OrderEmailData): string {
  const currency = data.currency_code ?? "omr"
  const row = (label: string, value: number | null | undefined, bold = false) =>
    typeof value === "number"
      ? `<tr>
          <td style="padding:6px 0;font-size:14px;color:${bold ? BRAND : MUTED};${bold ? "font-weight:bold;" : ""}">${escapeHtml(label)}</td>
          <td align="right" style="padding:6px 0;font-size:14px;color:${BRAND};white-space:nowrap;${bold ? "font-weight:bold;" : ""}">${escapeHtml(formatMoney(value, currency))}</td>
        </tr>`
      : ""

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;border-top:1px solid ${BORDER};padding-top:8px;">
    ${row("Subtotal", data.subtotal)}
    ${row("Shipping", data.shipping_total)}
    ${row("Tax", data.tax_total)}
    ${row("Total", data.total, true)}
  </table>`
}

export function renderOrderPlaced(data: OrderEmailData): RenderedEmail {
  const storeName = data.store_name ?? "Perfume Shop"
  const currency = data.currency_code ?? "omr"
  const orderNumber = data.display_id != null ? `#${data.display_id}` : ""
  const greeting = data.first_name ? `Hi ${escapeHtml(data.first_name)},` : "Hello,"
  const items = data.items ?? []

  const html = shell(
    storeName,
    `Thank you for your order ${orderNumber}`.trim(),
    `<p style="margin:0 0 8px;">${greeting}</p>
     <p style="margin:0;">We have received your order and are preparing it now. A confirmation of the details is below.</p>`,
    `${itemsTableHtml(items, currency)}
     ${totalsTableHtml(data)}
     ${
       data.shipping_address
         ? `<h2 style="margin:32px 0 8px;font-size:15px;color:${BRAND};">Shipping to</h2>
            <div style="font-size:14px;line-height:1.6;color:${MUTED};">
              ${escapeHtml(
                [
                  [data.shipping_address.first_name, data.shipping_address.last_name]
                    .filter(Boolean)
                    .join(" "),
                  data.shipping_address.address_1,
                  data.shipping_address.address_2,
                  [data.shipping_address.city, data.shipping_address.province]
                    .filter(Boolean)
                    .join(", "),
                  data.shipping_address.postal_code,
                  data.shipping_address.country_code?.toUpperCase(),
                ]
                  .filter(Boolean)
                  .join("<br />")
              )}
            </div>`
         : ""
     }
     ${
       data.order_url
         ? button("View your order", data.order_url)
         : ""
     }`
  )

  const textLines = [
    `Thank you for your order ${orderNumber}`.trim(),
    "",
    data.first_name ? `Hi ${data.first_name},` : "Hello,",
    "We have received your order and are preparing it now.",
    "",
    ...items.map((item) => {
      const lineTotal =
        typeof item.total === "number"
          ? item.total
          : (item.unit_price ?? 0) * (item.quantity ?? 0)
      return `${item.quantity} x ${item.title}${
        item.subtitle ? ` (${item.subtitle})` : ""
      } - ${formatMoney(lineTotal, currency)}`
    }),
    "",
    `Subtotal: ${formatMoney(data.subtotal, currency)}`,
    typeof data.shipping_total === "number"
      ? `Shipping: ${formatMoney(data.shipping_total, currency)}`
      : "",
    typeof data.tax_total === "number"
      ? `Tax: ${formatMoney(data.tax_total, currency)}`
      : "",
    `Total: ${formatMoney(data.total, currency)}`,
    data.order_url ? `\nView your order: ${data.order_url}` : "",
  ].filter((line) => line !== "")

  return {
    subject: `Order confirmed ${orderNumber}`.trim(),
    html,
    text: textLines.join("\n"),
  }
}

export function renderOrderShipped(data: OrderEmailData): RenderedEmail {
  const storeName = data.store_name ?? "Perfume Shop"
  const currency = data.currency_code ?? "omr"
  const orderNumber = data.display_id != null ? `#${data.display_id}` : ""
  const greeting = data.first_name ? `Hi ${escapeHtml(data.first_name)},` : "Hello,"
  const tracking = data.tracking_numbers ?? []
  const items = data.items ?? []

  const trackingHtml = tracking.length
    ? `<h2 style="margin:32px 0 8px;font-size:15px;color:${BRAND};">Tracking</h2>
       <div style="font-size:14px;line-height:1.6;color:${MUTED};">
         ${tracking.map((t) => escapeHtml(t)).join("<br />")}
       </div>`
    : ""

  const html = shell(
    storeName,
    `Your order ${orderNumber} has shipped`.trim(),
    `<p style="margin:0 0 8px;">${greeting}</p>
     <p style="margin:0;">Good news - your order is on its way.</p>`,
    `${trackingHtml}
     ${
       items.length
         ? `<h2 style="margin:32px 0 8px;font-size:15px;color:${BRAND};">Items shipped</h2>
            ${itemsTableHtml(items, currency)}`
         : ""
     }
     ${data.order_url ? button("View your order", data.order_url) : ""}`
  )

  return {
    subject: `Your order ${orderNumber} has shipped`.trim(),
    html,
    text: [
      `Your order ${orderNumber} has shipped`.trim(),
      "",
      data.first_name ? `Hi ${data.first_name},` : "Hello,",
      "Good news - your order is on its way.",
      tracking.length ? `\nTracking:\n${tracking.join("\n")}` : "",
      data.order_url ? `\nView your order: ${data.order_url}` : "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  }
}

export function renderCustomerEmailVerification(
  data: VerificationEmailData
): RenderedEmail {
  const storeName = data.store_name ?? "Perfume Shop"
  const minutes = data.expires_in_minutes ?? 15

  const codeBlock = data.code
    ? `<div style="margin:24px 0;padding:16px 20px;background:#faf8f5;border:1px solid ${BORDER};border-radius:6px;text-align:center;">
         <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};margin-bottom:6px;">Your verification code</div>
         <div style="font-size:28px;letter-spacing:6px;font-weight:bold;color:${BRAND};">${escapeHtml(data.code)}</div>
       </div>`
    : ""

  const html = shell(
    storeName,
    "Confirm your email address",
    `<p style="margin:0;">Enter the code below to finish setting up your account, or use the button if you prefer.</p>`,
    `${codeBlock}
     ${data.confirm_url ? button("Confirm my email", data.confirm_url) : ""}
     <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">This link and code expire in ${escapeHtml(minutes)} minutes.</p>`
  )

  return {
    subject: `Confirm your email address`,
    html,
    text: [
      "Confirm your email address",
      "",
      data.code ? `Your verification code: ${data.code}` : "",
      data.confirm_url ? `Or confirm here: ${data.confirm_url}` : "",
      `This link and code expire in ${minutes} minutes.`,
    ]
      .filter((line) => line !== "")
      .join("\n"),
  }
}

export function renderPasswordReset(data: PasswordResetEmailData): RenderedEmail {
  const storeName = data.store_name ?? "Perfume Shop"

  const html = shell(
    storeName,
    "Reset your password",
    `<p style="margin:0;">We received a request to reset the password on your account. Use the button below to choose a new one.</p>`,
    `${data.reset_url ? button("Reset my password", data.reset_url) : ""}
     <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">If you did not request this, you can ignore this email and your password will stay the same.</p>`
  )

  return {
    subject: "Reset your password",
    html,
    text: [
      "Reset your password",
      "",
      "We received a request to reset the password on your account.",
      data.reset_url ? `Reset it here: ${data.reset_url}` : "",
      "If you did not request this, you can ignore this email.",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  }
}

/**
 * Template registry. The provider resolves `notification.template` against this
 * map so unknown templates fail loudly instead of sending an empty email.
 */
export const templates: Record<
  string,
  (data: Record<string, unknown>) => RenderedEmail
> = {
  "order-placed": (data) => renderOrderPlaced(data as OrderEmailData),
  "order-shipped": (data) => renderOrderShipped(data as OrderEmailData),
  "customer-email-verification": (data) =>
    renderCustomerEmailVerification(data as VerificationEmailData),
  "password-reset": (data) => renderPasswordReset(data as PasswordResetEmailData),
}

export function renderTemplate(
  template: string,
  data: Record<string, unknown> | null | undefined
): RenderedEmail {
  const renderer = templates[template]

  if (!renderer) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unknown email template "${template}". Available templates: ${Object.keys(
        templates
      ).join(", ")}`
    )
  }

  return renderer(data ?? {})
}
