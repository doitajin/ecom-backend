import {
  MiddlewareRoute,
  validateAndTransformBody,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

const AddQuantityPricedLineItemSchema = z.object({
  variant_id: z.string().min(1),
  quantity: z.number().int().min(1),
})

const UpdateQuantityPricedLineItemSchema = z.object({
  quantity: z.number().int().min(1),
})

export type AddQuantityPricedLineItem = z.infer<
  typeof AddQuantityPricedLineItemSchema
>
export type UpdateQuantityPricedLineItem = z.infer<
  typeof UpdateQuantityPricedLineItemSchema
>

export const quantityPricingCartMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/store/carts/:id/quantity-pricing/line-items",
    method: "POST",
    middlewares: [validateAndTransformBody(AddQuantityPricedLineItemSchema)],
  },
  {
    matcher: "/store/carts/:id/quantity-pricing/line-items/:line_id",
    method: "POST",
    middlewares: [validateAndTransformBody(UpdateQuantityPricedLineItemSchema)],
  },
]