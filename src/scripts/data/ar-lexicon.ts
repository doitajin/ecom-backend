/**
 * Arabic copy for every translatable entity in the catalogue.
 *
 * This file is the SINGLE source of Arabic content. `seed-perfume-data.ts` reads
 * product titles from here rather than carrying its own `nameAr`, so there is
 * exactly one copy of each string - the point of the exercise is to stop Arabic
 * drifting between two files.
 *
 * `seed-translations.ts` walks this and writes the rows into the Translation
 * Module, keyed by the identifiers below:
 *
 *   entity_type              keyed by                  map
 *   -----------------------  -------------------------  -------------------------
 *   product                  product handle             PRODUCT_AR
 *   product_category         category handle            CATEGORY_AR
 *   product_collection       collection handle          COLLECTION_AR
 *   product_tag              tag value                  TAG_AR
 *   product_option           option title               OPTION_TITLE_AR
 *   product_option_value     option value               OPTION_VALUE_AR
 *   region                   region name                REGION_AR
 *   shipping_option          shipping option name       SHIPPING_OPTION_AR
 *   shipping_option_type     type code                  SHIPPING_OPTION_TYPE_AR
 *
 * Handles are the keys (not display names) wherever the entity has one, so
 * renaming something in the admin cannot silently orphan its translation.
 *
 * Once seeded, the Arabic lives in the Translation Module and is editable at
 * `/app/translations` in the admin. This file is the seed, not the runtime
 * source - editing it requires re-running the script.
 */

/** Arabic for one product's three translatable text fields. */
export type ArabicProduct = {
  title: string
  subtitle: string
  description: string
}

/**
 * The six scent families, shared by the `Scent Family` option values and by the
 * matching top-level categories. Medusa stores these as two unrelated entities
 * (`product_option_value` and `product_category`), each needing its own
 * translation row, but the Arabic is the same word - so it is defined once.
 */
const SCENT_FAMILY_AR = {
  Woody: 'خشبي',
  Floral: 'زهري',
  Fresh: 'منعش',
  Oriental: 'شرقي',
  Sweet: 'حلو',
  Smoky: 'دخاني',
} as const

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/**
 * Titles are kept as already seeded - they are established product names, and
 * the "true translation" decision covered tags and categories rather than
 * brand names. `neroli-fresh` is the one that reads as a transliteration
 * ("نيرولي فريش"); change it here if you want "نيرولي منعش" instead.
 */
export const PRODUCT_AR: Record<string, ArabicProduct> = {
  'neroli-fresh': {
    title: 'نيرولي فريش',
    subtitle: 'النيرولي والبرغموت والحمضيات الخضراء',
    description:
      'تركيبة حمضية مشرقة من النيرولي والبرغموت والنوتات الخضراء، صُنعت لأصباح مشمسة وهواء ساحلي دافئ. تبدأ حادة وخضراء، ثم تستقر على مسك نقي يصمد في الحرارة.',
  },
  'oud-noir': {
    title: 'عود نوير',
    subtitle: 'عود دخاني وبخور وأخشاب داكنة',
    description:
      'عود عميق راتنجي مع البخور والأخشاب الداكنة، صيغ بروح العطور العُمانية التقليدية. أثقل عطر في المجموعة — رشّة واحدة تكفي أمسية كاملة.',
  },
  'rose-oud': {
    title: 'ورد وعود',
    subtitle: 'ورد مخملي فوق طبقة من العود العُماني',
    description:
      'لقاء أنيق بين الورد المخملي والعود العُماني، مدفّأ بالعنبر لعطر مسائي يدوم طويلاً. يقود الورد الساعة الأولى، ثم يأخذ العود زمام المبادرة.',
  },
  'taif-rose': {
    title: 'ورد الطائف',
    subtitle: 'ورد الطائف والياسمين وتوابل رقيقة',
    description:
      'مزيج زهري مضيء من ورد الطائف والياسمين مع لمسة توابل، متوازن بقاعدة عنبرية ناعمة. ورد حقيقي لا مجرد تركيب وردي — أكثر خضرة وأقل حلاوة من معظم العطور.',
  },
  'cedar-veil': {
    title: 'حجاب الأرز',
    subtitle: 'خشب الأرز واللبان والمسك الناعم',
    description:
      'عطر خشبي رصين مستوحى من دروب اللبان في عُمان، بطبقات من الأرز الجاف ومسك هادئ في النهاية. متحفّظ وملاصق للبشرة — مناسب للعمل.',
  },
  'white-musk': {
    title: 'مسك أبيض',
    subtitle: 'مسك نقي وزهر القطن وأخشاب فاتحة',
    description:
      'مسك ناعم ملاصق للبشرة مع زهر القطن الخفيف وأخشاب فاتحة. عطر يومي مريح لمناخ عُمان الحار، والأكثر تنوعاً في المجموعة.',
  },
  'frankincense-ember': {
    title: 'جمر اللبان',
    subtitle: 'اللبان والراتنج الدافئ والأخشاب الناعمة',
    description:
      'عطر راتنجي دافئ مستوحى من دخان اللبان الهادئ، ملطّف بأخشاب جافة ونهاية عنبرية لطيفة.',
  },
  'saffron-oud': {
    title: 'زعفران وعود',
    subtitle: 'الزعفران والعود والعنبر المتوهج',
    description:
      'مزيج غني النبرة يلتقي فيه الزعفران الدافئ بعمق العود مع تناغم عنبري ناعم.',
  },
  'jasmine-attar': {
    title: 'دهن الياسمين',
    subtitle: 'بتلات الياسمين والورد وقاعدة مسك ناعمة',
    description:
      'دهن زهري مضيء يتمحور حول الياسمين والورد، يستقر قريباً من البشرة بنهاية مسكية ناعمة.',
  },
  'sandalwood-veil': {
    title: 'حجاب الصندل',
    subtitle: 'الصندل والأرز والمسك الهادئ',
    description:
      'صندل كريمي وأرز جاف يلتقيان بمسك متحفّظ لعطر خشبي رصين ملاصق للبشرة.',
  },
  'vanilla-oud': {
    title: 'فانيلا وعود',
    subtitle: 'فانيلا ناعمة وعود وأخشاب عنبرية',
    description:
      'حلاوة معتدلة من الفانيلا تلتف حول العود الداكن والأخشاب الدافئة، متوازنة بالعنبر.',
  },
  'bakhoor-majan': {
    title: 'بخور مجان',
    subtitle: 'دخان البخور والراتنج والأخشاب الداكنة',
    description:
      'عطر دخاني راتنجي مستوحى من دفء طقوس البخور، مع أخشاب داكنة وأثر عنبري يدوم.',
  },
  'amber-sultan': {
    title: 'عنبر السلطان',
    subtitle: 'عنبر ذهبي وتوابل وأخشاب ناعمة',
    description:
      'عنبر ذهبي وتوابل لطيفة يستقران فوق أخشاب ناعمة في تركيبة دافئة تحتضنك.',
  },
  'dhofar-rose-attar': {
    title: 'دهن ورد ظفار',
    subtitle: 'ورد وتوابل ناعمة وقلب راتنجي',
    description:
      'دهن يقوده الورد مع توابل لطيفة ودفء راتنجي، صيغ كعطر زهري هادئ للنهار أو المساء.',
  },
  'citrus-khareef': {
    title: 'حمضيات الخريف',
    subtitle: 'حمضيات خضراء ونيرولي ومسك منعش',
    description:
      'تركيبة حمضية خضراء مشرقة مع النيرولي والمسك البارد، مستوحاة من نضارة مطر صيفي عابر.',
  },
  'rosewood-dusk': {
    title: 'خشب الورد عند الغروب',
    subtitle: 'خشب الورد والورد وأثر عنبري ناعم',
    description:
      'خشب ورد جاف وورد مخملي يستقران على عنبر ناعم، ليصنعا توازناً دافئاً بين الخشبي والزهري.',
  },
  'golden-hour': {
    title: 'الساعة الذهبية',
    subtitle: 'عنبر عسلي وفانيلا وأخشاب فاتحة',
    description:
      'حلاوة عنبرية ناعمة مع الفانيلا والأخشاب الفاتحة، مصممة لانتقال سهل من النهار إلى المساء.',
  },
  'myrrh-smoke': {
    title: 'دخان المر',
    subtitle: 'المر والبخور ونهاية راتنجية جافة',
    description:
      'راتنج جاف وبخور دخاني يلتقيان بتناغم بلسمي من المر لعطر عميق تأملي.',
  },
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

/** Keyed by category handle. All 11 category descriptions are empty. */
export const CATEGORY_AR: Record<string, string> = {
  woody: SCENT_FAMILY_AR.Woody,
  floral: SCENT_FAMILY_AR.Floral,
  fresh: SCENT_FAMILY_AR.Fresh,
  oriental: SCENT_FAMILY_AR.Oriental,
  sweet: SCENT_FAMILY_AR.Sweet,
  smoky: SCENT_FAMILY_AR.Smoky,
  'fresh-citrus': 'منعش وحمضي',
  'oud-attars': 'العود والدهن',
  'musk-skin-scents': 'المسك وعطور البشرة',
  'floral-fragrances': 'عطور زهرية',
  'woody-amber': 'خشبي وعنبري',
}

/** Keyed by collection handle. */
export const COLLECTION_AR: Record<string, string> = {
  'oud-collection': 'مجموعة العود',
  'omani-frankincense': 'اللبان العُماني',
  'arabic-attars': 'الدهن العربي',
  'luxury-perfumes': 'عطور فاخرة',
  bakhoor: 'البخور',
  'gift-sets': 'أطقم الهدايا',
  'daily-signatures': 'عطور يومية مميزة',
  'gift-edit': 'مختارات الهدايا',
  'omani-heritage': 'التراث العُماني',
}

/** Keyed by tag value. These render as the /store refinement chips. */
export const TAG_AR: Record<string, string> = {
  citrus: 'حمضيات',
  oud: 'عود',
  rose: 'ورد',
  floral: 'زهري',
  musk: 'مسك',
  woody: 'خشبي',
  amber: 'عنبر',
  fresh: 'منعش',
  oriental: 'شرقي',
  sweet: 'حلو',
  smoky: 'دخاني',
  frankincense: 'لبان',
  bakhoor: 'بخور',
  attar: 'دهن',
  unisex: 'للجنسين',
  bestseller: 'الأكثر مبيعاً',
  'gift-ready': 'جاهز للإهداء',
  'gift-set': 'طقم هدايا',
  luxury: 'فاخر',
  everyday: 'يومي',
}

// ---------------------------------------------------------------------------
// Shared product options
// ---------------------------------------------------------------------------

/** Keyed by the option's English title. */
export const OPTION_TITLE_AR: Record<string, string> = {
  Volume: 'الحجم',
  Concentration: 'التركيز',
  'Scent Family': 'العائلة العطرية',
}

/**
 * Keyed by the option value.
 *
 * Volumes keep Western digits to stay consistent with the price display, which
 * Medusa formats as "OMR 16.000" regardless of locale. Swap to Arabic-Indic
 * (١٠ مل) here if you prefer - nothing else depends on the digits.
 */
export const OPTION_VALUE_AR: Record<string, string> = {
  '10 ml': '10 مل',
  '30 ml': '30 مل',
  '50 ml': '50 مل',
  '100 ml': '100 مل',
  'Eau de Parfum': 'أو دو بارفان',
  Extrait: 'إكستريه',
  ...SCENT_FAMILY_AR,
}

// ---------------------------------------------------------------------------
// Regions and fulfillment
// ---------------------------------------------------------------------------

/** Keyed by region name - regions have no handle. */
export const REGION_AR: Record<string, string> = {
  'OMR Region': 'منطقة الريال العُماني',
  UAE: 'الإمارات العربية المتحدة',
}

/** Keyed by shipping option name - shipping options have no handle. */
export const SHIPPING_OPTION_AR: Record<string, string> = {
  'Standard Shipping': 'شحن عادي',
  'Express Shipping': 'شحن سريع',
}

/**
 * Keyed by the option type's `code`, which is the stable identifier the
 * fulfillment module seeds ("standard" / "express"); the label is display text.
 */
export const SHIPPING_OPTION_TYPE_AR: Record<
  string,
  { label: string; description: string }
> = {
  standard: { label: 'عادي', description: 'يُشحن خلال 2-3 أيام.' },
  express: { label: 'سريع', description: 'يُشحن خلال 24 ساعة.' },
}
