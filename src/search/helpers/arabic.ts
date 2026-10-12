import type { SearchTypes } from "@medusajs/framework/types";

import type { ProductOptionRow } from "./option-values";

/**
 * The locale every `*_ar` field in the index is built from. Like a price
 * currency, adding another is a schema change: the module reindexes on the next
 * boot. Keep in sync with the storefront's `SEARCH_LOCALES`.
 */
export const ARABIC_LOCALE = "ar-OM";

/**
 * What the Arabic pass reads. A strict subset of the English read: only the
 * fields an `*_ar` field is built from.
 *
 * The nested `id`s are spelled out on purpose. `applyTranslations` only descends
 * into a nested object that carries an `id`, and a field path like
 * `categories.name` selects the name alone - so without these the categories,
 * tags and option values come back in English while the title does not. Same
 * trap as asking the Store API for `+tags.value` instead of `*tags`.
 */
const ARABIC_GRAPH_FIELDS = [
  "id",
  "title",
  "subtitle",
  "description",
  "categories.id",
  "categories.name",
  "tags.id",
  "tags.value",
  "options.id",
  "options.title",
  "options.values.id",
  "options.values.value",
];

/** A product row as the locale-aware read returns it. */
export type ArabicRow = {
  id: string;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  categories?: ({ name?: string | null } | null)[] | null;
  tags?: ({ value?: string | null } | null)[] | null;
  options?: ProductOptionRow[] | null;
};

/**
 * The given products, read once more with a locale, so the Translation Module
 * substitutes the translated fields in place - the same mechanism the Store API
 * uses, reached through the only handle the ingestion context offers.
 *
 * `container` is a `SearchContainer`, which exposes `query` and `logger` and
 * nothing else: the Translation Module service cannot be resolved here, so the
 * translations have to arrive already applied to the rows.
 *
 * A product with no Arabic row comes back in English rather than empty, which is
 * what makes the `*_ar` fields safe to read without a fallback - and what keeps
 * an untranslated product's Arabic card from rendering blank.
 */
export async function loadArabic(
  ids: string[],
  { container }: SearchTypes.SearchIngestionContext,
): Promise<Map<string, ArabicRow>> {
  const arabic = new Map<string, ArabicRow>();

  if (!ids.length) {
    return arabic;
  }

  const { data } = await container.query.graph(
    {
      entity: "product",
      fields: ARABIC_GRAPH_FIELDS,
      filters: { id: ids },
    },
    { locale: ARABIC_LOCALE },
  );

  for (const product of data as ArabicRow[]) {
    arabic.set(product.id, product);
  }

  return arabic;
}
