import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { addToCartWorkflow } from "@medusajs/medusa/core-flows"
import { AddQuantityPricedLineItem } from "../middlewares"
import {
  getCartForQuantityPricing,
  getNormalUnitPrice,
  getVariantForQuantityPricing,
  QUANTITY_PRICING_METADATA_KEY,
  repriceVariantLines,
  resolveTierUnitPrice,
} from "../helpers"

export async function POST(
  req: MedusaRequest<AddQuantityPricedLineItem>,
  res: MedusaResponse
) {
  const cart = await getCartForQuantityPricing(req)
  const { variant_id, quantity } = req.validatedBody
  const variant = await getVariantForQuantityPricing(req, cart, variant_id)
  const existingLines = cart.items.filter((item) => item.variant_id === variant_id)
  const resultingQuantity =
    quantity + existingLines.reduce((total, item) => total + Number(item.quantity), 0)
  const tierPrice = await resolveTierUnitPrice(
    req,
    cart,
    variant.product_id!,
    variant_id,
    resultingQuantity,
    getNormalUnitPrice(variant)
  )
  const existingTierPrice = existingLines.some(
    (item) => item.metadata?.[QUANTITY_PRICING_METADATA_KEY] === true
  )
  const normalUnitPrice = getNormalUnitPrice(variant)
  const unitPrice =
    tierPrice ??
    (existingTierPrice ? normalUnitPrice : null)

  if (existingTierPrice && unitPrice === null) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Unable to resolve the standard variant price"
    )
  }

  const metadata = tierPrice !== null || existingTierPrice
    ? { [QUANTITY_PRICING_METADATA_KEY]: tierPrice !== null }
    : undefined

  await addToCartWorkflow(req.scope).run({
    input: {
      cart_id: cart.id,
      items: [
        {
          variant_id,
          quantity,
          ...(unitPrice !== null ? { unit_price: unitPrice } : {}),
          ...(metadata ? { metadata } : {}),
        },
      ],
    },
  })

  if (unitPrice !== null) {
    await repriceVariantLines(req, variant_id, unitPrice, tierPrice !== null)
  }

  return res.status(200).json({ success: true })
}