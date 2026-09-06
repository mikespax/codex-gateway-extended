import { useLocalStorage } from "@vueuse/core";
import { computed } from "vue";
import { useAuthStore } from "@/stores/auth";

export function useAccountLocalStorage<T>(suffix: string, initialValue: T) {
  const auth = useAuthStore();
  const key = computed(() => {
    const account = auth.username.trim();
    // Usernames are stable across token rotation and contain no bearer credential. A reactive
    // VueUse key also switches storage atomically when login hydration or account changes occur.
    const namespace = account === "" ? "signed-out" : encodeURIComponent(account);
    return `codex-gateway:${namespace}:${suffix}`;
  });
  return useLocalStorage<T>(key, initialValue);
}
