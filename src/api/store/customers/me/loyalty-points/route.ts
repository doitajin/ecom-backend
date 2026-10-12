import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from '@medusajs/framework/http'
import { LOYALTY_MODULE } from '../../../../../modules/loyalty'
import LoyaltyModuleService from '../../../../../modules/loyalty/service'

/**
 * GET /store/customers/me/loyalty-points
 *
 * Returns the authenticated customer's points balance. Guarded by the
 * authenticate middleware, so `auth_context.actor_id` is the customer.
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const loyaltyModuleService: LoyaltyModuleService =
    req.scope.resolve(LOYALTY_MODULE)

  const points = await loyaltyModuleService.getPoints(req.auth_context.actor_id)

  return res.json({ points })
}
