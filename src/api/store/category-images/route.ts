import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { category_ids } = req.validatedQuery as { category_ids: string[] }
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: categoryImages } = await query.graph({
    entity: "product_category_images",
    fields: ["id", "url", "rank", "product_category_id"],
    filters: {
      product_category_id: category_ids,
    },
    pagination: {
      take: 500,
      order: {
        rank: "asc",
      },
    },
  })

  return res.json({ category_images: categoryImages })
}