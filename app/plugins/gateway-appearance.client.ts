import { watch } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useGatewayAppearanceStore } from "@/stores/gateway-appearance";

export default defineNuxtPlugin(() => {
  const auth = useAuthStore();
  // Hydrate before the first paint so account-local appearance preferences do not briefly show
  // the signed-out default after a reload.
  auth.hydrate();
  const appearance = useGatewayAppearanceStore();

  watch(
    () => appearance.colorway,
    (colorway) => {
      document.documentElement.dataset.colorway = colorway;
    },
    { immediate: true },
  );
});
