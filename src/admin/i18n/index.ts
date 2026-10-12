import en from "./json/en.json"
import ar from "./json/ar.json"

/**
 * Translations for custom admin widgets and routes.
 *
 * Medusa's own dashboard UI is translated separately (and already ships
 * Arabic, including RTL) - this map only covers strings this project adds.
 * Consume with `useTranslation()` from react-i18next inside a widget or route.
 */
export default {
  en: {
    translation: en,
  },
  ar: {
    translation: ar,
  },
}
