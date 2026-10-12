import { MedusaError } from '@medusajs/framework/utils'
import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk'
import { CartData } from '../../utils/promo'

export type ValidateCustomerExistsStepInput = {
  cart: CartData
}

/**
 * Guards every loyalty flow: only registered customers (i.e. those with an
 * account, not guests) can earn or redeem points.
 */
export const validateCustomerExistsStep = createStep(
  'validate-customer-exists',
  async ({ cart }: ValidateCustomerExistsStepInput) => {
    if (!cart.customer || !cart.customer.has_account) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'Customer is not registered.'
      )
    }

    return new StepResponse(cart.customer)
  }
)
