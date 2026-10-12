import type { SearchTypes } from "@medusajs/framework/types";
import {
  defineSearchIndex,
  graphConsume,
  graphSeed,
  search,
} from "@medusajs/framework/utils";

import { ArabicRow, loadArabic } from "./helpers/arabic";
import { ProductOptionRow, toOptionValues } from "./helpers/option-values";
import { loadPricing, priceFields, toProductPricing } from "./helpers/pricing";
import { resolveProductIds } from "./helpers/resolve-product-ids";

const PRODUCT_GRAPH_FIELDS = [
  "id",
  "title",
  "subtitle",
  "description",
  "handle",
  "thumbnail",
  "status",
  "created_at",
  "sales_channels.id",
  "categories.name",
  "tags.value",
  "options.title",
  "options.values.value",
];

type ProductRow = {
  id: string;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  handle?: string | null;
  thumbnail?: string | null;
  status?: string | null;
  created_at?: string | Date | null;
  deleted_at?: string | Date | null;
  sales_channels?: ({ id?: string | null } | null)[] | null;
  categories?: ({ name?: string | null } | null)[] | null;
  tags?: ({ value?: string | null } | null)[] | null;
  options?: ProductOptionRow[] | null;
};

const productFields = search.define({
  id: search.keyword().filterable().retrievable(),
  // Read by `/store/search` to scope the index; never returned to hits.
  status: search.keyword().filterable().retrievable(false),
  sales_channel_ids: search.keyword().array().filterable().retrievable(false),
  title: search.text().searchable({ weight: 3 }).sortable().retrievable(),
  subtitle: search.text().searchable({ weight: 1 }).retrievable(),
  description: search.text().searchable({ weight: 1 }),
  // The Arabic mirror of the three fields above, read in place of them when the
  // active locale is Arabic. Every field an `*_ar` name is built from is read a
  // second time with a locale, so a translation is picked up wherever it exists
  // and the English text stands in where it does not.
  title_ar: search.text().searchable({ weight: 3 }).sortable().retrievable(),
  subtitle_ar: search.text().searchable({ weight: 1 }).retrievable(),
  description_ar: search.text().searchable({ weight: 1 }),
  handle: search.keyword().retrievable(),
  // Returned on hits only: never filtered, sorted or faceted on.
  thumbnail: search.keyword().retrievable(),
  created_at: search.date().sortable().retrievable(),
  category: search.keyword().array().filterable().facetable().retrievable(),
  labels: search.keyword().array().filterable().facetable().retrievable(),
  option_values: search
    .keyword()
    .array()
    .searchable({ weight: 2 })
    .filterable()
    .facetable()
    .retrievable(),
  // A facet has to be refined on the attribute it was rendered from, so the
  // Arabic sidebar refines on these. They hold the same products as their
  // English counterparts, which is why a refinement survives a language switch.
  category_ar: search.keyword().array().filterable().facetable().retrievable(),
  labels_ar: search.keyword().array().filterable().facetable().retrievable(),
  option_values_ar: search
    .keyword()
    .array()
    .searchable({ weight: 2 })
    .filterable()
    .facetable()
    .retrievable(),
  ...priceFields,
});

type ProductDocument = SearchTypes.InferSearchDocumentType<
  typeof productFields
>;

/** The non-empty `name`s of a set of rows, e.g. a product's categories. */
function namesOf(
  rows: ({ name?: string | null } | null)[] | null | undefined,
): string[] {
  return (rows ?? [])
    .map((row) => row?.name?.trim())
    .filter((name): name is string => Boolean(name));
}

/** The non-empty `value`s of a set of rows, e.g. a product's tags. */
function valuesOf(
  rows: ({ value?: string | null } | null)[] | null | undefined,
): string[] {
  return (rows ?? [])
    .map((row) => row?.value?.trim())
    .filter((value): value is string => Boolean(value));
}

function toDocument(
  product: ProductRow,
  arabic: ArabicRow | undefined,
  pricing: Parameters<typeof toProductPricing>[0],
): ProductDocument {
  const salesChannelIds = (product.sales_channels ?? [])
    .map((salesChannel) => salesChannel?.id?.trim())
    .filter((id): id is string => Boolean(id));

  return {
    id: product.id,
    status: product.status ?? null,
    sales_channel_ids: salesChannelIds,
    title: product.title ?? null,
    subtitle: product.subtitle ?? null,
    description: product.description ?? null,
    title_ar: arabic?.title ?? null,
    subtitle_ar: arabic?.subtitle ?? null,
    description_ar: arabic?.description ?? null,
    handle: product.handle ?? null,
    thumbnail: product.thumbnail ?? null,
    created_at: product.created_at ?? null,
    category: namesOf(product.categories),
    labels: valuesOf(product.tags),
    option_values: toOptionValues(product.options),
    category_ar: namesOf(arabic?.categories),
    labels_ar: valuesOf(arabic?.tags),
    option_values_ar: toOptionValues(arabic?.options),
    ...toProductPricing(pricing),
  };
}

/**
 * A row that returns no document leaves
 * the index: the helpers turn it into a delete on `consume` and on the
 * catch-up pass.
 */
const source = {
  fields: PRODUCT_GRAPH_FIELDS,
  transform: async (
    rows: ProductRow[],
    context: SearchTypes.SearchIngestionContext,
  ) => {
    const ids = rows.map((row) => row.id);
    const [pricing, arabic] = await Promise.all([
      loadPricing(ids, context),
      loadArabic(ids, context),
    ]);

    return rows.map((row) =>
      toDocument(row, arabic.get(row.id), pricing.get(row.id)),
    );
  },
};

/**
 * Everything a document is built from, so a change to any of it re-indexes the
 * products it touches. Only `product.deleted` removes documents: a deleted
 * variant, option, tag or category means the product has to be re-read.
 *
 * TODO: price lists emit no events (create, update, delete, batch prices).
 * TODO: price lists crossing their start or end date change prices silently.
 * TODO: linkProductsToSalesChannelWorkflow emits nothing.
 * TODO: batchLinkProductsToCategoryWorkflow emits nothing.
 * TODO: upsertVariantPricesWorkflow emits nothing when called directly.
 * TODO: the Translation Module emits no events, so editing a translation in the
 * admin leaves every `*_ar` field stale until the index is rebuilt. Run
 * `src/scripts/reindex-search.ts` after a translation change.
 */
const PRODUCT_EVENTS = [
  "product.created",
  "product.updated",
  "product.deleted",
  "product-variant.created",
  "product-variant.updated",
  "product-variant.deleted",
  "product-option.created",
  "product-option.updated",
  "product-option.deleted",
  "product-option-value.updated",
  "product-option-value.deleted",
  "product-tag.updated",
  "product-tag.deleted",
  "product-category.updated",
  "product-category.deleted",
  "sales-channel.deleted",
];

export default defineSearchIndex({
  name: "product",
  entity: "product",
  primary_key: "id",
  fields: productFields,
  settings: {
    typo_tolerance: { enabled: true },
  },
  events: PRODUCT_EVENTS,
  consume: graphConsume<typeof productFields, ProductRow>({
    ...source,
    resolve_ids: resolveProductIds,
    is_delete: (event) => event.name === "product.deleted",
  }),
  seed: graphSeed<typeof productFields, ProductRow>(source),
});
