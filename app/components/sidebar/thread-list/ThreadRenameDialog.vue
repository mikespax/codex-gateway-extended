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
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent data-testid="rename-thread-dialog" class="sm:max-w-md">
      <form class="grid gap-4" @submit.prevent="emit('submit')">
        <DialogHeader>
          <DialogTitle>{{ $t("app.renameThread") }}</DialogTitle>
          <DialogDescription>{{ $t("app.renameThreadDescription") }}</DialogDescription>
        </DialogHeader>
        <div class="grid gap-2">
          <Label for="rename-thread-input">{{ $t("app.threadName") }}</Label>
          <Input
            id="rename-thread-input"
            autofocus
            data-testid="rename-thread-input"
            :model-value="modelValue"
            :disabled="submitting"
            @update:model-value="emit('update:modelValue', String($event))"
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="submitting"
            @click="emit('update:open', false)"
          >
            {{ $t("app.cancel") }}
          </Button>
          <Button
            type="submit"
            data-testid="rename-thread-submit"
            :disabled="submitting || modelValue.trim() === ''"
          >
            {{ $t("app.save") }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
