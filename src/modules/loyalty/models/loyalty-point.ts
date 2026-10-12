import { model } from '@medusajs/framework/utils'

/**
 * Loyalty points balance for a single customer.
 *
 * One row per customer, enforced by the unique index on `customer_id`, so a
 * customer's balance is a plain number that can be read and replaced atomically
 * without aggregating a ledger.
 */
const LoyaltyPoint = model.define('loyalty_point', {
  id: model.id().primaryKey(),
  points: model.number().default(0),
  customer_id: model.text().unique('IDX_LOYALTY_CUSTOMER_ID'),
})

export default LoyaltyPoint
