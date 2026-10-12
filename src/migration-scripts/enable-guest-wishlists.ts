import { MedusaContainer } from "@medusajs/framework"

type WishlistSettingsService = {
  updateSettings: (settings: {
    allow_guest_wishlist: boolean
  }) => Promise<unknown>
}

export default async function enable_guest_wishlists({
  container,
}: {
  container: MedusaContainer
}) {
  const wishlistService = container.resolve(
    "wishlist"
  ) as WishlistSettingsService

  await wishlistService.updateSettings({ allow_guest_wishlist: true })
}