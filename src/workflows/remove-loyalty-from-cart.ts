import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from '@medusajs/framework/workflows-sdk'
import {
  acquireLockStep,
  releaseLockStep,
  updateCartPromotionsWorkflow,
  updateCartsStep,
  updatePromotionsStep,
  useQueryGraphStep,
} from '@medusajs/core-flows'
import { PromotionActions } from '@medusajs/framework/utils'
import { getCartLoyaltyPromoStep } from './steps/get-cart-loyalty-promo'
import {
  CART_METADATA_LOYALTY_PROMO_ID,
  CartData,
} from '../utils/promo'

export type RemoveLoyaltyFromCartWorkflowInput = {
  cart_id: string
}

/**
 * Reverses apply-loyalty-on-cart: takes the loyalty promotion off the cart,
 * clears the metadata pointer, and deactivates the promotion so it can never be
 * reused.
 */
export const removeLoyaltyFromCartWorkflow = createWorkflow(
  'remove-loyalty-from-cart',
  (input: RemoveLoyaltyFromCartWorkflowInput) => {
    const { data: carts } = useQueryGraphStep({
      entity: 'cart',
      fields: [
        'id',
        'metadata',
        'customer.id',
        'promotions.id',
        'promotions.code',
      ],
      filters: { id: input.cart_id },
      options: { throwIfKeyNotFound: true },
    }).config({ name: 'get-cart' })

    const cart = transform({ carts }, ({ carts }) => {
      return carts[0] as unknown as CartData
    })

    const loyaltyPromotion = getCartLoyaltyPromoStep({
      cart,
      throwErrorOn: 'not-found',
    })

    acquireLockStep({
      key: input.cart_id,
      timeout: 2,
      ttl: 10,
    })

    const promoCode = transform(
      { loyaltyPromotion },
      ({ loyaltyPromotion }) => {
        return loyaltyPromotion!.code
      }
    )

    updateCartPromotionsWorkflow.runAsStep({
      input: {
        cart_id: input.cart_id,
        promo_codes: [promoCode],
        action: PromotionActions.REMOVE,
        force_refresh_payment_collection: true,
      },
    })

    updateCartsStep([
      transform({ cart }, ({ cart }) => {
        const metadata = { ...(cart.metadata ?? {}) }
        delete metadata[CART_METADATA_LOYALTY_PROMO_ID]

        return {
          id: cart.id,
          metadata,
        }
      }),
    ])

    updatePromotionsStep([
      transform({ loyaltyPromotion }, ({ loyaltyPromotion }) => {
        return {
          id: loyaltyPromotion!.id,
          status: 'inactive',
        }
      }),
    ])

    const { data: updatedCarts } = useQueryGraphStep({
      entity: 'cart',
      fields: [
        'id',
        'total',
        'metadata',
        'promotions.id',
        'promotions.code',
      ],
      filters: { id: input.cart_id },
    }).config({ name: 'get-cart-updated' })

    releaseLockStep({
      key: input.cart_id,
    })

    return new WorkflowResponse(
      transform({ updatedCarts }, ({ updatedCarts }) => {
        return updatedCarts[0]
      })
    )
  }
)
