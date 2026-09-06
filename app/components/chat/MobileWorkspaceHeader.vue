<script setup lang="ts">
import { MinusIcon, PlusIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { Button } from "@codex-gateway/ui/button";
import CodexUsageBadge from "@/components/chat/CodexUsageBadge.vue";
import { useGatewayAppearanceStore } from "@/stores/gateway-appearance";

defineProps<{
  hostId: number | null;
}>();

const appearance = useGatewayAppearanceStore();
const { canDecreaseChatTextSize, canIncreaseChatTextSize } = storeToRefs(appearance);
</script>

<template>
  <header
    class="flex min-h-14 shrink-0 items-center gap-2 border-b border-hairline bg-surface/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur"
  >
    <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
      <slot name="start" />
    </div>
    <div class="relative z-10 ml-auto flex shrink-0 items-center justify-end gap-1">
      <CodexUsageBadge :host-id="hostId" />
      <Button
        data-testid="decrease-chat-text-size"
        type="button"
        variant="ghost"
        size="sm"
        class="size-8 shrink-0 rounded-md p-0 text-ink-muted hover:bg-canvas-soft hover:text-ink"
        :disabled="!canDecreaseChatTextSize"
        :aria-label="$t('app.decreaseChatTextSize')"
        :title="$t('app.decreaseChatTextSize')"
        @click="appearance.decreaseChatTextSize"
      >
        <MinusIcon class="size-4" />
      </Button>
      <Button
        data-testid="increase-chat-text-size"
        type="button"
        variant="ghost"
        size="sm"
        class="size-8 shrink-0 rounded-md p-0 text-ink-muted hover:bg-canvas-soft hover:text-ink"
        :disabled="!canIncreaseChatTextSize"
        :aria-label="$t('app.increaseChatTextSize')"
        :title="$t('app.increaseChatTextSize')"
        @click="appearance.increaseChatTextSize"
      >
        <PlusIcon class="size-4" />
      </Button>
    </div>
  </header>
</template>
