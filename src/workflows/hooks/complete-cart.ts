import { ContainerRegistrationKeys, MedusaError } from '@medusajs/framework/utils'
import { completeCartWorkflow } from '@medusajs/core-flows'
import { LOYALTY_MODULE } from '../../modules/loyalty'
import LoyaltyModuleService from '../../modules/loyalty/service'
import { CartData, getCartLoyaltyPromotion } from '../../utils/promo'

/**
 * Last line of defence before a cart is completed. Points may have been spent
 * on another order between applying them here and checking out, so re-check the
 * balance and block completion when it no longer covers the applied promotion.
 */
completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const loyaltyModuleService: LoyaltyModuleService =
    container.resolve(LOYALTY_MODULE)

  const { data: carts } = await query.graph({
    entity: 'cart',
    fields: [
      'id',
      'customer.id',
      'customer.has_account',
      'metadata',
      'promotions.id',
      'promotions.code',
      'promotions.application_method.value',
      'promotions.rules.attribute',
      'promotions.rules.operator',
      'promotions.rules.values',
    ],
    filters: { id: cart.id },
  })

  const cartData = carts[0] as unknown as CartData

  const loyaltyPromotion = getCartLoyaltyPromotion(cartData)

  const customerId = cartData.customer?.id

  if (!customerId || !cartData.customer?.has_account) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'A registered customer account is required to place an order.'
    )
  }

  if (!loyaltyPromotion) {
    return
  }

  const points = await loyaltyModuleService.getPoints(customerId)
  const amountPerPoint = await loyaltyModuleService.calculateAmountFromPoints(1)
  const requiredPoints = Math.ceil(
    (loyaltyPromotion.application_method?.value ?? 0) / amountPerPoint
  )

  if (points < requiredPoints) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'Customer does not have enough loyalty points to complete this order.'
    )
  }
})
