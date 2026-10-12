/**
 * Removes everything the two seed scripts created, so the catalogue can be
 * rebuilt from scratch.
 *
 *   npx medusa exec ./src/scripts/unseed-perfume-data.ts
 *
 * Deleted:
 *   - every product, with its variants, prices and catalogue links
 *     variants, prices and catalogue links
 *   - the categories, tags, collections and shared options those seeds created
 *
 * Kept, deliberately, because they are store infrastructure rather than seed
 * output: the store, regions, sales channels, shipping profiles and options,
 * stock locations, fulfilment data, and inventory items.
 *
 * The search index is *not* left stale — deleting a product emits
 * `product.deleted`, which the index consumes. Because that runs on the local
 * event bus and a short-lived `medusa exec` can exit first, the affected ids are
 * also ingested explicitly here.
 *
 * This is destructive and NOT idempotent in the sense of being undoable: it
 * deletes rows. Re-running it is a no-op once the data is gone.
 */
import type { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils'
import {
  deleteCollectionsWorkflow,
  deleteProductCategoriesWorkflow,
  deleteProductOptionsWorkflow,
  deleteProductTagsWorkflow,
  deleteProductsWorkflow,
} from '@medusajs/medusa/core-flows'

/** Products per awaited delete call. */
const BATCH_SIZE = 10
/** Ids per awaited search-ingestion call. */
const INGEST_CHUNK_SIZE = 25

/** Handles created by `seed-demo-products.ts`. */
const DEMO_PREFIX = 'demo-perfume'

/** Categories created by `seed-perfume-data.ts`. */
const SEED_CATEGORIES = [
  'Amber & Oud',
  'Oud & Attars',
  'Musk & Skin Scents',
  'Floral Fragrances',
  'Fresh & Citrus',
  'Woody',
  'Floral',
  'Fresh',
  'Oriental',
  'Sweet',
  'Smoky',
]

/** Tags created by both seeds. */
const SEED_TAGS = [
  'oud',
  'amber',
  'woody',
  'floral',
  'rose',
  'musk',
  'citrus',
  'unisex',
  'bestseller',
  'new-arrival',
  'gift-ready',
  'everyday',
  'frankincense',
  'bakhoor',
  'attar',
  'oriental',
  'smoky',
  'sweet',
  'gift-set',
  'luxury',
]

/** Collections created by both seeds. */
const SEED_COLLECTIONS = [
  'Omani Heritage',
  'Oud Collection',
  'Daily Signatures',
  'Gift Edit',
  'Discovery Sets',
  'Omani Frankincense',
  'Arabic Attars',
  'Luxury Perfumes',
  'Bakhoor',
  'Gift Sets',
]

/**
 * Shared options created by the seeds. The template's own `Color` and `Size`
 * are left alone — they belong to the default products this project may still
 * be using.
 */
const SEED_OPTIONS = ['Volume', 'Concentration', 'Scent Family', 'Occasion']

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

export default async function unseedPerfumeData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // ---- Products -----------------------------------------------------------

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle', 'title'],
  })

  if (!products.length) {
    logger.info('No products to delete.')
  } else {
    const productIds = products.map((product) => product.id as string)
    const demoCount = products.filter((product) =>
      (product.handle ?? '').startsWith(DEMO_PREFIX)
    ).length
    const perfumeCount = products.length - demoCount

    logger.info(
      `Deleting ${products.length} product(s): ${perfumeCount} seeded perfume(s), ${demoCount} demo product(s).`
    )

    let deleted = 0

    for (const batch of chunk(productIds, BATCH_SIZE)) {
      // `deleteProductsWorkflow` cascades to variants, prices and the
      // catalogue links, which is why nothing is deleted by hand here.
      await deleteProductsWorkflow(container).run({ input: { ids: batch } })
      deleted += batch.length
      logger.info(`Deleted ${deleted}/${productIds.length} product(s)`)
    }

    // ---- Keep the search index in step ------------------------------------

    // `product.deleted` is handled asynchronously off the local event bus, and
    // the process may exit before the index has processed every event.
    const search = container.resolve(Modules.SEARCH)

    for (const batch of chunk(productIds, INGEST_CHUNK_SIZE)) {
      await search.ingest({
        name: 'product.deleted',
        data: batch.map((id) => ({ id })),
      } as never)
    }

    logger.info(`Removed ${productIds.length} product(s) from the search index.`)
  }

  // ---- Collections --------------------------------------------------------

  const { data: collections } = await query.graph({
    entity: 'product_collection',
    fields: ['id', 'title'],
  })
  const collectionIds = collections
    .filter((collection) => SEED_COLLECTIONS.includes(collection.title as string))
    .map((collection) => collection.id as string)

  if (collectionIds.length) {
    await deleteCollectionsWorkflow(container).run({ input: { ids: collectionIds } })
    logger.info(`Deleted ${collectionIds.length} collection(s)`)
  } else {
    logger.info('No seeded collections to delete.')
  }

  // ---- Categories ---------------------------------------------------------

  const { data: categories } = await query.graph({
    entity: 'product_category',
    fields: ['id', 'name'],
  })
  const categoryIds = categories
    .filter((category) => SEED_CATEGORIES.includes(category.name as string))
    .map((category) => category.id as string)

  if (categoryIds.length) {
    // Unlike the other delete workflows, this one takes a bare id array.
    await deleteProductCategoriesWorkflow(container).run({ input: categoryIds })
    logger.info(`Deleted ${categoryIds.length} categor${categoryIds.length === 1 ? 'y' : 'ies'}`)
  } else {
    logger.info('No seeded categories to delete.')
  }

  // ---- Tags ---------------------------------------------------------------

  const { data: tags } = await query.graph({
    entity: 'product_tag',
    fields: ['id', 'value'],
  })
  const tagIds = tags
    .filter((tag) => SEED_TAGS.includes(tag.value as string))
    .map((tag) => tag.id as string)

  if (tagIds.length) {
    await deleteProductTagsWorkflow(container).run({ input: { ids: tagIds } })
    logger.info(`Deleted ${tagIds.length} tag(s)`)
  } else {
    logger.info('No seeded tags to delete.')
  }

  // ---- Shared options -----------------------------------------------------
  // Deleting the option removes its values with it, so the seeds can recreate
  // both by title on the next run.

  const { data: options } = await query.graph({
    entity: 'product_option',
    fields: ['id', 'title', 'is_exclusive'],
    filters: { is_exclusive: false },
  })
  const optionIds = options
    .filter((option) => SEED_OPTIONS.includes(option.title as string))
    .map((option) => option.id as string)

  if (optionIds.length) {
    await deleteProductOptionsWorkflow(container).run({ input: { ids: optionIds } })
    logger.info(`Deleted ${optionIds.length} shared option(s)`)
  } else {
    logger.info('No seeded options to delete.')
  }

  logger.info('Done. Store, regions, sales channels, shipping and inventory were left untouched.')
}
