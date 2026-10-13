/**
 * Moves product imagery onto Medusa's own file storage.
 *
 *   npx medusa exec ./src/scripts/upload-product-images.ts
 *
 * Why this exists: the perfume seed originally wrote STOREFRONT-relative paths
 * (`/assets/images/product-x.webp`). Those only resolve on the storefront host,
 * so the admin dashboard - served by the backend on :9000 - 404s every one of
 * them and shows a broken image. Medusa's file-local provider serves from
 * `/static`, which resolves on either host.
 *
 * Re-points every product whose thumbnail is not already a public `/static`
 * URL, so it repairs both relative paths and an earlier bad upload made with
 * the default `access: private`. Safe to re-run.
 */
import type { ExecArgs } from '@medusajs/framework/types'
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from '@medusajs/framework/utils'
import { updateProductsWorkflow } from '@medusajs/medusa/core-flows'
import path from 'node:path'

import { uploadProductImage } from './helpers/upload-product-image'

/**
 * A thumbnail that is already on Medusa storage AND public.
 *
 * `access` defaults to `private`, which writes into the provider's private
 * directory and prefixes the key with `private-`. Private files would need a
 * presigned URL with a real provider (S3), so product imagery must be public.
 */
const isPublicStatic = (url: unknown, backendUrl: string) => {
  if (
    typeof url !== 'string' ||
    !url.includes('/static/') ||
    url.includes('/static/private-')
  ) {
    return false
  }

  try {
    return new URL(url, backendUrl).origin === new URL(backendUrl).origin
  } catch {
    return false
  }
}

/**
 * Recovers the on-disk filename from whatever is stored on the product.
 *
 * Handles both shapes this script can encounter:
 *   `/assets/images/product-x.webp`                -> `product-x.webp`
 *   `http://.../static/private-123-product-x.webp` -> `product-x.webp`
 *   `http://.../static/123-product-x.webp`         -> `product-x.webp`
 */
const sourceFilename = (thumbnail: string) =>
  path.basename(thumbnail)
    .replace(/^private-\d+-/, '')
    .replace(/^\d+-/, '')

export default async function uploadProductImages({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fileModule = container.resolve(Modules.FILE)
  const backendUrl = process.env.MEDUSA_BACKEND_URL

  if (!backendUrl) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'MEDUSA_BACKEND_URL must be set before repairing product images.',
    )
  }

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'handle', 'thumbnail'],
  })

  const stale = products.filter(
    (product) => !isPublicStatic(product.thumbnail, backendUrl),
  )

  if (!stale.length) {
    logger.info('Every product already points at public Medusa storage.')
    return
  }

  const updates: { id: string; thumbnail: string; images: { url: string }[] }[] =
    []

  for (const product of stale) {
    const filename = sourceFilename(product.thumbnail as string)

    let url: string
    try {
      url = await uploadProductImage(
        fileModule,
        `/assets/images/${filename}`,
      )
    } catch {
      logger.warn(`Skipping ${product.handle}: could not upload ${filename}.`)
      continue
    }

    updates.push({
      id: product.id,
      thumbnail: url,
      images: [{ url }],
    })
    logger.info(`Uploaded ${filename} -> ${url}`)
  }

  if (!updates.length) {
    logger.warn('Nothing uploaded.')
    return
  }

  await updateProductsWorkflow(container).run({
    input: { products: updates },
  })

  logger.info(`Re-pointed ${updates.length} product(s) at Medusa storage.`)
}
