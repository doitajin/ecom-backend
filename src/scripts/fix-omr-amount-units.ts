/**
 * One-shot repair: converts OMR amounts that were stored in baisa (the currency's
 * minor unit) back to OMR (the major unit).
 *
 *   npx medusa exec ./src/scripts/fix-omr-amount-units.ts            # dry run
 *   APPLY=1 npx medusa exec ./src/scripts/fix-omr-amount-units.ts    # apply
 *
 * (`medusa exec` rejects custom CLI flags, hence the env var.)
 *
 * Background
 * ----------
 * Medusa v2 does NOT store amounts in a currency's smallest unit. The `Price`
 * data model's `amount` is the currency's *major* unit - the docs are explicit
 * ("$20.00 is stored as 20") - and nothing converts it anywhere:
 *
 *   - `@medusajs/pricing` does `calculated_amount = parseFloat(price.amount)`
 *   - the admin dashboard formats the number as-is (`getStylizedAmount` never
 *     divides) and its price input submits the typed number raw
 *   - the stock storefront formats the amount directly too
 *
 * `seed-perfume-data.ts` was written on the opposite premise and multiplied every
 * OMR figure by 1000, so a 16 OMR perfume was stored as `16000` and rendered as
 * "OMR 16,000.000" in the admin (the storefront hid it by dividing by 1000).
 *
 * This script divides every OMR amount by 1000 - prices, shipping options,
 * fixed-value promotions, orders, carts and payments. Every seeded amount is an
 * exact multiple of 1000, so the conversion is lossless.
 *
 * Idempotent: a marker is written to the store's metadata and the script exits
 * early if it has already been applied.
 *
 * Safety: dry run by default. Take a database backup before `--apply`.
 */
import type { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

/** The seeded amounts are all multiples of this, so the division is exact. */
const DIVISOR = 1000
/** Marks the store once the repair has run, so re-runs are no-ops. */
const MARKER_KEY = 'omr_amount_unit'
const MARKER_VALUE = 'major'

type Target = {
  table: string
  /** Plain numeric columns to divide. */
  numeric: string[]
  /** `raw_<x>` jsonb columns whose `value` string is divided. */
  raw: string[]
  /** SQL predicate selecting the affected rows. */
  where: string
}

const TARGETS: Target[] = [
  // Product, shipping-option and price-list prices. Only OMR is affected; the
  // AED shipping prices were written in major units already.
  {
    table: 'price',
    numeric: ['amount'],
    raw: ['raw_amount'],
    where: `currency_code = 'omr'`,
  },
  // A fixed-value promotion (e.g. "20 OMR off"). Percentage promotions are not
  // affected, hence the `type = 'fixed'` guard.
  {
    table: 'promotion_application_method',
    numeric: ['value'],
    raw: ['raw_value'],
    where: `currency_code = 'omr' and type = 'fixed'`,
  },
  {
    table: 'order_line_item',
    numeric: ['unit_price', 'compare_at_unit_price'],
    raw: ['raw_unit_price', 'raw_compare_at_unit_price'],
    where: `deleted_at is null`,
  },
  {
    table: 'order_item',
    numeric: ['unit_price', 'compare_at_unit_price'],
    raw: ['raw_unit_price', 'raw_compare_at_unit_price'],
    where: `deleted_at is null`,
  },
  {
    table: 'order_shipping_method',
    numeric: ['amount'],
    raw: ['raw_amount'],
    where: `deleted_at is null`,
  },
  {
    table: 'order_transaction',
    numeric: ['amount'],
    raw: ['raw_amount'],
    where: `deleted_at is null`,
  },
  {
    table: 'payment',
    numeric: ['amount'],
    raw: ['raw_amount'],
    where: `deleted_at is null`,
  },
  {
    table: 'payment_collection',
    numeric: ['amount', 'authorized_amount', 'captured_amount', 'refunded_amount'],
    raw: [
      'raw_amount',
      'raw_authorized_amount',
      'raw_captured_amount',
      'raw_refunded_amount',
    ],
    where: `deleted_at is null`,
  },
  {
    table: 'payment_session',
    numeric: ['amount'],
    raw: ['raw_amount'],
    where: `deleted_at is null`,
  },
  {
    table: 'capture',
    numeric: ['amount'],
    raw: ['raw_amount'],
    where: `deleted_at is null`,
  },
  {
    table: 'cart_line_item',
    numeric: ['unit_price', 'compare_at_unit_price'],
    raw: ['raw_unit_price', 'raw_compare_at_unit_price'],
    where: `deleted_at is null`,
  },
  {
    table: 'cart_line_item_adjustment',
    numeric: ['amount'],
    raw: ['raw_amount'],
    where: `deleted_at is null`,
  },
  {
    table: 'cart_shipping_method',
    numeric: ['amount'],
    raw: ['raw_amount'],
    where: `deleted_at is null`,
  },
]

/** `amount` -> `amount / 1000`, skipping nulls. */
const numericSql = ({ table, numeric, where }: Target) =>
  numeric.map(
    (column) =>
      `update "${table}" set "${column}" = "${column}" / ${DIVISOR} ` +
      `where ${where} and "${column}" is not null`
  )

/**
 * `raw_amount` is `{"value":"16000","precision":20}`. The value stays a *string*
 * because Medusa's raw BigNumber fields are read as strings.
 */
const rawSql = ({ table, raw, where }: Target) =>
  raw.map(
    (column) =>
      `update "${table}" set "${column}" = jsonb_set("${column}", '{value}', ` +
      `to_jsonb((("${column}"->>'value')::numeric / ${DIVISOR})::text)) ` +
      `where ${where} and "${column}"->>'value' is not null`
  )

/**
 * `order_summary.totals` is a single jsonb holding every total, as a number plus
 * a `raw_*` sibling. Numbers are divided; `raw_*` objects have their `value`
 * string divided.
 */
const ORDER_SUMMARY_SQL = `
update order_summary set totals = (
  select jsonb_object_agg(
    key,
    case
      when key like 'raw%' then jsonb_set(
        value,
        '{value}',
        to_jsonb(((value->>'value')::numeric / ${DIVISOR})::text)
      )
      else to_jsonb((value #>> '{}')::numeric / ${DIVISOR})
    end
  )
  from jsonb_each(totals)
)
where deleted_at is null and totals is not null`

export default async function fixOmrAmountUnits({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  // `medusa exec` does not forward custom flags, so the switch is an env var.
  const apply = process.env.APPLY === '1'

  // ---- Idempotency guard --------------------------------------------------

  const storeRow = await knex.raw(`select id, metadata from store limit 1`)
  const store = storeRow?.rows?.[0]

  if (!store) {
    throw new Error('No store row found; nothing to do.')
  }

  if (store.metadata?.[MARKER_KEY] === MARKER_VALUE) {
    logger.info(
      `Already applied (store.metadata.${MARKER_KEY} = "${MARKER_VALUE}"). Nothing to do.`
    )
    return
  }

  // ---- Preview ------------------------------------------------------------

  logger.info(
    `Converting OMR amounts from baisa to OMR (divide by ${DIVISOR}) - ` +
      (apply ? 'APPLYING' : 'DRY RUN (pass --apply to write)')
  )

  const before = await knex.raw(
    `select currency_code, count(*)::int as rows, min(amount) as min, max(amount) as max
     from price where deleted_at is null group by 1 order by 1`
  )
  logger.info(`price before: ${JSON.stringify(before.rows)}`)

  const statements: string[] = [
    ...TARGETS.flatMap((target) => [...numericSql(target), ...rawSql(target)]),
    ORDER_SUMMARY_SQL,
  ]

  // ---- Apply --------------------------------------------------------------

  let totalRows = 0

  for (const sql of statements) {
    const table = sql.match(/update "([^"]+)"/)?.[1] ?? '?'

    if (!apply) {
      logger.info(`[dry run] ${table}: ${sql.replace(/\s+/g, ' ').slice(0, 110)}...`)
      continue
    }

    try {
      const result = await knex.raw(sql)
      const rowCount = result?.rowCount ?? 0
      totalRows += rowCount
      logger.info(`${table}: ${rowCount} row(s) updated`)
    } catch (error) {
      // A missing table (module not installed) is not fatal - report and go on.
      logger.warn(`${table}: skipped (${(error as Error).message.split('\n')[0]})`)
    }
  }

  if (!apply) {
    logger.info(`Dry run complete. ${statements.length} statement(s) would run.`)
    return
  }

  // ---- Mark as done -------------------------------------------------------

  await knex.raw(
    `update store
     set metadata = coalesce(metadata, '{}'::jsonb) || ?::jsonb
     where id = ?`,
    [JSON.stringify({ [MARKER_KEY]: MARKER_VALUE }), store.id]
  )

  const after = await knex.raw(
    `select currency_code, count(*)::int as rows, min(amount) as min, max(amount) as max
     from price where deleted_at is null group by 1 order by 1`
  )
  logger.info(`price after: ${JSON.stringify(after.rows)}`)
  logger.info(`Done. ${totalRows} row(s) updated across ${statements.length} statement(s).`)
  logger.info(
    'Restart the backend (or let it reload) so the in-memory pricing cache is rebuilt.'
  )
}
