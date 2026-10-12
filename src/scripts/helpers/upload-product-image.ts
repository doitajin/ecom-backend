/**
 * Uploads a storefront raster onto Medusa's file storage and returns its URL.
 *
 * Product imagery must live on Medusa rather than the storefront. A path like
 * `/assets/images/product-x.webp` only resolves on the storefront host, so the
 * admin dashboard - served by the backend - 404s it and shows a broken image.
 * Uploading yields a `/static/...` URL that resolves on either host.
 *
 * `access: 'public'` is required. The file provider defaults to `private`,
 * which writes into its private directory and prefixes the key with `private-`;
 * private files need a presigned URL with a real provider (S3).
 */
import type { IFileModuleService } from '@medusajs/framework/types'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Where the storefront keeps its source rasters, relative to `apps/backend`. */
export const STOREFRONT_ASSETS = path.resolve(
  process.cwd(),
  '../storefront/public/assets/images',
)

/** Re-uploading the same raster in one run is pointless; memoise by source path. */
const uploaded = new Map<string, string>()

/**
 * @param storefrontPath e.g. `/assets/images/product-bakhoor-majan.webp`
 * @returns the uploaded `/static/...` URL
 */
export async function uploadProductImage(
  fileModule: IFileModuleService,
  storefrontPath: string,
): Promise<string> {
  const cached = uploaded.get(storefrontPath)
  if (cached) {
    return cached
  }

  const filename = path.basename(storefrontPath)
  const content = await readFile(path.join(STOREFRONT_ASSETS, filename))

  const [file] = await fileModule.createFiles([
    {
      filename,
      mimeType: 'image/webp',
      content: content.toString('base64'),
      access: 'public',
    },
  ])

  if (!file?.url) {
    throw new Error(`Uploading ${filename} returned no url.`)
  }

  uploaded.set(storefrontPath, file.url)
  return file.url
}
