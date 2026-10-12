import { authenticate, configureStoreSearch, defineMiddlewares } from '@medusajs/framework/http'
import { quantityPricingCartMiddlewares } from './store/carts/[id]/quantity-pricing/middlewares'

// The product index declares filterable `status` and `sales_channel_ids`, so
// the route narrows it to published products in the key's sales channels.
export default defineMiddlewares({
  routes: [
    ...quantityPricingCartMiddlewares,
    {
      method: ['POST'],
      matcher: '/store/search',
      middlewares: [
        configureStoreSearch({
          allowed_indexes: {
            product: true,
          },
        }),
      ],
    },
    {
      // `req.auth_context.actor_id` is the customer id, so these routes must be
      // authenticated - otherwise the handler would fail on an undefined
      // customer.
      method: ['GET'],
      matcher: '/store/customers/me/loyalty-points',
      middlewares: [authenticate('customer', ['bearer', 'session'])],
    },
  ],
})

