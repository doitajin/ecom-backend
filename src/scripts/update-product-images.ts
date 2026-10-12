/**
 * Re-points the 12 generated product rasters at their own fragrance.
 *
 *   npx medusa exec ./src/scripts/update-product-images.ts
 *
 * Why this exists: `seed-perfume-data.ts` matches products by handle and
 * SKIPS any that already exist, so re-running it after adding new art does not
 * update an existing row's thumbnail. This script does exactly that, and
 * nothing else.
 *
 * Idempotent: setting the same thumbnail twice is a no-op in effect.
 */
import type { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'
import { updateProductsWorkflow } from '@medusajs/medusa/core-flows'

/** Locally served imagery from the storefront's public assets. */
const IMAGE = (name: string) => `/assets/images/${name}.webp`

/** Product handle -> its dedicated raster. */
const IMAGES: Record<string, string> = {
  'frankincense-ember': IMAGE('product-frankincense-ember'),
  'saffron-oud': IMAGE('product-saffron-oud'),
  'jasmine-attar': IMAGE('product-jasmine-attar'),
  'sandalwood-veil': IMAGE('product-sandalwood-veil'),
  'vanilla-oud': IMAGE('product-vanilla-oud'),
  'bakhoor-majan': IMAGE('product-bakhoor-majan'),
  'amber-sultan': IMAGE('product-amber-sultan'),
  'dhofar-rose-attar': IMAGE('product-dhofar-rose-attar'),
  'citrus-khareef': IMAGE('product-citrus-khareef'),
  'rosewood-dusk': IMAGE('product-rosewood-dusk'),
  'golden-hour': IMAGE('product-golden-hour'),
  'myrrh-smoke': IMAGE('product-myrrh-smoke'),
}

export default async function updateProductImages({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const handles = Object.keys(IMAGES)

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle', 'thumbnail'],
    filters: { handle: handles },
  })

  const updates = products
    .filter((product) => product.handle && IMAGES[product.handle])
    .map((product) => ({
      id: product.id,
      thumbnail: IMAGES[product.handle as string],
      images: [{ url: IMAGES[product.handle as string] }],
    }))

  if (!updates.length) {
    logger.warn('No matching products found - run seed-perfume-data.ts first.')
    return
  }

  await updateProductsWorkflow(container).run({
    input: { products: updates },
  })

  const missing = handles.filter(
    (handle) => !products.some((product) => product.handle === handle),
  )

  logger.info(`Updated the thumbnail for ${updates.length} product(s).`)
  if (missing.length) {
    logger.warn(`No product found for: ${missing.join(', ')}`)
  }
}
