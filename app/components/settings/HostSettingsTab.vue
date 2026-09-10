<script setup lang="ts">
import { PlusIcon, ServerIcon } from "@lucide/vue";
import { ref } from "vue";
import { Button } from "@codex-gateway/ui/button";
import HostEditList from "@/components/settings/HostEditList.vue";
import HostConnectionFields from "./host-connection/HostConnectionFields.vue";
import { emptyHostConnectionForm, hostConnectionPayload } from "./host-connection/form";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";

const emit = defineEmits<{ close: [] }>();
const catalog = useGatewayCatalogStore();
const { t } = useI18n();
const hostForm = ref(emptyHostConnectionForm());

function useQnapPreset() {
  hostForm.value = {
    ...emptyHostConnectionForm(),
    name: "QNAP",
    sshHost: "100.98.206.44",
    username: "admin",
    port: "22",
    authMode: "privateKey",
    privateKeyPath: "/run/secrets/codex_qnap_ed25519",
    proxyUrl: "",
  };
}

async function createHost() {
  await catalog.createHost(hostConnectionPayload(hostForm.value));
  hostForm.value = emptyHostConnectionForm();
  emit("close");
}
</script>

<template>
  <div class="grid gap-4 md:grid-cols-2">
    <div class="space-y-3">
      <div class="font-medium">{{ t("app.addHost") }}</div>
      <Button
        data-testid="qnap-host-preset"
        variant="outline"
        class="w-full justify-start"
        @click="useQnapPreset"
      >
        <ServerIcon class="size-4" />
        {{ t("app.qnapHostPreset") }}
      </Button>
      <p class="text-xs leading-5 text-ink-muted">{{ t("app.qnapHostPresetDescription") }}</p>
      <HostConnectionFields v-model="hostForm" create />
      <Button
        data-testid="add-host-button"
        class="w-full"
        :disabled="!hostForm.name || !hostForm.sshHost"
        @click="createHost"
      >
        <PlusIcon class="size-4" />
        {{ t("app.addHost") }}
      </Button>
    </div>
    <HostEditList />
  </div>
</template>
