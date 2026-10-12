import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { SmtpNotificationService } from "./service"

/**
 * SMTP notification provider.
 *
 * Registered from `medusa-config.ts` as:
 *
 *   {
 *     resolve: "./modules/notifications/smtp",
 *     id: "smtp",
 *     options: { channels: ["email"], ... },
 *   }
 *
 * The loader imports this file through `resolveFromProject`, so the path is
 * resolved relative to the Medusa project directory. Omitting the leading
 * `src/` is deliberate: `normalizeImportPathWithSource` keeps an explicit
 * `./src` as-is for dev but points at the compiled output in production, so
 * `./modules/...` is the one form that works in both.
 */
const services = [SmtpNotificationService]

export default ModuleProvider(Modules.NOTIFICATION, {
  services,
})
