<script setup lang="ts">
import ChatWorkspace from "@/components/chat/ChatWorkspace.vue";
import GatewaySidebar from "@/components/sidebar/GatewaySidebar.vue";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "@codex-gateway/ui/sidebar";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const SIDEBAR_WIDTH_KEY = "codex-gateway-sidebar-width";
const SIDEBAR_MIN_WIDTH = 230;
const SIDEBAR_MAX_WIDTH = 480;
const sidebarWidth = ref(256);
const resizingSidebar = ref(false);
const sidebarStyle = computed(() => ({ "--sidebar-width": `${sidebarWidth.value}px` }));

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function startSidebarResize(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  resizingSidebar.value = true;
  window.addEventListener("pointermove", handleSidebarPointerMove);
  window.addEventListener("pointerup", stopSidebarResize, { once: true });
}

function handleSidebarPointerMove(event: PointerEvent) {
  if (!resizingSidebar.value) return;
  sidebarWidth.value = clampSidebarWidth(event.clientX);
}

function stopSidebarResize() {
  if (!resizingSidebar.value) return;
  resizingSidebar.value = false;
  window.removeEventListener("pointermove", handleSidebarPointerMove);
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value));
}

function resetSidebarWidth() {
  sidebarWidth.value = 256;
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth.value));
}

onMounted(() => {
  const storedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (Number.isFinite(storedWidth)) sidebarWidth.value = clampSidebarWidth(storedWidth);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", handleSidebarPointerMove);
  window.removeEventListener("pointerup", stopSidebarResize);
});
</script>

<template>
  <main data-testid="desktop-layout" class="h-[100dvh] overflow-hidden bg-canvas-soft text-ink">
    <SidebarProvider :style="sidebarStyle" class="h-full min-h-0">
      <Sidebar collapsible="offcanvas">
        <GatewaySidebar />
        <div
          data-testid="sidebar-resize-handle"
          class="group/sidebar-resize absolute inset-y-0 right-0 z-30 hidden w-3 cursor-col-resize touch-none select-none border-r border-transparent bg-transparent transition-colors hover:border-primary/70 hover:bg-primary/15 md:block"
          :class="{ 'bg-primary/30': resizingSidebar }"
          title="Drag to resize sidebar; double-click to reset"
          @dblclick="resetSidebarWidth"
          @pointerdown="startSidebarResize"
        />
        <SidebarRail
          data-testid="desktop-sidebar-expand"
          :title="$t('app.openSidebar')"
          :aria-label="$t('app.openSidebar')"
        />
      </Sidebar>
      <SidebarInset class="h-full min-h-0 min-w-0 overflow-hidden">
        <ChatWorkspace />
      </SidebarInset>
    </SidebarProvider>
  </main>
</template>
