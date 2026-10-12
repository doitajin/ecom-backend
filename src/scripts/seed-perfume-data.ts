/**
 * Seed data for the perfume shop: six fragrances, priced in OMR.
 *
 *   npx medusa exec ./src/scripts/seed-perfume-data.ts
 *
 * Creates, idempotently:
 *   - the `omr` store currency and its region, if missing
 *   - categories, tags, collections and shared (non-exclusive) options
 *   - 18 fragrances, one variant per volume (plus an Extrait where noted)
 *   - inventory levels at the stock location
 *   - a search-index pass so `/store/search` returns them immediately
 *
 * Anything that already exists is reused, so re-running is safe. Re-running
 * after an edit to a product below updates nothing — products are matched by
 * handle and skipped. Delete a handle first (or run the unseed script) to
 * recreate it.
 *
 * Currency: OMR only. The storefront's default region is `om` (OMR) and it
 * reads listing prices from the search index, so `omr` must appear in the
 * index's `PRICE_CURRENCIES` (`src/search/helpers/pricing.ts`) and in
 * `SEARCH_PRICE_CURRENCIES` (storefront `src/lib/search-client.ts`). If it is
 * missing from either, listings render with no price.
 */
import type { ExecArgs } from '@medusajs/framework/types'
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  ProductStatus,
} from '@medusajs/framework/utils'
import {
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductOptionsWorkflow,
  createProductTagsWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from '@medusajs/medusa/core-flows'

import { PRODUCT_AR } from './data/ar-lexicon'
import { uploadProductImage } from './helpers/upload-product-image'

/** Products per create call. */
const BATCH_SIZE = 6
/** Products per awaited search-ingestion call. */
const INGEST_CHUNK_SIZE = 25

/** The store trades in OMR only. */
const CURRENCY = 'omr'
/** The store's default region country. */
const COUNTRY_CODE = 'om'

/** Locally served imagery from the storefront's public assets. */
const IMAGE = (name: string) => `/assets/images/${name}.webp`

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { name: 'Woody', handle: 'woody' },
  { name: 'Floral', handle: 'floral' },
  { name: 'Fresh', handle: 'fresh' },
  { name: 'Oriental', handle: 'oriental' },
  { name: 'Sweet', handle: 'sweet' },
  { name: 'Smoky', handle: 'smoky' },
]

const TAGS = [
  'citrus',
  'oud',
  'rose',
  'floral',
  'musk',
  'woody',
  'amber',
  'fresh',
  'oriental',
  'sweet',
  'smoky',
  'frankincense',
  'bakhoor',
  'attar',
  'unisex',
  'bestseller',
  'gift-ready',
  'gift-set',
  'luxury',
  'everyday',
]

const COLLECTIONS = [
  'Oud Collection',
  'Omani Frankincense',
  'Arabic Attars',
  'Luxury Perfumes',
  'Bakhoor',
  'Gift Sets',
]

/**
 * Shared (non-exclusive) options. Non-exclusive is what makes them global
 * filter facets — the storefront lists them via `/store/product-options` and
 * filters the catalogue on the value ids the user picks.
 */
const SHARED_OPTIONS = [
  { title: 'Volume', values: ['10 ml', '30 ml', '50 ml', '100 ml'] },
  { title: 'Concentration', values: ['Eau de Parfum', 'Extrait'] },
  {
    title: 'Scent Family',
    values: ['Woody', 'Floral', 'Fresh', 'Oriental', 'Sweet', 'Smoky'],
  },
]

// ---------------------------------------------------------------------------
// Catalogue — one entry per supplied product image
// ---------------------------------------------------------------------------

export type Perfume = {
  title: string
  family: 'Woody' | 'Floral' | 'Fresh' | 'Oriental' | 'Sweet' | 'Smoky'
  handle: string
  subtitle: string
  description: string
  image: string
  category: string
  collection: string
  tags: string[]
  weight: number
  /** OMR price per volume. */
  prices: { '10 ml': number; '30 ml': number; '50 ml': number; '100 ml': number }
  /** Whether the fragrance is also offered as an Extrait. */
  extrait?: boolean
}

/**
 * Medusa v2 does NOT scale prices. A `Price`'s `amount` is the currency's
 * *major* unit - the docs' example is "$20.00 is stored as `20`" - and nothing
 * converts it: the pricing module does `parseFloat(price.amount)`, the admin
 * dashboard formats the number as-is, and the stock storefront does too.
 *
 * So the human-readable OMR figures below are passed through untouched: an OMR
 * price of 16 is stored as `16` and renders as "OMR 16.000". Scaling them by
 * 1000 would store 16 OMR as `16000` and render as "OMR 16,000.000".
 *
 * OMR's three decimals need no pre-multiplication - the currency's
 * `decimal_digits` handles them at format time.
 */

const VOLUMES = ['10 ml', '30 ml', '50 ml', '100 ml'] as const

export const PERFUMES: Perfume[] = [
  {
    title: 'Neroli Fresh',
    family: 'Fresh',
    handle: 'neroli-fresh',
    subtitle: 'Neroli, bergamot and green citrus',
    description:
      'A bright citrus composition of neroli, bergamot and green notes, made for sunlit mornings and warm coastal air. Opens sharp and green, then settles into a clean musk that holds through the heat.',
    image: IMAGE('product-neroli-fresh'),
    category: 'Fresh',
    collection: 'Luxury Perfumes',
    tags: ['citrus', 'fresh', 'everyday', 'unisex'],
    weight: 250,
    prices: { '10 ml': 12, '30 ml': 24, '50 ml': 36, '100 ml': 52 },
  },
  {
    title: 'Oud Noir',
    family: 'Smoky',
    handle: 'oud-noir',
    subtitle: 'Smoky oud, incense and dark woods',
    description:
      'A deep, resinous oud with incense and dark woods, composed in the spirit of traditional Omani perfumery. The heaviest fragrance in the collection — a single spray lasts a full evening.',
    image: IMAGE('product-oud-noir'),
    category: 'Smoky',
    collection: 'Oud Collection',
    tags: ['oud', 'woody', 'amber', 'bestseller', 'unisex'],
    weight: 250,
    prices: { '10 ml': 21, '30 ml': 42, '50 ml': 64, '100 ml': 90 },
    extrait: true,
  },
  {
    title: 'Rose Oud',
    family: 'Floral',
    handle: 'rose-oud',
    subtitle: 'Velvety rose layered over Omani oud',
    description:
      'A graceful meeting of velvety rose and Omani oud, warmed with amber for a long-lasting evening fragrance. The rose leads for the first hour, then the oud takes over.',
    image: IMAGE('product-rose-oud'),
    category: 'Floral',
    collection: 'Arabic Attars',
    tags: ['oud', 'rose', 'floral', 'gift-ready'],
    weight: 250,
    prices: { '10 ml': 19, '30 ml': 38, '50 ml': 59, '100 ml': 84 },
    extrait: true,
  },
  {
    title: 'Taif Rose',
    family: 'Floral',
    handle: 'taif-rose',
    subtitle: 'Taif rose, jasmine and delicate spice',
    description:
      'A luminous floral blend of Taif rose, jasmine and a trace of spice, balanced with a smooth amber base. A true rose rather than a rose accord — greener and less sweet than most.',
    image: IMAGE('product-taif-rose'),
    category: 'Floral',
    collection: 'Gift Sets',
    tags: ['floral', 'rose', 'gift-ready', 'bestseller'],
    weight: 250,
    prices: { '10 ml': 17, '30 ml': 33, '50 ml': 51, '100 ml': 72 },
    extrait: true,
  },
  {
    title: 'Cedar Veil',
    family: 'Woody',
    handle: 'cedar-veil',
    subtitle: 'Cedarwood, frankincense and soft musk',
    description:
      "A composed woody fragrance inspired by Oman's frankincense trails, layered with dry cedar and a quiet musk finish. Restrained and close-wearing — easy to wear to work.",
    image: IMAGE('product-cedar-veil'),
    category: 'Woody',
    collection: 'Omani Frankincense',
    tags: ['woody', 'amber', 'musk', 'everyday', 'unisex'],
    weight: 250,
    prices: { '10 ml': 16, '30 ml': 31, '50 ml': 48, '100 ml': 68 },
  },
  {
    title: 'White Musk',
    family: 'Fresh',
    handle: 'white-musk',
    subtitle: 'Clean musk, cotton blossom and pale woods',
    description:
      "A soft, close-wearing musk with airy cotton blossom and pale woods. An easy everyday scent for Oman's warm climate, and the most versatile in the collection.",
    image: IMAGE('product-musk-white'),
    category: 'Fresh',
    collection: 'Luxury Perfumes',
    tags: ['musk', 'floral', 'everyday', 'unisex'],
    weight: 250,
    prices: { '10 ml': 14, '30 ml': 27, '50 ml': 41, '100 ml': 58 },
  },
  {
    title: 'Frankincense Ember',
    family: 'Smoky',
    handle: 'frankincense-ember',
    subtitle: 'Frankincense, warm resin and soft woods',
    description:
      'A warm resinous fragrance inspired by the quiet smoke of frankincense, softened with dry woods and a gentle amber finish.',
    image: IMAGE('product-frankincense-ember'),
    category: 'Smoky',
    collection: 'Omani Frankincense',
    tags: ['frankincense', 'smoky', 'amber', 'unisex'],
    weight: 250,
    prices: { '10 ml': 15, '30 ml': 29, '50 ml': 44, '100 ml': 62 },
  },
  {
    title: 'Saffron Oud',
    family: 'Oriental',
    handle: 'saffron-oud',
    subtitle: 'Saffron, oud and glowing amber',
    description:
      'A richly toned blend where warm saffron meets the depth of oud and a smooth amber accord.',
    image: IMAGE('product-saffron-oud'),
    category: 'Oriental',
    collection: 'Oud Collection',
    tags: ['oud', 'oriental', 'amber', 'luxury', 'unisex'],
    weight: 250,
    prices: { '10 ml': 20, '30 ml': 39, '50 ml': 60, '100 ml': 86 },
    extrait: true,
  },
  {
    title: 'Jasmine Attar',
    family: 'Floral',
    handle: 'jasmine-attar',
    subtitle: 'Jasmine petals, rose and a soft musk base',
    description:
      'A luminous floral attar built around jasmine and rose, settling close to the skin with a soft musk finish.',
    image: IMAGE('product-jasmine-attar'),
    category: 'Floral',
    collection: 'Arabic Attars',
    tags: ['attar', 'floral', 'rose', 'musk', 'gift-ready'],
    weight: 250,
    prices: { '10 ml': 18, '30 ml': 34, '50 ml': 53, '100 ml': 76 },
    extrait: true,
  },
  {
    title: 'Sandalwood Veil',
    family: 'Woody',
    handle: 'sandalwood-veil',
    subtitle: 'Sandalwood, cedar and quiet musk',
    description:
      'Creamy sandalwood and dry cedar meet a restrained musk for a composed, close-wearing woody fragrance.',
    image: IMAGE('product-sandalwood-veil'),
    category: 'Woody',
    collection: 'Luxury Perfumes',
    tags: ['woody', 'musk', 'luxury', 'unisex'],
    weight: 250,
    prices: { '10 ml': 17, '30 ml': 32, '50 ml': 49, '100 ml': 70 },
  },
  {
    title: 'Vanilla Oud',
    family: 'Sweet',
    handle: 'vanilla-oud',
    subtitle: 'Soft vanilla, oud and amber woods',
    description:
      'A measured sweetness of vanilla wrapped around dark oud and warm woods, balanced with amber.',
    image: IMAGE('product-vanilla-oud'),
    category: 'Sweet',
    collection: 'Oud Collection',
    tags: ['oud', 'sweet', 'amber', 'unisex'],
    weight: 250,
    prices: { '10 ml': 19, '30 ml': 37, '50 ml': 56, '100 ml': 80 },
    extrait: true,
  },
  {
    title: 'Bakhoor Majan',
    family: 'Smoky',
    handle: 'bakhoor-majan',
    subtitle: 'Incense smoke, resin and dark woods',
    description:
      'A smoky, resinous perfume inspired by the warmth of bakhoor rituals, with dark woods and a lingering amber trail.',
    image: IMAGE('product-bakhoor-majan'),
    category: 'Smoky',
    collection: 'Bakhoor',
    tags: ['bakhoor', 'smoky', 'frankincense', 'woody', 'unisex'],
    weight: 250,
    prices: { '10 ml': 16, '30 ml': 31, '50 ml': 48, '100 ml': 68 },
  },
  {
    title: 'Amber Sultan',
    family: 'Oriental',
    handle: 'amber-sultan',
    subtitle: 'Golden amber, spice and smooth woods',
    description:
      'Golden amber and gentle spice rest over smooth woods in a warm, enveloping composition.',
    image: IMAGE('product-amber-sultan'),
    category: 'Oriental',
    collection: 'Luxury Perfumes',
    tags: ['amber', 'oriental', 'luxury', 'unisex'],
    weight: 250,
    prices: { '10 ml': 18, '30 ml': 35, '50 ml': 54, '100 ml': 78 },
    extrait: true,
  },
  {
    title: 'Dhofar Rose Attar',
    family: 'Floral',
    handle: 'dhofar-rose-attar',
    subtitle: 'Rose, soft spice and a resinous heart',
    description:
      'A rose-led attar with gentle spice and a resinous warmth, composed as a quiet floral for day or evening.',
    image: IMAGE('product-dhofar-rose-attar'),
    category: 'Floral',
    collection: 'Arabic Attars',
    tags: ['attar', 'rose', 'floral', 'gift-ready'],
    weight: 250,
    prices: { '10 ml': 18, '30 ml': 35, '50 ml': 54, '100 ml': 77 },
    extrait: true,
  },
  {
    title: 'Citrus Khareef',
    family: 'Fresh',
    handle: 'citrus-khareef',
    subtitle: 'Green citrus, neroli and cool musk',
    description:
      'A bright green-citrus composition with neroli and cool musk, inspired by the freshness of a passing summer rain.',
    image: IMAGE('product-citrus-khareef'),
    category: 'Fresh',
    collection: 'Omani Frankincense',
    tags: ['citrus', 'fresh', 'everyday', 'unisex'],
    weight: 250,
    prices: { '10 ml': 13, '30 ml': 25, '50 ml': 38, '100 ml': 55 },
  },
  {
    title: 'Rosewood Dusk',
    family: 'Woody',
    handle: 'rosewood-dusk',
    subtitle: 'Rosewood, rose and a soft amber trail',
    description:
      'Dry rosewood and velvety rose settle into soft amber, creating a warm woody-floral balance.',
    image: IMAGE('product-rosewood-dusk'),
    category: 'Woody',
    collection: 'Oud Collection',
    tags: ['woody', 'rose', 'amber', 'unisex'],
    weight: 250,
    prices: { '10 ml': 18, '30 ml': 34, '50 ml': 52, '100 ml': 75 },
  },
  {
    title: 'Golden Hour',
    family: 'Sweet',
    handle: 'golden-hour',
    subtitle: 'Honeyed amber, vanilla and pale woods',
    description:
      'A soft amber sweetness with vanilla and pale woods, made for an easy transition from daylight to evening.',
    image: IMAGE('product-golden-hour'),
    category: 'Sweet',
    collection: 'Gift Sets',
    tags: ['sweet', 'amber', 'gift-ready', 'gift-set'],
    weight: 250,
    prices: { '10 ml': 17, '30 ml': 33, '50 ml': 50, '100 ml': 72 },
  },
  {
    title: 'Myrrh Smoke',
    family: 'Smoky',
    handle: 'myrrh-smoke',
    subtitle: 'Myrrh, incense and a dry resin finish',
    description:
      'Dry resin and smoky incense meet a balsamic myrrh accord for a deep, meditative fragrance.',
    image: IMAGE('product-myrrh-smoke'),
    category: 'Smoky',
    collection: 'Bakhoor',
    tags: ['smoky', 'bakhoor', 'frankincense', 'woody'],
    weight: 250,
    prices: { '10 ml': 16, '30 ml': 31, '50 ml': 47, '100 ml': 67 },
  },
]

// ---------------------------------------------------------------------------

export default async function seedPerfumeData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fileModule = container.resolve(Modules.FILE)

  // ---- Currency and region ------------------------------------------------

  const { data: stores } = await query.graph({
    entity: 'store',
    fields: ['id', 'name', 'supported_currencies.currency_code'],
  })

  if (!stores.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      'No store found. Run the initial data seed first.'
    )
  }

  const store = stores[0]
  const supported = (store.supported_currencies ?? [])
    .map((entry) => entry?.currency_code?.toLowerCase())
    .filter((code): code is string => Boolean(code))

  if (!supported.includes(CURRENCY)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `The store does not support ${CURRENCY.toUpperCase()} (found: ${supported.join(', ') || 'none'}). ` +
        'Add it in the admin before seeding.'
    )
  }

  const { data: regions } = await query.graph({
    entity: 'region',
    fields: ['id', 'name', 'currency_code'],
  })

  const regionCurrencies = new Set(
    regions
      .map((region) => region.currency_code?.toLowerCase())
      .filter((code): code is string => Boolean(code))
  )
  const hasRegion = [...regionCurrencies].some((code) => code === CURRENCY)

  if (!hasRegion) {
    await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: 'Oman',
            currency_code: CURRENCY,
            countries: [COUNTRY_CODE],
            payment_providers: ['pp_system_default'],
          },
        ],
      },
    })
    logger.info(`Created the ${CURRENCY.toUpperCase()} region for "${COUNTRY_CODE}".`)
  }

  // ---- Prerequisites ------------------------------------------------------

  const { data: salesChannels } = await query.graph({
    entity: 'sales_channel',
    fields: ['id', 'name'],
  })
  const { data: shippingProfiles } = await query.graph({
    entity: 'shipping_profile',
    fields: ['id'],
  })
  const { data: stockLocations } = await query.graph({
    entity: 'stock_location',
    fields: ['id', 'name'],
  })

  const salesChannel = salesChannels[0]
  const shippingProfile = shippingProfiles[0]
  const stockLocation = stockLocations[0]

  if (!salesChannel || !shippingProfile) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      'No sales channel or shipping profile found. Run the initial data seed first.'
    )
  }

  logger.info(`Seeding into "${salesChannel.name}" in ${CURRENCY.toUpperCase()}`)

  // ---- Categories, tags, collections --------------------------------------

  const { data: existingCategories } = await query.graph({
    entity: 'product_category',
    fields: ['id', 'name'],
  })
  const missingCategories = CATEGORIES.filter(
    (category) => !existingCategories.some((existing) => existing.name === category.name)
  )

  if (missingCategories.length) {
    await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missingCategories.map((category) => ({
          name: category.name,
          handle: category.handle,
          is_active: true,
          is_internal: false,
        })),
      },
    })
    logger.info(`Created ${missingCategories.length} categor${missingCategories.length === 1 ? 'y' : 'ies'}`)
  }

  const { data: allCategories } = await query.graph({
    entity: 'product_category',
    fields: ['id', 'name'],
  })
  const categoryByName = new Map(allCategories.map((category) => [category.name, category.id]))

  const { data: existingTags } = await query.graph({
    entity: 'product_tag',
    fields: ['id', 'value'],
  })
  const missingTags = TAGS.filter((value) => !existingTags.some((tag) => tag.value === value))

  if (missingTags.length) {
    await createProductTagsWorkflow(container).run({
      input: { product_tags: missingTags.map((value) => ({ value })) },
    })
    logger.info(`Created ${missingTags.length} tag(s)`)
  }

  const { data: allTags } = await query.graph({
    entity: 'product_tag',
    fields: ['id', 'value'],
  })
  const tagByValue = new Map(allTags.map((tag) => [tag.value, tag.id]))

  const { data: existingCollections } = await query.graph({
    entity: 'product_collection',
    fields: ['id', 'title'],
  })
  const missingCollections = COLLECTIONS.filter(
    (title) => !existingCollections.some((collection) => collection.title === title)
  )

  if (missingCollections.length) {
    await createCollectionsWorkflow(container).run({
      input: { collections: missingCollections.map((title) => ({ title })) },
    })
    logger.info(`Created ${missingCollections.length} collection(s)`)
  }

  const { data: allCollections } = await query.graph({
    entity: 'product_collection',
    fields: ['id', 'title'],
  })
  const collectionByTitle = new Map(
    allCollections.map((collection) => [collection.title, collection.id])
  )

  // ---- Shared options -----------------------------------------------------

  const { data: existingOptions } = await query.graph({
    entity: 'product_option',
    fields: ['id', 'title'],
    filters: { is_exclusive: false },
  })
  const missingOptions = SHARED_OPTIONS.filter(
    (option) => !existingOptions.some((existing) => existing.title === option.title)
  )

  if (missingOptions.length) {
    await createProductOptionsWorkflow(container).run({
      input: { product_options: missingOptions },
    })
    logger.info(`Created ${missingOptions.length} shared option(s)`)
  }

  const { data: optionRows } = await query.graph({
    entity: 'product_option',
    fields: ['id', 'title', 'values.id', 'values.value'],
    filters: { is_exclusive: false },
  })

  const optionByTitle = new Map(optionRows.map((option) => [option.title, option]))
  const volumeOption = optionByTitle.get('Volume')
  const concentrationOption = optionByTitle.get('Concentration')
  const familyOption = optionByTitle.get('Scent Family')

  if (!volumeOption || !concentrationOption || !familyOption) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      'Shared "Volume", "Concentration", and "Scent Family" options could not be created or read back.'
    )
  }

  const existingFamilyValues = new Set(
    (familyOption.values ?? []).map((value) => value?.value).filter(Boolean)
  )
  const missingFamilyValues = SHARED_OPTIONS.find(
    (option) => option.title === 'Scent Family'
  )?.values.filter((value) => !existingFamilyValues.has(value))

  if (missingFamilyValues?.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `The shared "Scent Family" option is missing values: ${missingFamilyValues.join(', ')}. ` +
        'Rebuild the seeded catalogue before creating products with the new family facet.'
    )
  }

  // ---- Build the products -------------------------------------------------

  const { data: existingProducts } = await query.graph({
    entity: 'product',
    fields: ['handle'],
  })
  const takenHandles = new Set(existingProducts.map((product) => product.handle).filter(Boolean))

  const products: Record<string, unknown>[] = []
  const skipped: string[] = []

  for (const perfume of PERFUMES) {
    if (takenHandles.has(perfume.handle)) {
      skipped.push(perfume.handle)
      continue
    }

    const categoryId = categoryByName.get(perfume.category)
    const collectionId = collectionByTitle.get(perfume.collection)
    // The Arabic title used to be a required field on `Perfume`, so TypeScript
    // guaranteed it. It now comes from the lexicon, which makes it a lookup
    // that can miss - check it rather than seeding `name_ar: undefined`.
    const arabic = PRODUCT_AR[perfume.handle]

    const imageUrl = await uploadProductImage(fileModule, perfume.image)

    if (!categoryId || !collectionId) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Missing category/collection for "${perfume.handle}" ` +
          `(category=${perfume.category}, collection=${perfume.collection}).`
      )
    }

    if (!arabic) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `No Arabic entry for "${perfume.handle}" in data/ar-lexicon.ts. ` +
          'Run src/scripts/check-ar-coverage.ts to see every gap.'
      )
    }

    // A product's options are the axes its variants vary along, so they come
    // from the shared option records rather than being created per product.
    const optionIds: string[] = [
      volumeOption.id as string,
      familyOption.id as string,
    ]
    const concentrations: string[] = ['Eau de Parfum']

    if (perfume.extrait) {
      optionIds.push(concentrationOption.id as string)
      concentrations.push('Extrait')
    }

    const variants = VOLUMES.flatMap((volume) =>
      concentrations.map((concentration) => {
        const isExtrait = concentration === 'Extrait'
        // Both terms are whole OMR, and `amount` IS OMR - no scaling.
        const amount = perfume.prices[volume] + (isExtrait ? 14 : 0)

        // Every variant must supply a value for each of the product's options.
        const options: Record<string, string> = {
          Volume: volume,
          'Scent Family': perfume.family,
        }

        if (perfume.extrait) {
          options.Concentration = concentration
        }

        return {
          title: isExtrait ? `${volume} / ${concentration}` : volume,
          sku: `${perfume.handle.toUpperCase()}-${volume.replace(/\s+/g, '')}${
            isExtrait ? '-EXTRAIT' : ''
          }`,
          options,
          prices: [{ amount, currency_code: CURRENCY }],
        }
      })
    )

    products.push({
      title: perfume.title,
      handle: perfume.handle,
      subtitle: perfume.subtitle,
      description: perfume.description,
      // `name_ar` is a legacy shadow copy of the Translation Module's Arabic
      // title, still read by the search index and the product cards. The Arabic
      // itself lives in `data/ar-lexicon.ts` so it cannot drift from the
      // translations `seed-translations.ts` writes. Scheduled for removal once
      // the storefront reads titles by locale everywhere.
      metadata: { name_ar: arabic.title, family: perfume.family },
      status: ProductStatus.PUBLISHED,
      // Uploaded to Medusa storage, NOT the storefront-relative `perfume.image`
      // - see `helpers/upload-product-image.ts` for why.
      thumbnail: imageUrl,
      images: [{ url: imageUrl }],
      weight: perfume.weight,
      shipping_profile_id: shippingProfile.id,
      collection_id: collectionId,
      category_ids: [categoryId],
      tag_ids: perfume.tags
        .map((value) => tagByValue.get(value))
        .filter((id): id is string => Boolean(id)),
      sales_channels: [{ id: salesChannel.id }],
      options: optionIds.map((id) => ({ id })),
      variants,
    })
  }

  if (skipped.length) {
    logger.info(`Skipping ${skipped.length} already-seeded product(s): ${skipped.join(', ')}`)
  }

  if (!products.length) {
    logger.info('Every perfume already exists. Nothing to create.')
  } else {
    let created = 0

    for (let start = 0; start < products.length; start += BATCH_SIZE) {
      const batch = products.slice(start, start + BATCH_SIZE)

      await createProductsWorkflow(container).run({
        input: { products: batch as never },
      })

      created += batch.length
      logger.info(`Created ${created}/${products.length} perfume(s)`)
    }
  }

  // ---- Inventory ----------------------------------------------------------

  if (stockLocation) {
    const { data: inventoryItems } = await query.graph({
      entity: 'inventory_item',
      fields: ['id'],
    })
    const { data: existingLevels } = await query.graph({
      entity: 'inventory_level',
      fields: ['id', 'inventory_item_id', 'location_id'],
    })
    const stocked = new Set(
      existingLevels.map((level) => `${level.inventory_item_id}:${level.location_id}`)
    )

    const missingLevels = inventoryItems
      .filter((item) => !stocked.has(`${item.id}:${stockLocation.id}`))
      .map((item) => ({
        location_id: stockLocation.id as string,
        inventory_item_id: item.id,
        stocked_quantity: 1000,
      }))

    if (missingLevels.length) {
      await createInventoryLevelsWorkflow(container).run({
        input: { inventory_levels: missingLevels },
      })
      logger.info(`Created ${missingLevels.length} inventory level(s) at "${stockLocation.name}"`)
    }

    // Stock only counts towards a variant's availability if its location is
    // linked to the sales channel being queried - `getVariantAvailability`
    // filters levels down to the channel's locations. Without this link every
    // variant reports `inventory_quantity: 0` and the storefront shows
    // "Out of stock" despite the levels above.
    const { data: locationChannels } = await query.graph({
      entity: 'stock_location',
      fields: ['id', 'sales_channels.id'],
      filters: { id: stockLocation.id },
    })
    const linkedChannelIds = new Set(
      (locationChannels[0]?.sales_channels ?? [])
        .map((channel) => channel?.id)
        .filter((id): id is string => !!id)
    )

    if (!linkedChannelIds.has(salesChannel.id)) {
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: { id: stockLocation.id, add: [salesChannel.id] },
      })
      logger.info(
        `Linked "${stockLocation.name}" to "${salesChannel.name}" so its stock is sellable.`
      )
    }
  } else {
    logger.warn('No stock location found; skipping inventory levels.')
  }

  // ---- Refresh the search index -------------------------------------------

  // `product.created` travels on the local event bus and is handled
  // asynchronously, so a short-lived `medusa exec` can exit before the last
  // batch is ingested. `consume` upserts, so replaying it is safe.
  const search = container.resolve(Modules.SEARCH)
  const { data: allProducts } = await query.graph({
    entity: 'product',
    fields: ['id'],
  })

  for (let start = 0; start < allProducts.length; start += INGEST_CHUNK_SIZE) {
    const chunk = allProducts.slice(start, start + INGEST_CHUNK_SIZE)

    await search.ingest({
      name: 'product.created',
      data: chunk.map((product) => ({ id: product.id })),
    } as never)
  }

  logger.info(`Search index refreshed for ${allProducts.length} product(s).`)
  logger.info('Done. Open the store page to see the perfumes.')
}
