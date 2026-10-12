import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type {
  OrderEmailData,
  OrderLine,
} from "../modules/notifications/smtp/templates"

/**
 * Emails the customer when a fulfillment ships their order.
 *
 * The event payload carries `{ order_id, fulfillment_id }`, so the order is
 * re-read with its fulfillments and the tracking numbers from the fulfillment
 * that was just created.
 */
export default async function orderShippedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ order_id: string; fulfillment_id?: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const notificationService = container.resolve(Modules.NOTIFICATION)

  if (!data?.order_id) {
    logger.warn("order-shipped-email: event carried no order_id, skipping.")
    return
  }

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "email",
      "currency_code",
      "customer.first_name",
      "items.title",
      "items.subtitle",
      "items.quantity",
      "items.unit_price",
      "items.total",
      "items.variant_title",
      "items.product_title",
      "fulfillments.id",
      "fulfillments.labels.tracking_number",
    ],
    filters: { id: data.order_id },
  })

  const order = orders?.[0]

  if (!order) {
    logger.warn(
      `order-shipped-email: no order found for id "${data.order_id}", skipping.`
    )
    return
  }

  if (!order.email) {
    logger.warn(
      `order-shipped-email: order "${order.id}" has no email address, skipping shipping email.`
    )
    return
  }

  const customer = order.customer as Record<string, unknown> | null

  // Prefer the fulfillment that triggered this event; fall back to every
  // tracking number on the order so the customer sees something useful.
  const fulfillments = (order.fulfillments ?? []) as Record<string, unknown>[]
  const relevant = data.fulfillment_id
    ? fulfillments.filter((f) => f.id === data.fulfillment_id)
    : fulfillments

  const trackingNumbers = Array.from(
    new Set(
      relevant
        .flatMap((f) => (f.labels ?? []) as Record<string, unknown>[])
        .map((label) => label.tracking_number as string | undefined)
        .filter((value): value is string => Boolean(value))
    )
  )

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
    tracking_numbers: trackingNumbers,
    order_url: storefrontUrl
      ? `${storefrontUrl}/account/orders/details/${order.id}`
      : undefined,
  }

  try {
    await notificationService.createNotifications({
      to: order.email as string,
      channel: "email",
      template: "order-shipped",
      idempotency_key: `order-shipped:${
        data.fulfillment_id ?? order.id
      }`,
      trigger_type: "order.fulfillment_created",
      resource_id: order.id as string,
      resource_type: "order",
      data: emailData as unknown as Record<string, unknown>,
    })
  } catch (error) {
    logger.error(
      `order-shipped-email: failed to send shipping email for order "${order.id}": ${
        (error as Error).message
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
}
