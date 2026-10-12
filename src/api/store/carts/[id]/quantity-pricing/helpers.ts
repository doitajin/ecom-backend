import { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, QueryContext } from "@medusajs/framework/utils"
import { updateLineItemInCartWorkflow } from "@medusajs/medusa/core-flows"
import { resolveQuantityUnitPrice } from "@webbycrown/medusa-quantity-pricing-rules"

export const QUANTITY_PRICING_METADATA_KEY = "_quantity_pricing_applied"

export type QuantityPricingCart = {
  id: string
  currency_code: string
  region_id: string
  customer_id?: string | null
  items: Array<{
    id: string
    product_id?: string | null
    variant_id?: string | null
    quantity: number
    is_custom_price?: boolean
    metadata?: Record<string, unknown> | null
  }>
}

export async function getCartForQuantityPricing(req: MedusaRequest) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "currency_code",
      "region_id",
      "customer_id",
      "items.id",
      "items.product_id",
      "items.variant_id",
      "items.quantity",
      "items.is_custom_price",
      "items.metadata",
    ],
    filters: { id: req.params.id },
  })
  const cart = carts[0] as QuantityPricingCart | undefined

  if (!cart) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Cart not found")
  }

  return cart
}

export async function getVariantForQuantityPricing(
  req: MedusaRequest,
  cart: QuantityPricingCart,
  variantId: string
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "product_id", "calculated_price.calculated_amount"],
    filters: { id: variantId },
    context: {
      calculated_price: QueryContext({
        currency_code: cart.currency_code,
        region_id: cart.region_id,
        customer_id: cart.customer_id,
      }),
    },
  })
  const variant = variants[0] as
    | {
        id: string
        product_id?: string | null
        calculated_price?: { calculated_amount?: number | null } | null
      }
    | undefined

  if (!variant?.product_id) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Product variant not found")
  }

  return variant
}

export async function resolveTierUnitPrice(
  req: MedusaRequest,
  cart: QuantityPricingCart,
  productId: string,
  variantId: string,
  quantity: number,
  baseUnitPrice?: number | null
) {
  return resolveQuantityUnitPrice(req.scope, {
    product_id: productId,
    variant_id: variantId,
    quantity,
    currency_code: cart.currency_code.toLowerCase(),
    region_id: cart.region_id,
    base_unit_price: baseUnitPrice,
  })
}

export function getNormalUnitPrice(
  variant: Awaited<ReturnType<typeof getVariantForQuantityPricing>>
) {
  const amount = variant.calculated_price?.calculated_amount
  return typeof amount === "number" && Number.isFinite(amount) ? amount : null
}

export async function repriceVariantLines(
  req: MedusaRequest,
  variantId: string,
  unitPrice: number,
  tierApplied: boolean
) {
  const cart = await getCartForQuantityPricing(req)
  const lines = cart.items.filter((item) => item.variant_id === variantId)

  for (const line of lines) {
    const wasTierPriced =
      line.metadata?.[QUANTITY_PRICING_METADATA_KEY] === true

    if (!tierApplied && !wasTierPriced) {
      continue
    }

    await updateLineItemInCartWorkflow(req.scope).run({
      input: {
        cart_id: cart.id,
        item_id: line.id,
        update: {
          quantity: line.quantity,
          unit_price: unitPrice,
          metadata: {
            ...(line.metadata ?? {}),
            [QUANTITY_PRICING_METADATA_KEY]: tierApplied,
          },
        },
      },
    })
  }
}