import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { applyLoyaltyOnCartWorkflow } from '../../../../../workflows/apply-loyalty-on-cart'
import { removeLoyaltyFromCartWorkflow } from '../../../../../workflows/remove-loyalty-from-cart'

/**
 * POST /store/carts/:id/loyalty-points
 *
 * Applies the customer's loyalty points to the cart and returns the updated
 * cart.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { result: cart } = await applyLoyaltyOnCartWorkflow(req.scope).run({
    input: { cart_id: req.params.id },
  })

  return res.json({ cart })
}

/**
 * DELETE /store/carts/:id/loyalty-points
 *
 * Removes the loyalty points promotion from the cart and returns the updated
 * cart.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { result: cart } = await removeLoyaltyFromCartWorkflow(req.scope).run({
    input: { cart_id: req.params.id },
  })

  return res.json({ cart })
}
