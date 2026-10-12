/**
 * Backfills `metadata.name_ar` and `metadata.family` onto products that predate
 * those fields.
 *
 *   npx medusa exec ./src/scripts/backfill-product-metadata.ts
 *
 * Why this exists: `seed-perfume-data.ts` matches products by handle and SKIPS
 * any that already exist, so the six fragrances that were seeded before the
 * redesign never received their Arabic name or scent family. Everything else in
 * the catalogue has both.
 *
 * Reads `PERFUMES` from the seed so there is one source of truth for the Arabic
 * names - do not duplicate them here.
 *
 * Idempotent: only writes when a field is missing, and reports what it skipped.
 */
import type { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { updateProductsWorkflow } from '@medusajs/medusa/core-flows'

import { PRODUCT_AR } from './data/ar-lexicon'
import { PERFUMES } from './seed-perfume-data'

export default async function backfillProductMetadata({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const byHandle = new Map(PERFUMES.map((perfume) => [perfume.handle, perfume]))

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle', 'metadata'],
    filters: { handle: [...byHandle.keys()] },
  })

  const updates = products
    .filter((product) => product.handle && byHandle.has(product.handle))
    .map((product) => {
      const perfume = byHandle.get(product.handle as string)!
      return {
        id: product.id,
        handle: product.handle as string,
        metadata: {
          ...(product.metadata ?? {}),
          name_ar: PRODUCT_AR[product.handle as string]?.title,
          family: perfume.family,
        },
      }
    })
    .filter((update) => {
      const existing = products.find((product) => product.id === update.id)
        ?.metadata as Record<string, unknown> | null
      return (
        existing?.name_ar !== update.metadata.name_ar ||
        existing?.family !== update.metadata.family
      )
    })

  if (!updates.length) {
    logger.info('Nothing to backfill - every product already has name_ar and family.')
    return
  }

  await updateProductsWorkflow(container).run({
    input: {
      products: updates.map(({ id, metadata }) => ({ id, metadata })),
    },
  })

  logger.info(`Backfilled name_ar + family on ${updates.length} product(s).`)
  for (const update of updates) {
    logger.info(`  ${update.handle} -> ${update.metadata.name_ar} (${update.metadata.family})`)
  }
}
