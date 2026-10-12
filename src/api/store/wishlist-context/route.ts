import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: stores } = await query.graph({
    entity: 'store',
    fields: ['default_sales_channel_id'],
  })
  const salesChannelId = stores[0]?.default_sales_channel_id

  if (!salesChannelId) {
    return res.status(404).json({ message: 'Default sales channel is not configured' })
  }

  return res.json({ sales_channel_id: salesChannelId })
}