import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type {
  OrderEmailData,
  OrderLine,
} from "../modules/notifications/smtp/templates"

/**
 * Emails the customer a confirmation once their order is placed.
 *
 * `order.placed` carries only the order id, so the order is re-read through the
 * query graph to get the items, totals and address the template needs.
 *
 * This is intentionally separate from `subscribers/order-placed.ts`, which runs
 * the loyalty-points workflow. The subscriber loader registers one handler per
 * file, so a second concern gets its own file rather than being folded into the
 * existing one.
 */
export default async function orderPlacedEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const notificationService = container.resolve(Modules.NOTIFICATION)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "email",
      "currency_code",
      "subtotal",
      "shipping_total",
      "tax_total",
      "total",
      "customer.first_name",
      "items.title",
      "items.subtitle",
      "items.quantity",
      "items.unit_price",
      "items.total",
      "items.variant_title",
      "items.product_title",
      "shipping_address.first_name",
      "shipping_address.last_name",
      "shipping_address.address_1",
      "shipping_address.address_2",
      "shipping_address.city",
      "shipping_address.province",
      "shipping_address.postal_code",
      "shipping_address.country_code",
    ],
    filters: { id: data.id },
  })

  const order = orders?.[0]

  if (!order) {
    logger.warn(`order-placed-email: no order found for id "${data.id}", skipping.`)
    return
  }

  if (!order.email) {
    logger.warn(
      `order-placed-email: order "${order.id}" has no email address, skipping confirmation email.`
    )
    return
  }

  const address = order.shipping_address as Record<string, string | null> | null
  const customer = order.customer as Record<string, unknown> | null

  const items: OrderLine[] = ((order.items ?? []) as Record<string, unknown>[]).map(
    (item) => ({
      title: (item.product_title as string) ?? (item.title as string) ?? "Item",
      subtitle:
        (item.variant_title as string) ?? (item.subtitle as string) ?? null,
      quantity: Number(item.quantity ?? 1),
      unit_price: (item.unit_price as number) ?? null,
      total: (item.total as number) ?? null,
    })
  )

  const storefrontUrl = process.env.STOREFRONT_URL

  const emailData: OrderEmailData = {
    store_name: process.env.SMTP_STORE_NAME || "Perfume Shop",
    display_id: order.display_id ?? undefined,
    email: order.email as string,
    first_name: (customer?.first_name as string) ?? null,
    currency_code: order.currency_code as string,
    items,
    subtotal: order.subtotal as number,
    shipping_total: order.shipping_total as number,
    tax_total: order.tax_total as number,
    total: order.total as number,
    shipping_address: address
      ? {
          first_name: address.first_name,
          last_name: address.last_name,
          address_1: address.address_1,
          address_2: address.address_2,
          city: address.city,
          province: address.province,
          postal_code: address.postal_code,
          country_code: address.country_code,
        }
      : null,
    order_url: storefrontUrl
      ? `${storefrontUrl}/account/orders/details/${order.id}`
      : undefined,
  }

  try {
    await notificationService.createNotifications({
      to: order.email as string,
      channel: "email",
      template: "order-placed",
      // Provides an idempotency guard so a retried event does not re-send.
      idempotency_key: `order-placed:${order.id}`,
      trigger_type: "order.placed",
      resource_id: order.id as string,
      resource_type: "order",
      data: emailData as unknown as Record<string, unknown>,
    })
  } catch (error) {
    // The order is already placed - a failed email must not surface as a
    // failure of the checkout flow.
    logger.error(
      `order-placed-email: failed to send confirmation for order "${order.id}": ${
        (error as Error).message
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
