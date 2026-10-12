import { MedusaError } from '@medusajs/framework/utils'
import {
  createStep,
  StepResponse,
  WorkflowData,
} from '@medusajs/framework/workflows-sdk'
import { LOYALTY_MODULE } from '../../modules/loyalty'
import LoyaltyModuleService from '../../modules/loyalty/service'

export type GetCartLoyaltyPromoAmountStepInput = {
  customer_id: WorkflowData<string>
  cart_total: WorkflowData<number>
}

/**
 * Turns the customer's points balance into the discount amount to put on the
 * cart's loyalty promotion, capped at the cart total so the discount can never
 * exceed what is owed.
 */
export const getCartLoyaltyPromoAmountStep = createStep(
  'get-cart-loyalty-promo-amount',
  async (
    { customer_id, cart_total }: GetCartLoyaltyPromoAmountStepInput,
    { container }
  ) => {
    const loyaltyModuleService: LoyaltyModuleService =
      container.resolve(LOYALTY_MODULE)

    const points = await loyaltyModuleService.getPoints(customer_id)

    if (!points) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'Customer does not have any loyalty points to redeem.'
      )
    }

    const amount = Math.min(
      await loyaltyModuleService.calculateAmountFromPoints(points),
      cart_total
    )

    return new StepResponse(amount)
  }
)
