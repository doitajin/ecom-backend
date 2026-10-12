import { WorkflowData, createStep, StepResponse } from '@medusajs/framework/workflows-sdk'
import { LOYALTY_MODULE } from '../../modules/loyalty'
import LoyaltyModuleService from '../../modules/loyalty/service'

export type DeductPurchasePointsStepInput = {
  customer_id: WorkflowData<string>
  amount: WorkflowData<number>
}

/**
 * Deducts the points a customer redeemed on an order. Compensated by adding
 * them back if a later step in the workflow fails.
 */
export const deductPurchasePointsStep = createStep(
  'deduct-purchase-points',
  async ({ customer_id, amount }: DeductPurchasePointsStepInput, { container }) => {
    const loyaltyModuleService: LoyaltyModuleService =
      container.resolve(LOYALTY_MODULE)

    const pointsToDeduct = await loyaltyModuleService.calculatePointsFromAmount(
      amount
    )

    await loyaltyModuleService.deductPoints(customer_id, pointsToDeduct)

    return new StepResponse(pointsToDeduct, {
      customer_id,
      pointsToDeduct,
    })
  },
  async (compensateInput, { container }) => {
    if (!compensateInput) {
      return
    }

    const loyaltyModuleService: LoyaltyModuleService =
      container.resolve(LOYALTY_MODULE)

    await loyaltyModuleService.addPoints(
      compensateInput.customer_id,
      compensateInput.pointsToDeduct
    )
  }
)
