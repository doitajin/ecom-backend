import type { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'

/**
 * Rebuilds the product index from the catalogue.
 *
 * Needed after a translation change. The Translation Module emits no events, so
 * nothing re-indexes the `*_ar` fields when a translation is edited in the admin
 * - the same gap price lists have for prices. A schema change (adding or
 * removing a field) is picked up on its own, but an edit to a translation row is
 * not.
 *
 * `reindex` is used rather than `ingest`, and the difference matters. `ingest`
 * only writes documents into the index's current table: it never calls the
 * provider's `upsertIndex`, which is what rebuilds the **plan** the provider
 * validates queries against. A field that only exists in the new documents is
 * therefore retrievable but not filterable, sortable or facetable - the
 * documents carry it, the engine refuses to query on it. `reindex` builds a new
 * version, which runs `upsertIndex` and so refreshes the plan, then swaps it
 * live. It awaits the whole run, so a short-lived `medusa exec` is safe.
 *
 *   npx medusa exec ./src/scripts/reindex-search.ts
 */
export default async function reindexSearch({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const search = container.resolve(Modules.SEARCH)

  const { job_id, indexes } = await search.reindex({ index: 'product' })

  logger.info(`Reindexed ${indexes.join(', ')} (job ${job_id}).`)
}
