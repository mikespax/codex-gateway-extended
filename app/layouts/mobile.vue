<script setup lang="ts">
import { MenuIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { ref, watch } from "vue";
import ChatWorkspace from "@/components/chat/ChatWorkspace.vue";
import GatewaySidebar from "@/components/sidebar/GatewaySidebar.vue";
import { Button } from "@codex-gateway/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@codex-gateway/ui/sheet";
import { useGatewayCatalogStore } from "@/stores/gateway-catalog";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { projectById } from "@/stores/gateway-catalog/selectors";
import { useGatewayNavigationStore } from "@/stores/gateway-navigation";
import { useGatewayThreadViewStore } from "@/stores/gateway-thread-view";
import { titleForThread } from "@/stores/gateway/thread-utils/identity";

const catalog = useGatewayCatalogStore();
const config = useGatewayConfigStore();
const navigation = useGatewayNavigationStore();
const { projects } = storeToRefs(catalog);
const { selectedThreadId, selectedHostId, selectedProjectId } = storeToRefs(navigation);
const { currentThread } = storeToRefs(useGatewayThreadViewStore());
const selectedProject = computed(() => projectById(projects.value, selectedProjectId.value));
const sidebarOpen = ref(false);
const mobileTitle = computed(() => {
  if (selectedThreadId.value && currentThread.value) {
    return titleForThread(currentThread.value);
  }
  return selectedProject.value?.name || "Codex Gateway";
});

watch([selectedHostId, selectedProjectId, selectedThreadId], () => {
  sidebarOpen.value = false;
});

watch(sidebarOpen, (open) => {
  const hostId = selectedHostId.value;
  if (!open || hostId === null) return;

  // The mobile Sheet stays mounted between opens. Refresh the host overview when it becomes
  // visible so chats created or completed in another desktop/session are reflected without
  // mutating the stable recent-list ordering during a running turn.
  void Promise.all([config.refreshPinnedThreads(), navigation.refreshHostProjects(hostId)])
    .then(async () => {
      if (selectedHostId.value !== hostId || selectedProjectId.value === null) return;
      await navigation.listThreads();
    })
    .catch(() => {
      // The sidebar remains usable with its last known data when a background refresh fails.
    });
});
</script>

<template>
  <main
    data-testid="mobile-layout"
    class="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-canvas-soft text-ink"
  >
    <ChatWorkspace layout="mobile">
      <template #mobile-header-start>
        <Sheet v-model:open="sidebarOpen">
          <Button
            data-testid="mobile-sidebar-toggle"
            type="button"
            variant="ghost"
            size="icon-lg"
            class="shrink-0 rounded-xl"
            :aria-label="$t('app.openSidebar')"
            @click="sidebarOpen = true"
          >
            <MenuIcon class="size-5" />
          </Button>
          <SheetContent
            side="left"
            class="w-[min(92vw,26rem)] border-r border-hairline bg-canvas-soft p-0 shadow-2xl"
          >
            <SheetHeader class="sr-only">
              <SheetTitle>{{ $t("app.sidebar") }}</SheetTitle>
              <SheetDescription>{{ $t("app.sidebarDescription") }}</SheetDescription>
            </SheetHeader>
            <GatewaySidebar class="h-full" :workspace-toolbar="false" />
          </SheetContent>
        </Sheet>
        <div class="min-w-0 flex-1">
          <p data-testid="mobile-thread-title" class="truncate text-[0.9375rem] font-semibold">
            {{ mobileTitle }}
          </p>
          <p class="truncate text-xs text-ink-muted">Codex Gateway</p>
        </div>
      </template>
    </ChatWorkspace>
  </main>
</template>
