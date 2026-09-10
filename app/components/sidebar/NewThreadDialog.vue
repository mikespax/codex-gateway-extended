<script setup lang="ts">
import { Button } from "@codex-gateway/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@codex-gateway/ui/dialog";
import { Input } from "@codex-gateway/ui/input";
import { Label } from "@codex-gateway/ui/label";

const props = defineProps<{
  open: boolean;
  hostName: string;
  modelValue: string;
  submitting: boolean;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  "update:modelValue": [value: string];
  submit: [];
}>();
</script>

<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogContent data-testid="new-thread-name-dialog" class="sm:max-w-md">
      <form class="grid gap-4" @submit.prevent="emit('submit')">
        <DialogHeader>
          <DialogTitle>{{ $t("app.newThreadNameTitle") }}</DialogTitle>
          <DialogDescription>
            {{ $t("app.newThreadNameDescription") }}
            <span v-if="hostName" class="mt-1 block text-ink-secondary">
              {{ $t("app.newThreadTargetHost", { host: hostName }) }}
            </span>
          </DialogDescription>
        </DialogHeader>
        <div class="grid gap-2">
          <Label for="new-thread-name-input">{{ $t("app.threadName") }}</Label>
          <Input
            id="new-thread-name-input"
            autofocus
            data-testid="new-thread-name-input"
            :placeholder="$t('app.newThreadNamePlaceholder')"
            :model-value="props.modelValue"
            :disabled="props.submitting"
            @update:model-value="emit('update:modelValue', String($event))"
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="props.submitting"
            @click="emit('update:open', false)"
          >
            {{ $t("app.cancel") }}
          </Button>
          <Button
            type="submit"
            data-testid="new-thread-create-submit"
            :disabled="props.submitting || props.modelValue.trim() === ''"
          >
            {{ $t("app.createThread") }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
