<script setup lang="ts">
import { PlusIcon } from "@lucide/vue";
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
