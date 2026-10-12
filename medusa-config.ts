import path from 'path'
import {
  loadEnv,
  defineConfig,
  Modules,
  ContainerRegistrationKeys,
} from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

// The Google provider validates its options at boot and throws "Google clientId
// is required" if they are missing, which takes the whole backend down. Only
// register it once the credentials exist, so a checkout without Google OAuth
// configured (or a fresh clone with an empty .env) still starts normally.
const googleAuthEnabled =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET
const redisUrl = process.env.REDIS_URL
const databaseUrl = process.env.DATABASE_URL || 'postgres://localhost:5432/medusa'

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: databaseUrl,
    redisUrl,
    databaseDriverOptions: {
      ssl: process.env.DATABASE_SSL === 'true',
    },
    workerMode: (process.env.MEDUSA_WORKER_MODE || process.env.WORKER_MODE ||
      'shared') as 'shared' | 'server' | 'worker',
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    }
  },
  admin: {
    backendUrl: process.env.MEDUSA_BACKEND_URL,
    disable: process.env.DISABLE_MEDUSA_ADMIN === 'true',
    vite: () => ({
      plugins: [
        {
          name: 'admin-currency-hide-zero-fractions',
          enforce: 'pre',
          transform(code, id) {
            if (!id.includes('@medusajs/dashboard/dist/')) {
              return null
            }

            let transformed = code

            if (code.includes('// src/lib/money-amount-helpers.ts')) {
              transformed = transformed
                .replace(
                  /const formatter = new Intl\.NumberFormat\(\[\], \{\s*style: "currency",\s*currencyDisplay: "narrowSymbol",\s*currency: currencyCode\s*\}\);\s*return formatter\.format\(amount\);/,
                  `const decimalDigits = new Intl.NumberFormat([], { style: "currency", currency: currencyCode }).resolvedOptions().maximumFractionDigits ?? 2;
  const isWholeAmount = Number.isInteger(Number(amount.toFixed(decimalDigits)));
  const formatter = new Intl.NumberFormat([], {
    style: "currency",
    currencyDisplay: "narrowSymbol",
    currency: currencyCode,
    minimumFractionDigits: isWholeAmount ? 0 : decimalDigits,
    maximumFractionDigits: decimalDigits
  });
  return formatter.format(amount);`,
                )
                .replace(
                  'const decimalDigits = getDecimalDigits(currencyCode);',
                  'const decimalDigits = getDecimalDigits(currencyCode);\n  const isWholeAmount = Number.isInteger(Number(amount.toFixed(decimalDigits)));',
                )
                .replace(
                  'minimumFractionDigits: decimalDigits,',
                  'minimumFractionDigits: isWholeAmount ? 0 : decimalDigits,',
                )
            }

            if (code.includes('// src/lib/format-currency.ts')) {
              transformed = transformed.replace(
                /var formatCurrency = \(amount, currency\) => \{\s*return new Intl\.NumberFormat\(void 0, \{\s*style: "currency",\s*currency,\s*signDisplay: "auto"\s*\}\)\.format\(amount\);\s*\};/,
                `var formatCurrency = (amount, currency) => {
  const decimalDigits = new Intl.NumberFormat(void 0, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const isWholeAmount = Number.isInteger(Number(amount.toFixed(decimalDigits)));
  return new Intl.NumberFormat(void 0, {
    style: "currency",
    currency,
    signDisplay: "auto",
    minimumFractionDigits: isWholeAmount ? 0 : decimalDigits,
    maximumFractionDigits: decimalDigits
  }).format(amount);
};`,
              )
            }

            return transformed === code
              ? null
              : { code: transformed, map: null }
          },
        },
      ],
      /**
       * Must be ABSOLUTE, and must stay outside `.medusa/client`.
       *
       * Medusa sets Vite's `root` to `<cwd>/.medusa/client` and serves the admin
       * under `/app`, so a *relative* `cacheDir` resolves to
       * `.medusa/client/.medusa/cache/vite` - i.e. it is served as a static asset
       * at `/app/.medusa/cache/vite/...`. Requests then resolve against the
       * `root` on disk instead of Vite's dep resolver, so the committed `deps/`
       * is never found and every dep 504s. It also sits inside the admin's
       * file-watch scope, so writing the cache triggers admin reloads.
       *
       * Keeping it under `node_modules/.cache` (not `node_modules/.vite`) avoids
       * the other trap: Vite hashes the nearest lockfile walking up from `root`,
       * which for this monorepo is the workspace-root `node_modules/.package-lock.json`.
       * Any `npm install` inside `apps/backend` rewrites that file and would
       * invalidate the ~68 MB prebundle for every app at once.
       *
       * `force` is deliberately NOT set - that would re-bundle on every boot.
       */
      cacheDir: path.resolve(process.cwd(), 'node_modules/.cache/medusa-admin-vite'),
    }),
  },
  /**
   * Core feature flags.
   *
   * `translation` turns on the Translation Module for multi-language content
   * (English / Arabic). It must be paired with the explicit `modules` entry
   * below: Medusa's default translation entry is gated by
   * `disable: !FeatureFlag.isFeatureEnabled("translation")`, but `defineConfig`
   * evaluates that gate while the config file is being loaded - before the
   * feature-flag loader has populated the router - so the default entry is
   * always disabled at that point. Declaring the module explicitly (it has no
   * providers, so nothing is lost by overriding the default) registers it.
   *
   * The env var `MEDUSA_FF_TRANSLATION` (see .env.template) takes precedence
   * and is also what the product-translation / store-locale link modules read
   * at import time, so it must be set as well.
   */
  featureFlags: {
    translation: true,
  },
  modules: [
    {
      // Auth module. Declaring it explicitly is what lets the `google` provider
      // be registered alongside the built-in `emailpass` one. Listing
      // `emailpass` here is required, not optional: registering the module
      // replaces Medusa's default provider set, so omitting it would break the
      // existing email/password logins in both the storefront and the admin.
      //
      // `mfa.encryption_key` reads the same env var Medusa's built-in default
      // uses, so MFA data (if ever enabled) stays decryptable across the switch.
      resolve: '@medusajs/medusa/auth',
      dependencies: [Modules.CACHE, ContainerRegistrationKeys.LOGGER],
      options: {
        mfa: {
          encryption_key: process.env.AUTH_MFA_ENCRYPTION_KEY,
        },
        providers: [
          {
            resolve: '@medusajs/medusa/auth-emailpass',
            id: 'emailpass',
          },
          // Google OAuth provider. `callbackUrl` points at the *storefront*
          // route that receives Google's redirect (it then forwards the
          // `code` to Medusa's `/auth/customer/google/callback` route), so it
          // must match the Authorized redirect URI configured on the Google
          // OAuth client exactly.
          //
          // Registered only when `googleAuthEnabled` (see top of file) - an
          // unconfigured provider would otherwise abort startup.
          ...(googleAuthEnabled
            ? [
                {
                  resolve: '@medusajs/medusa/auth-google',
                  id: 'google',
                  options: {
                    clientId: process.env.GOOGLE_CLIENT_ID,
                    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
                  },
                },
              ]
            : []),
        ],
      },
    },
    {
      // Product imagery is uploaded here and served from `/static`, so it
      // belongs to Medusa rather than to the storefront. Without this the
      // `thumbnail` paths only resolve on whichever host renders them.
      resolve: '@medusajs/file',
      options: {
        // The module loader reads `providers` (an array), not `provider`.
        providers: [
          {
            resolve: '@medusajs/file-local',
            id: 'local',
            options: {
              upload_dir: 'static',
              backend_url: `${process.env.MEDUSA_BACKEND_URL || 'http://localhost:9000'}/static`,
            },
          },
        ],
      },
    },
    {
      // Transactional email (order confirmation, shipping confirmation, customer
      // email verification, password reset).
      //
      // The provider is a local module under `src/modules/notifications/smtp`.
      //
      // The `resolve` string must carry the explicit `/index.ts` extension and
      // start with `./src/`. The module loader resolves it with a plain
      // `require.resolve(resolve, { paths: [process.cwd()] })`, which does NOT
      // apply TypeScript extension inference - `./modules/...` or a bare
      // directory path fails with "Cannot find module". Medusa rewrites the path
      // to the compiled output when running from the build directory.
      //
      // `channels: ["email"]` is required, not decorative. The notification
      // module loader injects Medusa Cloud's email provider whenever no
      // configured provider claims the "email" channel, and two providers on one
      // channel make the loader throw.
      resolve: '@medusajs/notification',
      options: {
        providers: [
          {
            resolve: './src/modules/notifications/smtp/index.ts',
            id: 'smtp',
            options: {
              channels: ['email'],
              host: process.env.SMTP_HOST,
              port: process.env.SMTP_PORT,
              // 587 uses STARTTLS (secure: false), 465 uses implicit TLS (secure: true).
              secure: process.env.SMTP_SECURE === 'true',
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASSWORD,
              from: process.env.SMTP_FROM,
              store_name: process.env.SMTP_STORE_NAME || 'Perfume Shop',
            },
          },
        ],
      },
    },
    {
      // Manual fulfillment - the only fulfillment provider this store uses.
      //
      // Medusa registers this module and the `manual` provider by default
      // (see `resolveModules` in @medusajs/utils' define-config). It is
      // declared here anyway so every module this project relies on is
      // visible in one place.
      //
      // `providers` is MANDATORY, not decorative. `resolveModules` appends
      // config modules *after* the defaults and `transformModules` keys by
      // serviceName with "last one wins", so this entry REPLACES the default
      // fulfillment module. Omitting `providers` would delete the
      // `manual_manual` provider that every seeded shipping option points at
      // (`src/migration-scripts/initial-data-seed.ts`), and checkout would
      // lose all shipping options.
      //
      // `id: "manual"` must stay exactly as Medusa's default - the registered
      // provider id is `<identifier>_<id>` = `manual_manual`.
      //
      // Resolve through the `@medusajs/medusa/*` wrappers (not the bare
      // packages): the wrappers are what carry the `discoveryPath` the module
      // loader needs.
      resolve: '@medusajs/medusa/fulfillment',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/fulfillment-manual',
            id: 'manual',
          },
        ],
      },
    },
    {
      // Use Redis for production caching when configured, while keeping an
      // in-memory provider for local environments without Redis.
      resolve: '@medusajs/medusa/caching',
      options: redisUrl
        ? {
            providers: [
              {
                resolve: '@medusajs/caching-redis',
                id: 'caching-redis',
                is_default: true,
                options: {
                  redisUrl: process.env.CACHE_REDIS_URL || redisUrl,
                },
              },
            ],
          }
        : {
            in_memory: {
              enable: true,
            },
          },
    },
    ...(redisUrl
      ? [
          {
            resolve: '@medusajs/medusa/event-bus-redis',
            options: {
              redisUrl: process.env.EVENTS_REDIS_URL || redisUrl,
              workerOptions: { concurrency: 1 },
            },
          },
          {
            resolve: '@medusajs/medusa/workflow-engine-redis',
            options: {
              redis: {
                redisUrl: process.env.WE_REDIS_URL || redisUrl,
              },
            },
          },
          {
            resolve: '@medusajs/medusa/locking',
            options: {
              providers: [
                {
                  resolve: '@medusajs/medusa/locking-redis',
                  id: 'locking-redis',
                  is_default: true,
                  options: {
                    redisUrl: process.env.LOCKING_REDIS_URL || redisUrl,
                  },
                },
              ],
            },
          },
        ]
      : []),
    {
      // Custom module holding one loyalty-points balance row per customer.
      // Registered as a module (not a plugin) because it ships its own data
      // model and needs `db:generate` to create the `loyalty_point` table.
      resolve: './src/modules/loyalty',
    },
    {
      // Translation Module (experimental) - multi-language product/category
      // content. Declared explicitly so it registers regardless of the
      // feature-flag timing described above. It has no providers, so
      // overriding Medusa's default entry loses nothing.
      //
      // Resolve through the `@medusajs/medusa/*` wrapper: it carries the
      // `discoveryPath` the module loader needs to find the module's migrations.
      resolve: '@medusajs/medusa/translation',
    },
  ],
  plugins: [
    {
      resolve: '@alphabite/medusa-wishlist',
      options: {
        allowGuestWishlist: true,
        wishlistItemsFields: [
          'id',
          'product_id',
          'wishlist_id',
          'product_variant.id',
          'product_variant.title',
          'product_variant.product.id',
          'product_variant.product.title',
          'product_variant.product.handle',
          'product_variant.product.thumbnail',
        ],
      },
    },
    {
      resolve: '@blegaut/medusa-product-reviews-enhanced',
      options: {
        defaultReviewStatus: 'pending',
      },
    },
    {
      // Contributes an admin widget at `product_category.details.after` and a
      // `product_category_image` module (migration adds the backing table).
      // Uploads go through whichever file provider is registered - this repo
      // uses `@medusajs/file-local` writing to `/static`, so category images
      // land in the same place as product thumbnails.
      resolve: '@alphabite/medusa-category-images',
      options: {},
    },
    {
      // Quantity / volume tiered pricing. Registers its own `pricingEngine`
      // module (and the `quantity_prices` table via that module's migrations),
      // so it must NOT also appear under `modules`.
      //
      // Note: creating tiers does not by itself change cart prices - the plugin
      // leaves line items alone. A tier only takes effect once the add-to-cart
      // flow calls the exported `resolveQuantityUnitPrice`.
      //
      // This store trades in OMR only, so rules need `currency_code: 'omr'`.
      resolve: '@webbycrown/medusa-quantity-pricing-rules',
      options: {},
    },
    {
      // Admin-only analytics dashboard: prebuilt admin route (`/app/analytics`),
      // three list-page widgets (orders/products/customers), and
      // `/admin/agilo-analytics/*` API routes. Registers no module of its own,
      // so it belongs here and NOT under `modules`.
      //
      // Its admin bundle is compiled against older @medusajs/ui exports, so if the
      // dashboard breaks after a Medusa upgrade, this entry is the first suspect.
      resolve: '@agilo/medusa-analytics-plugin',
      options: {},
    },
  ],
})
