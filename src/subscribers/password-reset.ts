import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Emails a reset link when `generateResetPasswordTokenWorkflow` runs (the
 * store's "forgot password" route).
 *
 * The event payload is `{ entity_id, actor_type, token, metadata }`, where
 * `token` is the JWT the reset UI must submit back.
 */
export default async function passwordResetHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  entity_id: string
  actor_type: string
  token: string
  metadata?: Record<string, unknown>
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const notificationService = container.resolve(Modules.NOTIFICATION)

  const to = data?.entity_id

  if (!to) {
    logger.warn("password-reset: event carried no recipient, skipping.")
    return
  }

  const storefrontUrl = process.env.STOREFRONT_URL
  const countryCode = process.env.STOREFRONT_DEFAULT_COUNTRY_CODE || "om"

  const resetUrl = storefrontUrl
    ? `${storefrontUrl}/${countryCode}/reset-password?token=${encodeURIComponent(
        data.token
      )}`
    : undefined

  try {
    await notificationService.createNotifications({
      to,
      channel: "email",
      template: "password-reset",
      trigger_type: "auth.password_reset",
      data: {
        store_name: process.env.SMTP_STORE_NAME || "Perfume Shop",
        reset_url: resetUrl,
      },
    })
  } catch (error) {
    logger.error(
      `password-reset: failed to send reset email to "${to}": ${
        (error as Error).message
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
}
