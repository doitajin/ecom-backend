import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { updateLineItemInCartWorkflow } from "@medusajs/medusa/core-flows"
import { UpdateQuantityPricedLineItem } from "../../middlewares"
import {
  getCartForQuantityPricing,
  getNormalUnitPrice,
  getVariantForQuantityPricing,
  QUANTITY_PRICING_METADATA_KEY,
  repriceVariantLines,
  resolveTierUnitPrice,
} from "../../helpers"

export async function POST(
  req: MedusaRequest<UpdateQuantityPricedLineItem>,
  res: MedusaResponse
) {
  const cart = await getCartForQuantityPricing(req)
  const item = cart.items.find((cartItem) => cartItem.id === req.params.line_id)

  if (!item?.variant_id || !item.product_id) {
    return res.status(404).json({ message: "Cart line item not found" })
  }

  const { quantity } = req.validatedBody
  const variant = await getVariantForQuantityPricing(req, cart, item.variant_id)
  const variantLines = cart.items.filter(
    (cartItem) => cartItem.variant_id === item.variant_id
  )
  const resultingQuantity = variantLines.reduce(
    (total, cartItem) =>
      total +
      (cartItem.id === item.id ? quantity : Number(cartItem.quantity)),
    0
  )
  const previouslyTierPriced = variantLines.some(
    (cartItem) =>
      cartItem.metadata?.[QUANTITY_PRICING_METADATA_KEY] === true
  )
  const normalUnitPrice = getNormalUnitPrice(variant)
  const tierPrice = await resolveTierUnitPrice(
    req,
    cart,
    item.product_id,
    item.variant_id,
    resultingQuantity,
    normalUnitPrice
  )
  const unitPrice =
    tierPrice ?? (previouslyTierPriced ? normalUnitPrice : null)

  if (previouslyTierPriced && unitPrice === null) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Unable to resolve the standard variant price"
    )
  }

  const metadata = previouslyTierPriced || tierPrice !== null
    ? {
        ...(item.metadata ?? {}),
        [QUANTITY_PRICING_METADATA_KEY]: tierPrice !== null,
      }
    : undefined

  await updateLineItemInCartWorkflow(req.scope).run({
    input: {
      cart_id: cart.id,
      item_id: item.id,
      update: {
        quantity,
        ...(unitPrice !== null ? { unit_price: unitPrice } : {}),
        ...(metadata ? { metadata } : {}),
      },
    },
  })

  if (unitPrice !== null) {
    await repriceVariantLines(req, item.variant_id, unitPrice, tierPrice !== null)
  }

  return res.status(200).json({ success: true })
}