import { getRequestConfig } from "next-intl/server";

// Single locale, no locale prefix in URLs ("without i18n routing" setup).
export default getRequestConfig(async () => {
  const locale = "fr";
  return {
    locale,
    messages: (await import("../../messages/fr.json")).default,
  };
});
