import { randomBytes } from 'crypto'
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from '@medusajs/framework/workflows-sdk'
import {
  acquireLockStep,
  createPromotionsStep,
  releaseLockStep,
  updateCartPromotionsWorkflow,
  updateCartsStep,
  useQueryGraphStep,
} from '@medusajs/core-flows'
import { PromotionActions } from '@medusajs/framework/utils'
import { getCartLoyaltyPromoAmountStep } from './steps/get-cart-loyalty-promo-amount'
import { getCartLoyaltyPromoStep } from './steps/get-cart-loyalty-promo'
import { validateCustomerExistsStep } from './steps/validate-customer-exists'
import {
  CART_METADATA_LOYALTY_PROMO_ID,
  CartData,
  CUSTOMER_ID_PROMOTION_RULE_ATTRIBUTE,
} from '../utils/promo'

export type ApplyLoyaltyOnCartWorkflowInput = {
  cart_id: string
}

/**
 * Applies a customer's loyalty points to their cart as a customer-scoped,
 * single-use fixed promotion sized to their balance, then records the
 * promotion's id in the cart metadata so it can be found and removed later.
 */
export const applyLoyaltyOnCartWorkflow = createWorkflow(
  'apply-loyalty-on-cart',
  (input: ApplyLoyaltyOnCartWorkflowInput) => {
    const { data: carts } = useQueryGraphStep({
      entity: 'cart',
      fields: [
        'id',
        'total',
        'metadata',
        'customer.id',
        'customer.has_account',
        'promotions.id',
      ],
      filters: { id: input.cart_id },
      options: { throwIfKeyNotFound: true },
    })

    const cart = transform({ carts }, ({ carts }) => {
      return carts[0] as unknown as CartData
    })

    validateCustomerExistsStep({ cart })

    getCartLoyaltyPromoStep({
      cart,
      throwErrorOn: 'found',
    })

    acquireLockStep({
      key: input.cart_id,
      timeout: 2,
      ttl: 10,
    })

    const promoAmount = getCartLoyaltyPromoAmountStep({
      customer_id: transform({ cart }, ({ cart }) => {
        return cart.customer!.id
      }),
      cart_total: transform({ cart }, ({ cart }) => {
        return Number(cart.total ?? 0)
      }),
    })

    const promoToCreate = transform({ cart, promoAmount }, ({ cart, promoAmount }) => {
      return [
        {
          code: `LOYALTY-${randomBytes(6).toString('hex').toUpperCase()}`,
          type: 'standard' as const,
          status: 'active' as const,
          is_automatic: false,
          application_method: {
            type: 'fixed' as const,
            target_type: 'order' as const,
            allocation: 'across' as const,
            value: promoAmount,
          },
          rules: [
            {
              attribute: CUSTOMER_ID_PROMOTION_RULE_ATTRIBUTE,
              operator: 'eq' as const,
              values: [cart.customer!.id],
            },
          ],
          campaign: {
            name: `Loyalty redemption for ${cart.customer!.id}`,
            campaign_identifier: `loyalty-${cart.customer!.id}`,
            budget: {
              type: 'usage' as const,
              limit: 1,
            },
          },
        },
      ]
    })

    const createdPromotions = createPromotionsStep(promoToCreate)

    const promoCode = transform(
      { createdPromotions },
      ({ createdPromotions }) => {
        return createdPromotions[0].code
      }
    )

    updateCartPromotionsWorkflow.runAsStep({
      input: {
        cart_id: input.cart_id,
        promo_codes: [promoCode],
        action: PromotionActions.ADD,
        force_refresh_payment_collection: true,
      },
    })

    const promotionId = transform(
      { createdPromotions },
      ({ createdPromotions }) => {
        return createdPromotions[0].id
      }
    )

    updateCartsStep([
      transform({ cart, promotionId }, ({ cart, promotionId }) => {
        return {
          id: cart.id,
          metadata: {
            ...(cart.metadata ?? {}),
            [CART_METADATA_LOYALTY_PROMO_ID]: promotionId,
          },
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
        'promotions.application_method.value',
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
