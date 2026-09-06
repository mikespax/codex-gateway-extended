export type GatewayTranslate = (key: string, values?: Record<string, unknown>) => string;

/** Uses Nuxt I18n's global composer without requiring a current Vue component instance. */
export function useGatewayTranslator(): GatewayTranslate {
  const { $i18n } = useNuxtApp();
  return (key, values) => $i18n.t(key, values ?? {});
}
