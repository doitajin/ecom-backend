import { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  ModuleRegistrationName,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductOptionsWorkflow,
  createProductTagsWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows";

export default async function initial_data_seed({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(
    ModuleRegistrationName.FULFILLMENT
  );

  const countries = ["om"];

  logger.info("Seeding store data...");
  const {
    result: [defaultSalesChannel],
  } = await createSalesChannelsWorkflow(container).run({
    input: {
      salesChannelsData: [
        {
          name: "Default Sales Channel",
          description: "Created by Medusa",
        },
      ],
    },
  });

  const {
    result: [publishableApiKey],
  } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [
        {
          title: "Default Publishable API Key",
          type: "publishable",
          created_by: "",
        },
      ],
    },
  });

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: publishableApiKey.id,
      add: [defaultSalesChannel.id],
    },
  });

  const {
    result: [store],
  } = await createStoresWorkflow(container).run({
    input: {
      stores: [
        {
          name: "Oman Store",
          supported_currencies: [
            {
              currency_code: "omr",
              is_default: true,
            },
            {
              currency_code: "usd",
              is_default: false,
            },
          ],
          default_sales_channel_id: defaultSalesChannel.id,
        },
      ],
    },
  });

  logger.info("Seeding region data...");
  const { result: regionResult } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "Oman",
          currency_code: "omr",
          countries,
          payment_providers: ["pp_system_default"],
        },
      ],
    },
  });
  const region = regionResult[0];
  logger.info("Finished seeding regions.");

  logger.info("Seeding tax regions...");
  await createTaxRegionsWorkflow(container).run({
    input: countries.map((country_code) => ({
      country_code,
      provider_id: "tp_system",
    })),
  });
  logger.info("Finished seeding tax regions.");

  logger.info("Seeding stock location data...");
  const { result: stockLocationResult } = await createStockLocationsWorkflow(
    container
  ).run({
    input: {
      locations: [
        {
          name: "Oman Warehouse",
          address: {
            city: "Muscat",
            country_code: "OM",
            address_1: "",
          },
        },
      ],
    },
  });
  const stockLocation = stockLocationResult[0];

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_provider_id: "manual_manual",
    },
  });

  logger.info("Seeding fulfillment data...");
  // This is created by a migration script in core.
  const { data: shippingProfileResult } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  });
  const shippingProfile = shippingProfileResult[0];

  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: "Oman Warehouse delivery",
    type: "shipping",
    service_zones: [
      {
        name: "Oman",
        geo_zones: [
          {
            country_code: "om",
            type: "country",
          },
        ],
      },
    ],
  });

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_set_id: fulfillmentSet.id,
    },
  });

  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Standard Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Standard",
          description: "Ship in 2-3 days.",
          code: "standard",
        },
        prices: [
          {
            currency_code: "usd",
            amount: 10,
          },
          {
            currency_code: "omr",
            amount: 10,
          },
          {
            region_id: region.id,
            amount: 10,
          },
        ],
        rules: [
          {
            attribute: "enabled_in_store",
            value: "true",
            operator: "eq",
          },
          {
            attribute: "is_return",
            value: "false",
            operator: "eq",
          },
        ],
      },
      {
        name: "Express Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Express",
          description: "Ship in 24 hours.",
          code: "express",
        },
        prices: [
          {
            currency_code: "usd",
            amount: 10,
          },
          {
            currency_code: "omr",
            amount: 10,
          },
          {
            region_id: region.id,
            amount: 10,
          },
        ],
        rules: [
          {
            attribute: "enabled_in_store",
            value: "true",
            operator: "eq",
          },
          {
            attribute: "is_return",
            value: "false",
            operator: "eq",
          },
        ],
      },
    ],
  });
  logger.info("Finished seeding fulfillment data.");

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: [defaultSalesChannel.id],
    },
  });
  logger.info("Finished seeding stock location data.");

  logger.info("Seeding product data...");

  const { result: categoryResult } = await createProductCategoriesWorkflow(
    container
  ).run({
    input: {
      product_categories: [
        {
          name: "Amber & Oud",
          is_active: true,
        },
        {
          name: "Oud & Attars",
          is_active: true,
        },
        {
          name: "Musk & Skin Scents",
          is_active: true,
        },
        {
          name: "Floral Fragrances",
          is_active: true,
        },
        {
          name: "Fresh & Citrus",
          is_active: true,
        },
      ],
    },
  });

  await createProductTagsWorkflow(container).run({
    input: {
      product_tags: [
        { value: "oud" },
        { value: "amber" },
        { value: "woody" },
        { value: "floral" },
        { value: "rose" },
        { value: "musk" },
        { value: "citrus" },
        { value: "unisex" },
        { value: "bestseller" },
        { value: "new-arrival" },
        { value: "gift-ready" },
        { value: "everyday" },
      ],
    },
  });

  const { data: productTags } = await query.graph({
    entity: "product_tag",
    fields: ["id", "value"],
  });

  const { result: productOptionsResult } = await createProductOptionsWorkflow(
    container
  ).run({
    input: {
      product_options: [
        {
          title: "Volume",
          values: ["10 ml", "30 ml", "50 ml", "100 ml"],
        },
        {
          title: "Concentration",
          values: ["Eau de Parfum", "Extrait"],
        },
      ],
    },
  });
  const volumeOption = productOptionsResult.find((o) => o.title === "Volume")!;
  const concentrationOption = productOptionsResult.find(
    (o) => o.title === "Concentration"
  )!;

  const volumeValues = ["10 ml", "30 ml", "50 ml", "100 ml"];
  const perfumePrices = [
    [18, 34, 52, 74],
    [16, 31, 48, 68],
    [14, 27, 41, 58],
    [17, 33, 51, 72],
  ];

  const productSeedData = [
        {
          title: "Amber Royale",
          subtitle: "Saffron, warm amber and vanilla",
          category_ids: [
            categoryResult.find((cat) => cat.name === "Amber & Oud")!.id,
          ],
          description:
            "A rich Omani-inspired amber perfume, opening with saffron before settling into smooth woods, resin and vanilla. Made for evenings and special occasions.",
          handle: "amber-royale",
          weight: 250,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          thumbnail: "/assets/images/product-amber-royale.webp",
          images: [
            {
              url: "/assets/images/product-amber-royale.webp",
            },
          ],
          tag_ids: ["amber", "oud", "bestseller", "unisex"].map(
            (value) => productTags.find((tag) => tag.value === value)!.id
          ),
          options: [{ id: volumeOption.id }, { id: concentrationOption.id }],
          variants: [],
          sales_channels: [
            {
              id: defaultSalesChannel.id,
            },
          ],
        },
        {
          title: "Cedar Veil",
          subtitle: "Cedarwood, frankincense and soft musk",
          category_ids: [
            categoryResult.find((cat) => cat.name === "Oud & Attars")!.id,
          ],
          description:
            "A composed woody fragrance inspired by Oman's frankincense trails, layered with dry cedar and a quiet musk finish.",
          handle: "cedar-veil",
          weight: 250,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          thumbnail: "/assets/images/product-cedar-veil.webp",
          images: [
            {
              url: "/assets/images/product-cedar-veil.webp",
            },
          ],
          tag_ids: ["woody", "oud", "unisex", "new-arrival"].map(
            (value) => productTags.find((tag) => tag.value === value)!.id
          ),
          options: [{ id: volumeOption.id }],
          variants: [],
          sales_channels: [
            {
              id: defaultSalesChannel.id,
            },
          ],
        },
        {
          title: "White Musk",
          subtitle: "Clean musk, cotton blossom and pale woods",
          category_ids: [
            categoryResult.find((cat) => cat.name === "Musk & Skin Scents")!.id,
          ],
          description:
            "A soft, close-wearing musk with airy cotton blossom and pale woods. An easy everyday scent for Oman’s warm climate.",
          handle: "white-musk",
          weight: 250,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          thumbnail: "/assets/images/product-musk-white.webp",
          images: [
            {
              url: "/assets/images/product-musk-white.webp",
            },
          ],
          tag_ids: ["musk", "everyday", "unisex"].map(
            (value) => productTags.find((tag) => tag.value === value)!.id
          ),
          options: [{ id: volumeOption.id }],
          variants: [],
          sales_channels: [
            {
              id: defaultSalesChannel.id,
            },
          ],
        },
        {
          title: "Taif Rose",
          subtitle: "Taif rose, jasmine and delicate spice",
          category_ids: [
            categoryResult.find((cat) => cat.name === "Floral Fragrances")!.id,
          ],
          description:
            "A luminous floral blend of Taif rose, jasmine and a trace of spice, balanced with a smooth amber base.",
          handle: "taif-rose",
          weight: 250,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          thumbnail: "/assets/images/product-taif-rose.webp",
          images: [
            {
              url: "/assets/images/product-taif-rose.webp",
            },
          ],
          tag_ids: ["floral", "rose", "gift-ready", "bestseller"].map(
            (value) => productTags.find((tag) => tag.value === value)!.id
          ),
          options: [{ id: volumeOption.id }],
          variants: [],
          sales_channels: [
            {
              id: defaultSalesChannel.id,
            },
          ],
        },
      ];

  const volumePerfumes = [
    {
      title: "Neroli Fresh",
      handle: "neroli-fresh",
      subtitle: "Neroli, bergamot and green citrus",
      description:
        "A bright citrus composition of neroli, bergamot and green notes, made for sunlit mornings and warm coastal air.",
      category: "Fresh & Citrus",
      image: "/assets/images/product-neroli-fresh.webp",
      tags: ["citrus", "everyday", "unisex"],
      prices: [13, 25, 38, 54],
    },
    {
      title: "Oud Noir",
      handle: "oud-noir",
      subtitle: "Smoky oud, incense and dark woods",
      description:
        "A deep, resinous oud with incense and dark woods, composed in the spirit of traditional Omani perfumery.",
      category: "Oud & Attars",
      image: "/assets/images/product-oud-noir.webp",
      tags: ["oud", "woody", "bestseller", "unisex"],
      prices: [21, 42, 64, 90],
    },
    {
      title: "Rose Oud",
      handle: "rose-oud",
      subtitle: "Velvety rose layered over Omani oud",
      description:
        "A graceful meeting of velvety rose and Omani oud, warmed with amber for a long-lasting evening fragrance.",
      category: "Oud & Attars",
      image: "/assets/images/product-rose-oud.webp",
      tags: ["oud", "rose", "floral", "gift-ready"],
      prices: [19, 38, 59, 84],
    },
    {
      title: "Violet Absolu",
      handle: "violet-absolu",
      subtitle: "Violet, iris and powder-soft musk",
      description:
        "A modern floral with violet leaf, iris and powder-soft musk, finished with a subtle trail of pale woods.",
      category: "Floral Fragrances",
      image: "/assets/images/product-violet-absolu.webp",
      tags: ["floral", "musk", "new-arrival", "gift-ready"],
      prices: [15, 29, 44, 63],
    },
  ];

  const additionalProducts = volumePerfumes.map((perfume) => ({
    title: perfume.title,
    subtitle: perfume.subtitle,
    description: perfume.description,
    handle: perfume.handle,
    weight: 250,
    status: ProductStatus.PUBLISHED,
    shipping_profile_id: shippingProfile.id,
    category_ids: [
      categoryResult.find((category) => category.name === perfume.category)!.id,
    ],
    tag_ids: perfume.tags.map(
      (value) => productTags.find((tag) => tag.value === value)!.id
    ),
    thumbnail: perfume.image,
    images: [{ url: perfume.image }],
    sales_channels: [{ id: defaultSalesChannel.id }],
    options: [{ id: volumeOption.id }],
    variants: volumeValues.map((volume, index) => ({
      title: volume,
      sku: `${perfume.handle.toUpperCase()}-${volume.replace(" ", "")}`,
      options: { Volume: volume },
      prices: [{ amount: perfume.prices[index], currency_code: "omr" }],
    })),
  }));

  const products = [
      ...productSeedData.map((product, productIndex) => ({
        ...product,
        options:
          productIndex === 0
            ? [{ id: volumeOption.id }, { id: concentrationOption.id }]
            : [{ id: volumeOption.id }],
        variants: volumeValues.flatMap((volume, volumeIndex) => {
          const concentrations =
            productIndex === 0 ? ["Eau de Parfum", "Extrait"] : ["Eau de Parfum"];

          return concentrations.map((concentration) => ({
            title: `${volume} / ${concentration}`,
            sku: `${product.handle.toUpperCase()}-${volume.replace(" ", "")}${
              concentration === "Extrait" ? "-EXTRAIT" : ""
            }`,
            options:
              productIndex === 0
                ? { Volume: volume, Concentration: concentration }
                : { Volume: volume },
            prices: [
              {
                amount:
                  perfumePrices[productIndex][volumeIndex] +
                  (concentration === "Extrait" ? 14 : 0),
                currency_code: "omr",
              },
            ],
          }));
        }),
      })),
    ...additionalProducts,
  ];

  await createProductsWorkflow(container).run({
    input: {
      products,
    },
  });
  logger.info("Finished seeding product data.");

  logger.info("Seeding inventory levels.");

  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  });

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: inventoryItems.map((item) => ({
        location_id: stockLocation.id,
        stocked_quantity: 1000000,
        inventory_item_id: item.id,
      })),
    },
  });

  logger.info("Finished seeding inventory levels data.");
}
