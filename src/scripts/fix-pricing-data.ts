/**
 * Repair pass over the shop's price data, driven by the 2026-10-18 audit:
 *
 *   1. Junk OMR rows. `fix-omr-amount-units.ts` divided every OMR amount by
 *      1000 to undo a baisa-seeded multiply. It ran over a re-seeded catalogue
 *      where some sets already held major-unit rows, so those rows were divided
 *      a second time (12 -> 0.012). The result: 624 OMR price rows below 1 OMR
 *      (0.011 - 0.21) sitting next to the correct rows. The Pricing Module
 *      currently resolves the newest row, so the correct one wins - but the junk
 *      rows are latent landmines (a quantity rule or a price-list match can make
 *      one of them win, showing "OMR 0.012").
 *
 *   2. Missing AED prices. The UAE region offers AED, but only 1 of the 106
 *      sellable price sets has an AED row (a one-off hand fix). Everywhere else
 *      the region returns no calculated price, so product pages show no price
 *      and cannot be added to the cart. This writes AED = OMR x 10 for every
 *      set that has a correct OMR price - the same 10x rate the existing AED
 *      row uses (OMR 17 -> AED 170), which also matches the OMR peg.
 *
 *   npx medusa exec ./src/scripts/fix-pricing-data.ts            # dry run
 *   APPLY=1 npx medusa exec ./src/scripts/fix-pricing-data.ts    # apply
 *
 * Idempotent: a marker is written to the store's metadata; re-runs are no-ops.
 * Take a database backup before applying.
 */
import type { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

/** AED per 1 OMR. Matches the existing hand-written AED row (17 -> 170). */
const AED_RATE = 10
/** OMR amounts below this are the twice-divided leftovers. */
const JUNK_THRESHOLD = 1
/** Marks the pass once applied, so re-runs are no-ops. */
const MARKER_KEY = 'pricing_data_repair'
const MARKER_VALUE = 'v1'

export default async function fixPricingData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

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

  logger.info(
    `Pricing data repair - ` + (apply ? 'APPLYING' : 'DRY RUN (pass APPLY=1 to write)')
  )

  // ---- 1. Delete junk OMR rows --------------------------------------------

  const junk = await knex.raw(
    `select count(*)::int as rows from price
     where deleted_at is null and currency_code = 'omr' and amount < ?`,
    [JUNK_THRESHOLD]
  )
  const junkRows = junk.rows[0].rows

  const junkSets = await knex.raw(
    `select count(distinct price_set_id)::int as sets from price
     where deleted_at is null and currency_code = 'omr' and amount < ?`,
    [JUNK_THRESHOLD]
  )
  const junkSetCount = junkSets.rows[0].sets

  const mixedSets = await knex.raw(
    `select count(*)::int as sets from (
       select price_set_id from price
       where deleted_at is null and currency_code = 'omr'
       group by price_set_id
       having max(amount) >= ? and min(amount) < ?
     ) t`,
    [JUNK_THRESHOLD, JUNK_THRESHOLD]
  )
  const mixedSetCount = mixedSets.rows[0].sets

  logger.info(
    `Junk OMR rows: ${junkRows} row(s) across ${junkSetCount} set(s); ` +
      `${mixedSetCount} set(s) also hold a correct row.`
  )

  // ---- 2. Seed AED prices -------------------------------------------------

  // Every set that has a correct OMR row but no AED row. The correct row is the
  // max OMR amount in the set (junk rows are < 1 by construction).
  const missingAed = await knex.raw(
    `select ps.id as price_set_id, max(pr.amount) as omr_amount
     from price_set ps
     join price pr on pr.price_set_id = ps.id and pr.deleted_at is null
     where pr.currency_code = 'omr' and pr.amount >= ?
       and not exists (
         select 1 from price p2
         where p2.price_set_id = ps.id and p2.deleted_at is null
           and p2.currency_code = 'aed'
       )
     group by ps.id`,
    [JUNK_THRESHOLD]
  )
  const aedTargets = missingAed.rows

  logger.info(
    `Missing AED prices: ${aedTargets.length} set(s) would get ` +
      `aed = omr x ${AED_RATE}.`
  )

  if (!apply) {
    for (const row of aedTargets.slice(0, 5)) {
      logger.info(
        `[dry run] ${row.price_set_id}: aed ${Number(row.omr_amount) * AED_RATE} ` +
          `(omr ${Number(row.omr_amount)})`
      )
    }
    if (aedTargets.length > 5) {
      logger.info(`[dry run] ... and ${aedTargets.length - 5} more`)
    }
    logger.info('Dry run complete. Re-run with APPLY=1 to write.')
    return
  }

  // ---- Apply (single transaction) ------------------------------------------

  await knex.transaction(async (trx) => {
    // 1. junk first, so a set that only had junk rows cannot seed a bogus AED.
    const deleted = await trx.raw(
      `delete from price
       where deleted_at is null and currency_code = 'omr' and amount < ?`,
      [JUNK_THRESHOLD]
    )
    logger.info(`Deleted ${deleted.rowCount ?? 0} junk OMR price row(s).`)

    // 2. AED rows, computed from the surviving correct rows.
    let inserted = 0
    for (const row of aedTargets) {
      const omrAmount = Number(row.omr_amount)
      const aedAmount = omrAmount * AED_RATE
      await trx.raw(
        `insert into price (id, price_set_id, currency_code, amount, raw_amount, created_at, updated_at)
         values (
           concat('price_', replace(gen_random_uuid()::text, '-', '')),
           ?, 'aed', ?,
           jsonb_build_object('value', (?::numeric)::text, 'precision', 20),
           now(), now()
         )`,
        [row.price_set_id, aedAmount, aedAmount]
      )
      inserted += 1
    }
    logger.info(`Inserted ${inserted} AED price row(s).`)

    // 3. marker
    await trx.raw(
      `update store
       set metadata = coalesce(metadata, '{}'::jsonb) || ?::jsonb
       where id = ?`,
      [JSON.stringify({ [MARKER_KEY]: MARKER_VALUE }), store.id]
    )
  })

  logger.info(
    'Done. Reindex search so the listing picks up the new AED prices: ' +
      'npx medusa exec ./src/scripts/reindex-search.ts'
  )
}
