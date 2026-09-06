<script setup lang="ts">
import { ExternalLinkIcon, LoaderCircleIcon, RefreshCwIcon, ShieldAlertIcon } from "@lucide/vue";
import {
  WebPreview,
  WebPreviewBody,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
} from "@codex-gateway/ai-elements/web-preview";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useGatewayBrowserStore } from "@/stores/gateway-browser";
import { openBrowserPreview } from "@/stores/gateway-browser/transport";
import { setBrowserPreviewInsecureTls } from "@/stores/gateway-browser/transport";
import BrowserPreviewDiagnostics from "./BrowserPreviewDiagnostics.vue";

const props = defineProps<{ panelId: string }>();
const browser = useGatewayBrowserStore();
const { panels, sessions, frameWarnings, resourceFailures } = storeToRefs(browser);
const opening = ref(false);
const error = ref("");
const frameKey = ref(0);
const frameUrl = ref("");
const panel = computed(() => panels.value[props.panelId] ?? null);
const session = computed(() =>
  Object.values(sessions.value).find((item) => item.panelId === props.panelId),
);
const warning = computed(() =>
  session.value ? frameWarnings.value[session.value.sessionId] : undefined,
);
const failures = computed(() =>
  session.value ? (resourceFailures.value[session.value.sessionId] ?? []) : [],
);

watch(
  session,
  (activeSession) => {
    if (activeSession === undefined) {
      frameUrl.value = "";
      return;
    }
    frameUrl.value = activeSession.bootstrapUrl;
    frameKey.value += 1;
  },
  { immediate: true },
);

watch(
  [panel, session],
  async ([target, activeSession]) => {
    if (!target || activeSession || opening.value) return;
    opening.value = true;
    error.value = "";
    try {
      await openBrowserPreview(target);
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason);
    } finally {
      opening.value = false;
    }
  },
  { immediate: true },
);

function reload() {
  if (!session.value) return;
  browser.clearResourceFailures(session.value.sessionId);
  frameUrl.value = previewTargetUrl(session.value);
  frameKey.value += 1;
}

function previewTargetUrl(activeSession: NonNullable<typeof session.value>) {
  const target = new URL(activeSession.targetUrl);
  return `${activeSession.previewOrigin}${target.pathname}${target.search}${target.hash}`;
}

async function toggleInsecureTls() {
  if (!session.value) return;
  await setBrowserPreviewInsecureTls(session.value.sessionId, !session.value.allowInsecureTls);
  reload();
}
</script>

<template>
  <WebPreview
    :default-url="panel?.targetUrl ?? ''"
    class="h-full min-h-0 overflow-hidden rounded-none border-0 bg-surface"
  >
    <WebPreviewNavigation class="h-10 shrink-0 gap-2 border-hairline px-2 py-0">
      <WebPreviewNavigationButton :tooltip="$t('app.reload')" @click="reload">
        <RefreshCwIcon class="size-4" />
      </WebPreviewNavigationButton>
      <WebPreviewUrl
        class="min-w-0 bg-canvas-soft text-ink-muted"
        :aria-label="$t('app.browserAddress')"
        readonly
      />
      <WebPreviewNavigationButton
        v-if="session && session.targetUrl.startsWith('https://')"
        :class="session.allowInsecureTls ? 'text-warning' : ''"
        :tooltip="$t('app.allowInsecureTls')"
        @click="toggleInsecureTls"
      >
        <ShieldAlertIcon class="size-4" />
      </WebPreviewNavigationButton>
      <WebPreviewNavigationButton
        v-if="session"
        as="a"
        :href="previewTargetUrl(session)"
        target="_blank"
        rel="noopener noreferrer"
        :tooltip="$t('app.openExternally')"
      >
        <ExternalLinkIcon class="size-4" />
      </WebPreviewNavigationButton>
    </WebPreviewNavigation>
    <div
      v-if="warning"
      class="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-2 text-sm"
    >
      <ShieldAlertIcon class="size-4 shrink-0" />
      <span class="min-w-0 flex-1 truncate">{{ $t("app.browserFrameBlocked") }}</span>
      <a
        v-if="session"
        :href="session.previewOrigin"
        target="_blank"
        rel="noopener noreferrer"
        class="font-medium underline"
      >
        {{ $t("app.openExternally") }}
      </a>
    </div>
    <BrowserPreviewDiagnostics
      v-if="session && failures.length > 0"
      :failures="failures"
      @dismiss="browser.clearResourceFailures(session.sessionId)"
    />
    <div v-if="opening" class="grid min-h-0 flex-1 place-items-center text-ink-muted">
      <LoaderCircleIcon class="size-5 animate-spin" />
    </div>
    <div v-else-if="error" class="grid min-h-0 flex-1 place-items-center p-6 text-sm text-danger">
      {{ error }}
    </div>
    <WebPreviewBody
      v-else-if="session"
      :key="frameKey"
      :src="frameUrl"
      class="bg-white"
      :title="panel?.title"
      allow="clipboard-read; clipboard-write; fullscreen"
    />
  </WebPreview>
</template>
