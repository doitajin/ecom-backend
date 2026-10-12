import {
  createWorkflow,
  transform,
  when,
  WorkflowResponse,
} from '@medusajs/framework/workflows-sdk'
import { useQueryGraphStep, updatePromotionsStep } from '@medusajs/core-flows'
import { addPurchaseAsPointsStep } from './steps/add-purchase-as-points'
import { deductPurchasePointsStep } from './steps/deduct-purchase-points'
import { getCartLoyaltyPromoStep } from './steps/get-cart-loyalty-promo'
import { validateCustomerExistsStep } from './steps/validate-customer-exists'
import { OrderData } from '../utils/promo'

export type HandleOrderPointsWorkflowInput = {
  order_id: string
}

/**
 * Runs after an order is placed. If the order redeemed loyalty points, the
 * points are deducted and the one-shot promotion is deactivated. Otherwise the
 * order's total is credited back as points.
 */
export const handleOrderPointsWorkflow = createWorkflow(
  'handle-order-points',
  (input: HandleOrderPointsWorkflowInput) => {
    const { data: orders } = useQueryGraphStep({
      entity: 'order',
      fields: [
        'id',
        'total',
        'customer_id',
        'customer.id',
        'customer.has_account',
        'cart.id',
        'cart.total',
        'cart.metadata',
        'cart.promotions.id',
        'cart.promotions.code',
        'cart.promotions.rules.attribute',
        'cart.promotions.rules.operator',
        'cart.promotions.rules.values',
      ],
      filters: { id: input.order_id },
      options: { throwIfKeyNotFound: true },
    })

    const order = transform({ orders }, ({ orders }) => {
      return orders[0] as unknown as OrderData
    })

    validateCustomerExistsStep({
      cart: transform({ order }, ({ order }) => {
        return order.cart
      }),
    } as any)

    const loyaltyPromotion = getCartLoyaltyPromoStep({
      cart: transform({ order }, ({ order }) => {
        return order.cart
      }),
    } as any)

    when({ order, loyaltyPromotion }, ({ loyaltyPromotion }) => {
      return !!loyaltyPromotion
    }).then(() => {
      deductPurchasePointsStep({
        customer_id: transform({ order }, ({ order }) => {
          return order.customer?.id as string
        }),
        amount: transform({ order }, ({ order }) => {
          return Number(order.cart?.total ?? order.total)
        }),
      })

      updatePromotionsStep([
        transform({ loyaltyPromotion }, ({ loyaltyPromotion }) => {
          return {
            id: loyaltyPromotion!.id,
            status: 'inactive',
          }
        }),
      ])
    })

    when({ order, loyaltyPromotion }, ({ loyaltyPromotion }) => {
      return !loyaltyPromotion
    }).then(() => {
      addPurchaseAsPointsStep({
        customer_id: transform({ order }, ({ order }) => {
          return order.customer?.id as string
        }),
        amount: transform({ order }, ({ order }) => {
          return Number(order.total)
        }),
      })
    })

    return new WorkflowResponse(transform({ order }, ({ order }) => order))
  }
)
