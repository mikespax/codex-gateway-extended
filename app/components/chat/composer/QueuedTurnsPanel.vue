<script setup lang="ts">
import { ref, watch } from "vue";
import { CheckIcon, PencilIcon, SendIcon, Trash2Icon, XIcon } from "@lucide/vue";
import type { QueuedTurn } from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";

const props = defineProps<{
  turns: QueuedTurn[];
  isThreadRunning: boolean;
}>();

const emit = defineEmits<{
  edit: [queuedId: string, text: string];
  remove: [queuedId: string];
  steer: [queuedId: string];
}>();

const editingId = ref<string | null>(null);
const editingText = ref("");

watch(
  () => props.turns,
  (turns) => {
    if (editingId.value !== null && !turns.some((turn) => turn.id === editingId.value)) {
      cancelEdit();
    }
  },
  { deep: true },
);

function startEdit(turn: QueuedTurn) {
  editingId.value = turn.id;
  editingText.value = turn.text;
}

function cancelEdit() {
  editingId.value = null;
  editingText.value = "";
}

function saveEdit() {
  const id = editingId.value;
  const text = editingText.value.trim();
  if (id === null || text === "") return;
  emit("edit", id, text);
  cancelEdit();
}

function remove(turn: QueuedTurn) {
  if (editingId.value === turn.id) cancelEdit();
  emit("remove", turn.id);
}
</script>

<template>
  <section
    v-if="turns.length"
    data-testid="queued-turns"
    class="mb-2 space-y-1.5 rounded-2xl border border-primary/20 bg-primary/5 p-2 text-sm"
    aria-live="polite"
  >
    <div class="flex items-center justify-between px-1 text-xs text-primary">
      <span class="font-medium">{{ $t("app.queuedMessages") }} · {{ turns.length }}</span>
      <span class="text-ink-muted">{{ $t("app.queuedMessagesHint") }}</span>
    </div>
    <article
      v-for="turn in turns"
      :key="turn.id"
      :data-testid="`queued-turn-${turn.id}`"
      class="rounded-xl border border-hairline bg-surface/80 p-2"
    >
      <template v-if="editingId === turn.id">
        <textarea
          v-model="editingText"
          data-testid="queued-turn-editor"
          class="min-h-16 w-full resize-y rounded-lg border border-primary/40 bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:ring-1 focus:ring-primary"
          :aria-label="$t('app.editQueuedMessage')"
        />
        <div class="mt-1.5 flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            :aria-label="$t('app.cancelQueuedEdit')"
            @click="cancelEdit"
          >
            <XIcon class="size-3.5" />
            {{ $t("app.cancel") }}
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="save-queued-edit"
            :disabled="!editingText.trim()"
            :aria-label="$t('app.saveQueuedEdit')"
            @click="saveEdit"
          >
            <CheckIcon class="size-3.5" />
            {{ $t("app.save") }}
          </Button>
        </div>
      </template>
      <template v-else>
        <div class="flex items-start gap-2">
          <p class="min-w-0 flex-1 whitespace-pre-wrap break-words text-ink-secondary">
            {{ turn.text || $t("app.emptyQueuedMessage") }}
          </p>
          <span
            v-if="turn.options.files?.length || turn.options.images?.length"
            class="shrink-0 text-[0.625rem] text-ink-muted"
          >
            {{ $t("app.attachmentsQueued") }}
          </span>
        </div>
        <div class="mt-1.5 flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="edit-queued-turn-button"
            :aria-label="$t('app.editQueuedMessage')"
            @click="startEdit(turn)"
          >
            <PencilIcon class="size-3.5" />
            {{ $t("app.edit") }}
          </Button>
          <Button
            v-if="isThreadRunning"
            type="button"
            variant="ghost"
            size="sm"
            data-testid="steer-queued-turn-button"
            :aria-label="$t('app.steerNow')"
            @click="emit('steer', turn.id)"
          >
            <SendIcon class="size-3.5" />
            {{ $t("app.steerNow") }}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="text-destructive hover:text-destructive"
            data-testid="remove-queued-turn-button"
            :aria-label="$t('app.removeQueuedMessage')"
            @click="remove(turn)"
          >
            <Trash2Icon class="size-3.5" />
            {{ $t("app.remove") }}
          </Button>
        </div>
      </template>
    </article>
  </section>
</template>
