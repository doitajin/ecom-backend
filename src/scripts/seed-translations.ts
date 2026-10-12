/**
 * Seeds the locales and the Arabic translations for the whole catalogue.
 *
 *   npx medusa exec ./src/scripts/seed-translations.ts
 *
 * Requires the Translation Module, which is enabled by the `translation`
 * feature flag (MEDUSA_FF_TRANSLATION=true in .env + `featureFlags.translation`
 * in medusa-config.ts). Without it the module is disabled and this script
 * throws.
 *
 * What it does, idempotently:
 *   1. creates the `en-US` / `ar-OM` locale rows if they are missing
 *   2. sets the store's `supported_locales` to exactly those two - the core
 *      `GET /store/locales` route reads `store.supported_locales`, so without
 *      this the storefront switcher renders empty
 *   3. upserts the Arabic `ar-OM` translation rows for every translatable
 *      entity in the catalogue
 *
 * The Arabic comes from `data/ar-lexicon.ts`, the single source of truth - do
 * not duplicate it here. Re-running is safe: locales are skipped when present,
 * the store update is a no-op when unchanged, and translations are updated
 * rather than recreated.
 *
 * Which entities get translated is NOT decided here. It is whatever the DML
 * models declare with `.translatable()`, registered into `translation_settings`
 * on boot. This script only supplies values for them; run
 * `check-ar-coverage.ts` to see the full list and any gaps.
 *
 * On the read side, `applyTranslations` (@medusajs/utils) walks the whole
 * result graph, collects every nested object with an `id`, and matches
 * translations by `reference_id` ALONE - the `reference` column is not part of
 * the match. So a nested category/tag/option inside a product response is
 * translated automatically. What does NOT work is a store route that never
 * forwards the locale: `/store/product-options`, `/store/regions`,
 * `/store/shipping-options` and `/store/return-reasons` ignore it, so those
 * entities only translate where they appear nested inside a locale-aware
 * response (e.g. option values inside a product, a region inside a cart).
 */
import type {
  CreateTranslationDTO,
  ExecArgs,
  UpdateTranslationDTO,
} from '@medusajs/framework/types'
import {
  ContainerRegistrationKeys,
  Modules,
} from '@medusajs/framework/utils'
import {
  batchTranslationsWorkflow,
  updateStoresWorkflow,
} from '@medusajs/medusa/core-flows'

import {
  CATEGORY_AR,
  COLLECTION_AR,
  OPTION_TITLE_AR,
  OPTION_VALUE_AR,
  PRODUCT_AR,
  REGION_AR,
  SHIPPING_OPTION_AR,
  SHIPPING_OPTION_TYPE_AR,
  TAG_AR,
} from './data/ar-lexicon'

/** The languages the storefront switcher exposes, in display order. */
const LOCALES = [
  { code: 'en-US', name: 'English (United States)' },
  { code: 'ar-OM', name: 'Arabic (Oman)' },
]

/** The locale the lexicon is written in. English is the source, never seeded. */
const TRANSLATION_LOCALE = 'ar-OM'

/** Translation rows per workflow call. */
const BATCH_SIZE = 100

type Row = Record<string, unknown>

/**
 * One translatable entity type.
 *
 * `reference` must equal `toSnakeCase(entityName)` from the DML model - it is
 * the value `translation_settings.entity_type` holds and the one the admin's
 * translation list filters on. `keyOf` maps a row to its lexicon key.
 */
type Family = {
  reference: string
  entity: string
  fields: string[]
  lexicon: Record<string, unknown>
  keyOf: (row: Row) => string | undefined
  build: (row: Row) => Record<string, unknown> | null
}

const families: Family[] = [
  {
    reference: 'product',
    entity: 'product',
    fields: ['id', 'handle'],
    lexicon: PRODUCT_AR,
    keyOf: (row) => row.handle as string | undefined,
    build: (row) => {
      const arabic = PRODUCT_AR[row.handle as string]
      if (!arabic) {
        return null
      }
      return {
        title: arabic.title,
        subtitle: arabic.subtitle,
        description: arabic.description,
      }
    },
  },
  {
    reference: 'product_category',
    entity: 'product_category',
    fields: ['id', 'handle'],
    lexicon: CATEGORY_AR,
    keyOf: (row) => row.handle as string | undefined,
    build: (row) => {
      const name = CATEGORY_AR[row.handle as string]
      return name ? { name } : null
    },
  },
  {
    reference: 'product_collection',
    entity: 'product_collection',
    fields: ['id', 'handle'],
    lexicon: COLLECTION_AR,
    keyOf: (row) => row.handle as string | undefined,
    build: (row) => {
      const title = COLLECTION_AR[row.handle as string]
      return title ? { title } : null
    },
  },
  {
    reference: 'product_tag',
    entity: 'product_tag',
    fields: ['id', 'value'],
    lexicon: TAG_AR,
    keyOf: (row) => row.value as string | undefined,
    build: (row) => {
      const value = TAG_AR[row.value as string]
      return value ? { value } : null
    },
  },
  {
    reference: 'product_option',
    entity: 'product_option',
    fields: ['id', 'title'],
    lexicon: OPTION_TITLE_AR,
    keyOf: (row) => row.title as string | undefined,
    build: (row) => {
      const title = OPTION_TITLE_AR[row.title as string]
      return title ? { title } : null
    },
  },
  {
    reference: 'product_option_value',
    entity: 'product_option_value',
    fields: ['id', 'value'],
    lexicon: OPTION_VALUE_AR,
    keyOf: (row) => row.value as string | undefined,
    build: (row) => {
      const value = OPTION_VALUE_AR[row.value as string]
      return value ? { value } : null
    },
  },
  {
    reference: 'region',
    entity: 'region',
    fields: ['id', 'name'],
    lexicon: REGION_AR,
    keyOf: (row) => row.name as string | undefined,
    build: (row) => {
      const name = REGION_AR[row.name as string]
      return name ? { name } : null
    },
  },
  {
    reference: 'shipping_option',
    entity: 'shipping_option',
    fields: ['id', 'name'],
    lexicon: SHIPPING_OPTION_AR,
    keyOf: (row) => row.name as string | undefined,
    build: (row) => {
      const name = SHIPPING_OPTION_AR[row.name as string]
      return name ? { name } : null
    },
  },
  {
    reference: 'shipping_option_type',
    entity: 'shipping_option_type',
    fields: ['id', 'code'],
    lexicon: SHIPPING_OPTION_TYPE_AR,
    keyOf: (row) => row.code as string | undefined,
    build: (row) => {
      const arabic = SHIPPING_OPTION_TYPE_AR[row.code as string]
      return arabic ? { label: arabic.label, description: arabic.description } : null
    },
  },
]

type FamilyResult = {
  reference: string
  rows: number
  created: number
  updated: number
  /** Entities that exist but have no lexicon entry. */
  untranslated: string[]
  /** Lexicon keys that matched no entity - usually a renamed handle. */
  unmatched: string[]
}

/** Splits a list into fixed-size chunks. */
const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

/**
 * Upserts one family. Existing rows are matched on `reference_id` so a re-run
 * updates in place rather than tripping the unique index on
 * `(reference_id, locale_code)`.
 */
const seedFamily = async (
  family: Family,
  deps: { container: ExecArgs['container']; query: any; translation: any }
): Promise<FamilyResult> => {
  const { container, query, translation } = deps

  const { data: rows } = await query.graph({
    entity: family.entity,
    fields: family.fields,
  })

  const existing = await translation.listTranslations({
    reference: family.reference,
    locale_code: TRANSLATION_LOCALE,
  })
  const idByReferenceId = new Map<string, string>(
    existing.map((t: { reference_id: string; id: string }) => [
      t.reference_id,
      t.id,
    ])
  )

  const create: CreateTranslationDTO[] = []
  const update: UpdateTranslationDTO[] = []
  const untranslated: string[] = []
  const matchedKeys = new Set<string>()

  for (const row of rows as Row[]) {
    const key = family.keyOf(row)
    const translations = family.build(row)

    if (!key || !translations) {
      untranslated.push(key ?? String(row.id))
      continue
    }

    matchedKeys.add(key)

    const existingId = idByReferenceId.get(row.id as string)
    if (existingId) {
      update.push({ id: existingId, translations })
    } else {
      create.push({
        reference_id: row.id as string,
        reference: family.reference,
        locale_code: TRANSLATION_LOCALE,
        translations,
      })
    }
  }

  for (const batch of chunk(create, BATCH_SIZE)) {
    await batchTranslationsWorkflow(container).run({
      input: { create: batch, update: [], delete: [] },
    })
  }
  for (const batch of chunk(update, BATCH_SIZE)) {
    await batchTranslationsWorkflow(container).run({
      input: { create: [], update: batch, delete: [] },
    })
  }

  return {
    reference: family.reference,
    rows: (rows as Row[]).length,
    created: create.length,
    updated: update.length,
    untranslated,
    unmatched: Object.keys(family.lexicon).filter((k) => !matchedKeys.has(k)),
  }
}

export default async function seedTranslations({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const translation = container.resolve(Modules.TRANSLATION)
  const storeService = container.resolve(Modules.STORE)

  // 1) Ensure the locale rows exist. `createLocales` is not idempotent, so
  //    check first.
  const existingLocales = await translation.listLocales({})
  const existingCodes = new Set(existingLocales.map((locale) => locale.code))
  const missingLocales = LOCALES.filter(
    (locale) => !existingCodes.has(locale.code)
  )
  if (missingLocales.length) {
    await translation.createLocales(missingLocales)
    logger.info(
      `Created ${missingLocales.length} locale(s): ${missingLocales
        .map((locale) => locale.code)
        .join(', ')}`
    )
  } else {
    logger.info('Locales already present - nothing to create.')
  }

  // 2) Link the locales to the store. `GET /store/locales` reads
  //    `store.supported_locales`, so this is what makes them visible to the
  //    storefront.
  const [store] = await storeService.listStores({}, { take: 1 })
  if (!store) {
    logger.warn('No store found - skipping supported_locales.')
  } else {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: {
          supported_locales: LOCALES.map((locale) => ({
            locale_code: locale.code,
          })),
        },
      },
    })
    logger.info(
      `Set store supported_locales: ${LOCALES.map(
        (locale) => locale.code
      ).join(', ')}`
    )
  }

  // 3) Upsert the Arabic rows, one family at a time.
  const results: FamilyResult[] = []
  for (const family of families) {
    results.push(await seedFamily(family, { container, query, translation }))
  }

  logger.info('')
  logger.info('Arabic translations by entity type:')
  logger.info(
    '  entity                    rows  created  updated  missing Arabic'
  )
  for (const r of results) {
    logger.info(
      `  ${r.reference.padEnd(24)}${String(r.rows).padStart(4)}` +
        `${String(r.created).padStart(9)}${String(r.updated).padStart(9)}` +
        `${String(r.untranslated.length).padStart(16)}`
    )
  }

  // An entity with no Arabic, or a lexicon key with no entity, is a real
  // problem (a renamed handle silently orphans its translation) - surface both
  // rather than reporting a cheerful total.
  const missing = results.filter((r) => r.untranslated.length)
  const stale = results.filter((r) => r.unmatched.length)

  for (const r of missing) {
    logger.warn(
      `${r.reference}: no Arabic for ${r.untranslated.join(', ')}`
    )
  }
  for (const r of stale) {
    logger.warn(
      `${r.reference}: lexicon entries matching nothing - ${r.unmatched.join(', ')}`
    )
  }

  const created = results.reduce((n, r) => n + r.created, 0)
  const updated = results.reduce((n, r) => n + r.updated, 0)
  logger.info('')
  logger.info(`Done: ${created} created, ${updated} updated.`)
  if (missing.length || stale.length) {
    logger.warn('Coverage is incomplete - see the warnings above.')
  }
}
