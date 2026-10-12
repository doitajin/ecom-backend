import {
  MiddlewareRoute,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"

const CategoryImagesQuerySchema = z
  .object({
    category_ids: z
      .string()
      .min(1)
      .transform((value) =>
        Array.from(
          new Set(
            value
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean)
          )
        )
      )
      .pipe(z.array(z.string().min(1)).min(1).max(100)),
  })

export type CategoryImagesQuery = z.infer<typeof CategoryImagesQuerySchema>

export const categoryImagesMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/store/category-images",
    method: "GET",
    middlewares: [validateAndTransformQuery(CategoryImagesQuerySchema, {})],
  },
]