import { MedusaError } from '@medusajs/framework/utils'
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'
import { CartData, getCartLoyaltyPromotion } from '../../utils/promo'

export type GetCartLoyaltyPromoStepInput = {
  cart: CartData
  /**
   * Control which case is treated as an error. Defaults to throwing when the
   * promotion is NOT found, which is what the remove flow wants.
   */
  throwErrorOn?: 'found' | 'not-found'
}

/**
 * Resolves the loyalty promotion currently attached to the cart. Reused by the
 * apply, remove and order flows so all of them agree on what "loyalty applied"
 * means.
 */
export const getCartLoyaltyPromoStep = createStep(
  'get-cart-loyalty-promo',
  async ({ cart, throwErrorOn = 'not-found' }: GetCartLoyaltyPromoStepInput) => {
    const promotion = getCartLoyaltyPromotion(cart)

    if (!promotion && throwErrorOn === 'not-found') {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        'No loyalty promotion found on the cart.'
      )
    }

    if (promotion && throwErrorOn === 'found') {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        'Loyalty points are already applied to the cart.'
      )
    }

    return new StepResponse(promotion)
  }
)
