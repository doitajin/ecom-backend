/**
 * Checks that `data/ar-lexicon.ts` covers the whole live catalogue - and holds
 * nothing for entities that no longer exist.
 *
 *   cd apps/backend
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node"}' \
 *     npx ts-node --transpile-only src/scripts/check-ar-coverage.ts
 *
 * The compiler override is required: the backend tsconfig sets
 * `module: NodeNext` without a matching `moduleResolution`, which ts-node
 * rejects outright (TS5109) and which otherwise makes `fetch` fail with an
 * opaque AggregateError.
 *
 * Run it after editing the lexicon and again after seeding, so a renamed handle
 * or a newly added tag cannot silently ship with no Arabic.
 *
 * It reads the Store API rather than the database, so it needs no container
 * boot and can run while `medusa develop` is up. The publishable key comes from
 * `MEDUSA_PUBLISHABLE_KEY`, falling back to the storefront's `.env.local`
 * (the canonical place for it in this repo).
 *
 * Not covered: shipping options and tax rates. The Store API only exposes
 * shipping options for a specific cart, so they are checked by the seed script
 * at write time instead.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  CATEGORY_AR,
  COLLECTION_AR,
  OPTION_TITLE_AR,
  OPTION_VALUE_AR,
  PRODUCT_AR,
  REGION_AR,
  TAG_AR,
} from './data/ar-lexicon'

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL ?? 'http://localhost:9000'

const loadKey = (): string => {
  const fromEnv = process.env.MEDUSA_PUBLISHABLE_KEY
  if (fromEnv) {
    return fromEnv
  }

  for (const candidate of [
    path.resolve(process.cwd(), '../storefront/.env.local'),
    path.resolve(process.cwd(), 'apps/storefront/.env.local'),
  ]) {
    if (!fs.existsSync(candidate)) {
      continue
    }
    const line = fs
      .readFileSync(candidate, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY='))
    if (line) {
      return line.slice('NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY='.length).trim()
    }
  }

  throw new Error(
    'No publishable key. Set MEDUSA_PUBLISHABLE_KEY or run from apps/backend.'
  )
}

const get = async <T>(path: string, key: string): Promise<T> => {
  let res: Response
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      headers: { 'x-publishable-api-key': key },
    })
  } catch (cause) {
    const error = cause as Error & { cause?: unknown }
    throw new Error(
      `GET ${BACKEND_URL}${path} failed: ${error.message}` +
        (error.cause ? ` (${String(error.cause)})` : '') +
        ' - is the backend running?'
    )
  }
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as T
}

type Gap = { family: string; missing: string[]; orphan: string[] }

const compare = (
  family: string,
  lexicon: Record<string, unknown>,
  live: string[]
): Gap => ({
  family,
  missing: live.filter((id) => !(id in lexicon)).sort(),
  orphan: Object.keys(lexicon)
    .filter((id) => !live.includes(id))
    .sort(),
})

const main = async () => {
  const key = loadKey()

  const [products, categories, collections, tags, options, regions] =
    await Promise.all([
      get<{ products: { handle: string }[] }>(
        '/store/products?limit=200&fields=id,handle',
        key
      ),
      get<{ product_categories: { handle: string }[] }>(
        '/store/product-categories?limit=200&fields=id,handle',
        key
      ),
      get<{ collections: { handle: string }[] }>(
        '/store/collections?limit=200&fields=id,handle',
        key
      ),
      get<{ product_tags: { value: string }[] }>(
        '/store/product-tags?limit=200&fields=id,value',
        key
      ),
      get<{ product_options: { title: string; values?: { value: string }[] }[] }>(
        '/store/product-options?limit=200',
        key
      ),
      get<{ regions: { name: string }[] }>('/store/regions', key),
    ])

  const optionTitles = options.product_options.map((o) => o.title)
  const optionValues = [
    ...new Set(
      options.product_options.flatMap((o) => (o.values ?? []).map((v) => v.value))
    ),
  ]

  const gaps: Gap[] = [
    compare(
      'product',
      PRODUCT_AR,
      products.products.map((p) => p.handle).filter(Boolean)
    ),
    compare(
      'product_category',
      CATEGORY_AR,
      categories.product_categories.map((c) => c.handle).filter(Boolean)
    ),
    compare(
      'product_collection',
      COLLECTION_AR,
      collections.collections.map((c) => c.handle).filter(Boolean)
    ),
    compare(
      'product_tag',
      TAG_AR,
      tags.product_tags.map((t) => t.value)
    ),
    compare('product_option', OPTION_TITLE_AR, optionTitles),
    compare('product_option_value', OPTION_VALUE_AR, optionValues),
    compare(
      'region',
      REGION_AR,
      regions.regions.map((r) => r.name)
    ),
  ]

  let failed = false

  // Coverage of entities is not the same as completeness of fields: an entity
  // can have an entry whose subtitle was left blank. The product shape is the
  // only one with more than a single field, so check it explicitly.
  const blankFields: string[] = []
  for (const [handle, arabic] of Object.entries(PRODUCT_AR)) {
    for (const field of ['title', 'subtitle', 'description'] as const) {
      if (!arabic[field]?.trim()) {
        blankFields.push(`${handle}.${field}`)
      }
    }
  }
  if (blankFields.length) {
    failed = true
    console.log(`FAIL product field completeness`)
    console.log(`       blank: ${blankFields.join(', ')}`)
  } else {
    console.log('OK   product field completeness')
  }

  for (const gap of gaps) {
    const ok = !gap.missing.length && !gap.orphan.length
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${gap.family}`)
    if (gap.missing.length) {
      failed = true
      console.log(`       no Arabic: ${gap.missing.join(', ')}`)
    }
    if (gap.orphan.length) {
      failed = true
      console.log(`       stale lexicon entry: ${gap.orphan.join(', ')}`)
    }
  }

  console.log(
    failed
      ? '\nArabic coverage INCOMPLETE - fix the gaps above.'
      : '\nArabic coverage complete.'
  )
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error(`\ncheck-ar-coverage failed: ${(error as Error).message}`)
  process.exit(1)
})
