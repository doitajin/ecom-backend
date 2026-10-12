import { CartDTO, OrderDTO } from '@medusajs/framework/types'

/**
 * Metadata key on a cart that points at the loyalty promotion created for it.
 * It is the only link the storefront reads to know loyalty is applied, so the
 * key lives here rather than being repeated as a string literal.
 */
export const CART_METADATA_LOYALTY_PROMO_ID = 'loyalty_promo_id'

/**
 * Attribute of a promotion rule used to scope a loyalty promotion to a single
 * customer.
 */
export const CUSTOMER_ID_PROMOTION_RULE_ATTRIBUTE = 'customer_id'

export type CartData = CartDTO & {
  promotions?: {
    id: string
    code: string
    application_method?: {
      value: number
    }
    rules?: {
      attribute: string
      operator: string
      values: string[]
    }[]
  }[]
  customer?: {
    id: string
    has_account: boolean
  }
  metadata?: Record<string, unknown> | null
}

export type OrderData = OrderDTO & {
  cart?: CartData
  customer?: {
    id: string
    has_account: boolean
  }
}

/**
 * Returns the promotion on the cart that was created by the loyalty flow, or
 * undefined when loyalty is not applied.
 */
export function getCartLoyaltyPromotion(cart: CartData) {
  const promotionId = cart.metadata?.[CART_METADATA_LOYALTY_PROMO_ID]

  if (!promotionId || typeof promotionId !== 'string') {
    return undefined
  }

  return cart.promotions?.find((promotion) => promotion.id === promotionId)
}

/**
 * Returns true when the order was placed with a loyalty promotion applied for
 * the order's own customer. Used to decide whether points were redeemed (deduct)
 * or should be earned (add).
 */
export function orderHasLoyaltyPromotion(order: OrderData): boolean {
  const cart = order.cart
  const customerId = order.customer?.id

  if (!cart || !customerId) {
    return false
  }

  const promotion = getCartLoyaltyPromotion(cart)

  if (!promotion) {
    return false
  }

  return !!promotion.rules?.some(
    (rule) =>
      rule.attribute === CUSTOMER_ID_PROMOTION_RULE_ATTRIBUTE &&
      rule.values?.includes(customerId)
  )
}
