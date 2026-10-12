import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import type { Logger, NotificationTypes } from "@medusajs/framework/types"
import nodemailer, { type Transporter } from "nodemailer"
import { renderTemplate } from "./templates"

export type SmtpNotificationServiceOptions = {
  /**
   * Channels this provider serves. Must include "email" - the notification
   * module only skips injecting the built-in Medusa Cloud email provider when a
   * configured provider declares the "email" channel. Without it you end up with
   * two providers fighting over the same channel and the loader throws
   * "Multiple providers are configured for the same channel: email".
   */
  channels?: string[]
  host?: string
  port?: number | string
  secure?: boolean
  user?: string
  pass?: string
  /** Default From header, e.g. "Perfume Shop <no-reply@example.com>". */
  from?: string
  /** Display name used in templates when a store name is not supplied. */
  store_name?: string
}

type InjectedDependencies = {
  logger: Logger
}

/**
 * Sends transactional email over SMTP using nodemailer.
 *
 * Implements the framework's notification provider contract, so it is swapped in
 * exactly like the official local/SendGrid providers and is observable through
 * the notification module's records. Nothing about Medusa core is modified.
 */
export class SmtpNotificationService extends AbstractNotificationProviderService {
  static identifier = "smtp"

  protected config_: SmtpNotificationServiceOptions
  protected logger_: Logger
  protected transporter_: Transporter | null = null

  constructor({ logger }: InjectedDependencies, options: SmtpNotificationServiceOptions) {
    super()

    this.config_ = options ?? {}
    this.logger_ = logger
  }

  /**
   * Validates the provider options at boot. The module loader calls this when
   * registering the provider, so a misconfigured SMTP setup fails at startup
   * with a clear message instead of silently dropping mail at send time.
   */
  static validateOptions(options: SmtpNotificationServiceOptions): void {
    if (!options) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "SMTP notification provider requires options."
      )
    }

    if (!options.channels?.includes("email")) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'SMTP notification provider must declare the "email" channel, otherwise Medusa injects its own email provider for the same channel.'
      )
    }

    // Note: a key present but left blank in `.env` (e.g. `SMTP_HOST=`) arrives
    // here as an empty string and is treated as missing, which is the intent.
    if (!options.host) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'SMTP notification provider is missing SMTP_HOST. Set SMTP_HOST (and SMTP_FROM) in apps/backend/.env. For local testing without a real mail account, run Mailpit (docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit) and use SMTP_HOST=localhost, SMTP_PORT=1025, SMTP_SECURE=false, SMTP_FROM=no-reply@localhost with SMTP_USER/SMTP_PASSWORD left blank.'
      )
    }

    if (!options.from) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'SMTP notification provider is missing SMTP_FROM (the From address). Set it in apps/backend/.env, e.g. SMTP_FROM="Perfume Shop <no-reply@yourdomain.com>".'
      )
    }
  }

  /**
   * Lazily builds the transport so a missing SMTP config only fails when we
   * actually try to send, keeping unrelated boot paths (migrations, seed) usable.
   */
  protected getTransporter(): Transporter {
    if (this.transporter_) {
      return this.transporter_
    }

    const { host, port, secure, user, pass } = this.config_
    const portNumber = typeof port === "string" ? Number.parseInt(port, 10) : port

    this.transporter_ = nodemailer.createTransport({
      host,
      port: Number.isFinite(portNumber) ? portNumber : 587,
      secure: Boolean(secure),
      // Only attach auth when credentials are supplied - local dev catchers
      // (Mailpit, MailHog) accept anonymous SMTP.
      auth: user
        ? {
            user,
            pass,
          }
        : undefined,
    })

    return this.transporter_
  }

  async send(
    notification: NotificationTypes.ProviderSendNotificationDTO
  ): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
    if (!notification) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No notification information provided."
      )
    }

    if (!notification.to) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot send an email without a recipient."
      )
    }

    const rendered = renderTemplate(
      notification.template,
      (notification.data ?? {}) as Record<string, unknown>
    )

    const from = notification.from ?? this.config_.from

    if (!from) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cannot send an email without a From address. Set SMTP_FROM or pass notification.from."
      )
    }

    try {
      const info = await this.getTransporter().sendMail({
        from,
        to: notification.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        attachments: notification.attachments ?? undefined,
      })

      this.logger_.info(
        `SMTP notification sent to "${notification.to}" (template "${notification.template}", messageId "${info.messageId}").`
      )

      return { id: info.messageId }
    } catch (error) {
      // Rethrow so the notification module records the attempt as failed rather
      // than reporting a success we never delivered.
      this.logger_.error(
        `Failed to send SMTP notification to "${notification.to}" using template "${notification.template}": ${
          (error as Error).message
        }`
      )

      throw error
    }
  }
}
