import { WorkflowData, createStep, StepResponse } from '@medusajs/framework/workflows-sdk'
import { LOYALTY_MODULE } from '../../modules/loyalty'
import LoyaltyModuleService from '../../modules/loyalty/service'

export type AddPurchaseAsPointsStepInput = {
  customer_id: WorkflowData<string>
  amount: WorkflowData<number>
}

/**
 * Credits points for a paid order. Compensated by deducting them again if a
 * later step in the workflow fails.
 */
export const addPurchaseAsPointsStep = createStep(
  'add-purchase-as-points',
  async ({ customer_id, amount }: AddPurchaseAsPointsStepInput, { container }) => {
    const loyaltyModuleService: LoyaltyModuleService =
      container.resolve(LOYALTY_MODULE)

    const pointsToAdd = await loyaltyModuleService.calculatePointsFromAmount(
      amount
    )

    await loyaltyModuleService.addPoints(customer_id, pointsToAdd)

    return new StepResponse(pointsToAdd, {
      customer_id,
      pointsToAdd,
    })
  },
  async (compensateInput, { container }) => {
    if (!compensateInput) {
      return
    }

    const loyaltyModuleService: LoyaltyModuleService =
      container.resolve(LOYALTY_MODULE)

    await loyaltyModuleService.deductPoints(
      compensateInput.customer_id,
      compensateInput.pointsToAdd
    )
  }
)
