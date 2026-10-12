import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Emails the customer a verification code when the storefront calls
 * `sdk.auth.verification.request(...)`.
 *
 * The storefront's `/verify-account` page reads a `token` search param and
 * passes it to `sdk.auth.verification.confirm({ code })`, so the link we send
 * must carry the `code` from the event as that `token`.
 *
 * Routes are country-code prefixed (the storefront defaults to `om`), so the
 * link is built as `/{countryCode}/verify-account?token=...`.
 */
export default async function customerEmailVerificationHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  entity_id: string
  entity_type: string
  code: string
  expires_at?: string
  metadata?: Record<string, unknown>
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const notificationService = container.resolve(Modules.NOTIFICATION)

  // `entity_type` is "email" for the emailpass provider - anything else (phone,
  // etc.) is not something this provider can deliver.
  if (data?.entity_type !== "email") {
    logger.info(
      `customer-email-verification: ignoring verification for entity_type "${data?.entity_type}".`
    )
    return
  }

  const to = data.entity_id

  if (!to) {
    logger.warn("customer-email-verification: event carried no recipient, skipping.")
    return
  }

  const storefrontUrl = process.env.STOREFRONT_URL
  const countryCode = process.env.STOREFRONT_DEFAULT_COUNTRY_CODE || "om"

  const confirmUrl = storefrontUrl
    ? `${storefrontUrl}/${countryCode}/verify-account?token=${encodeURIComponent(
        data.code
      )}`
    : undefined

  let expiresInMinutes = 15
  if (data.expires_at) {
    const expiresAt = new Date(data.expires_at).getTime()
    if (Number.isFinite(expiresAt)) {
      expiresInMinutes = Math.max(
        1,
        Math.round((expiresAt - Date.now()) / 60000)
      )
    }
  }

  try {
    await notificationService.createNotifications({
      to,
      channel: "email",
      template: "customer-email-verification",
      trigger_type: "auth.verification_requested",
      data: {
        store_name: process.env.SMTP_STORE_NAME || "Perfume Shop",
        code: data.code,
        confirm_url: confirmUrl,
        expires_in_minutes: expiresInMinutes,
      },
    })
  } catch (error) {
    logger.error(
      `customer-email-verification: failed to send verification email to "${to}": ${
        (error as Error).message
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: "auth.verification_requested",
}
