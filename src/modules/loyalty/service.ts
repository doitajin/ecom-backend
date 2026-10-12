import { MedusaError, MedusaService } from '@medusajs/framework/utils'
import LoyaltyPoint from './models/loyalty-point'

/**
 * Conversion rates for the loyalty program. These are the single place to tune
 * the program, and they are deliberately asymmetric-free: 10 points are earned
 * per OMR spent, and each point is worth 0.01 OMR, so a customer earns back 10%
 * of what they spend.
 */
export const POINTS_PER_CURRENCY_UNIT = 10
export const CURRENCY_UNIT_PER_POINT = 0.01

class LoyaltyModuleService extends MedusaService({
  LoyaltyPoint,
}) {
  /**
   * Adds points to a customer's balance, creating the balance row on first use.
   */
  async addPoints(customerId: string, points: number): Promise<number> {
    if (!Number.isInteger(points) || points <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'Points to add must be a positive integer.'
      )
    }

    const existing = await this.listLoyaltyPoints({ customer_id: customerId })

    if (existing.length) {
      const updated = await this.updateLoyaltyPoints({
        id: existing[0].id,
        points: existing[0].points + points,
      })
      return updated.points
    }

    const created = await this.createLoyaltyPoints({
      customer_id: customerId,
      points,
    })

    return created.points
  }

  /**
   * Deducts points from a customer's balance. Refuses to let the balance go
   * below zero, and refuses to deduct from a customer who has no balance row.
   */
  async deductPoints(customerId: string, points: number): Promise<number> {
    if (!Number.isInteger(points) || points <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'Points to deduct must be a positive integer.'
      )
    }

    const existing = await this.listLoyaltyPoints({ customer_id: customerId })

    if (!existing.length || existing[0].points < points) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        'Customer does not have enough loyalty points.'
      )
    }

    const updated = await this.updateLoyaltyPoints({
      id: existing[0].id,
      points: existing[0].points - points,
    })

    return updated.points
  }

  /**
   * Returns the customer's points, or 0 when they have never earned any.
   */
  async getPoints(customerId: string): Promise<number> {
    const existing = await this.listLoyaltyPoints({ customer_id: customerId })

    return existing.length ? existing[0].points : 0
  }

  /**
   * Converts a monetary amount (in major units, e.g. OMR) into points earned.
   * Rounds down so a customer never earns points for money not actually spent.
   */
  async calculatePointsFromAmount(amount: number): Promise<number> {
    if (amount < 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'Amount cannot be negative.'
      )
    }

    return Math.floor(amount * POINTS_PER_CURRENCY_UNIT)
  }

  /**
   * Converts points into the monetary discount they represent.
   */
  async calculateAmountFromPoints(points: number): Promise<number> {
    if (points < 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        'Points cannot be negative.'
      )
    }

    return points * CURRENCY_UNIT_PER_POINT
  }
}

export default LoyaltyModuleService
