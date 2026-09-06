<script setup lang="ts">
import type { FileReference } from "~~/shared/types";
import { FileIcon, LoaderCircleIcon } from "@lucide/vue";
import { Button } from "@codex-gateway/ui/button";
import { Command, CommandList } from "@codex-gateway/ui/command";
import { ScrollArea } from "@codex-gateway/ui/scroll-area";

defineProps<{
  open: boolean;
  files: FileReference[];
  selectedIndex: number;
  loading: boolean;
  query: string;
  error: string | null;
}>();

const emit = defineEmits<{
  select: [file: FileReference];
  hover: [index: number];
}>();

function directoryPath(path: string) {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex === -1 ? "" : path.slice(0, separatorIndex);
}
</script>

<template>
  <div
    v-if="open"
    data-testid="file-mention-menu"
    class="absolute inset-x-2 bottom-full z-30 mb-2 overflow-hidden rounded-2xl border border-hairline bg-surface p-1 shadow-xl shadow-ink/10"
    role="listbox"
    :aria-label="$t('app.projectFiles')"
  >
    <div v-if="loading" class="flex items-center gap-2 px-3 py-2 text-sm text-ink-muted">
      <LoaderCircleIcon class="size-4 animate-spin" />
      {{ $t("app.searchingProjectFiles") }}
    </div>
    <div v-else-if="error" class="px-3 py-2 text-sm text-danger">{{ error }}</div>
    <div v-else-if="files.length === 0" class="px-3 py-2 text-sm text-ink-muted">
      {{ query ? $t("app.noMatchingProjectFiles") : $t("app.noProjectFiles") }}
    </div>
    <Command v-else>
      <CommandList>
        <ScrollArea class="h-[min(45vh,18rem)]">
          <Button
            v-for="(file, index) in files"
            :key="file.path"
            type="button"
            variant="ghost"
            role="option"
            class="min-h-0 w-full justify-start gap-2 overflow-hidden rounded-xl px-3 py-2 text-left"
            :class="index === selectedIndex ? 'bg-canvas-soft text-ink' : 'text-ink-secondary'"
            :aria-selected="index === selectedIndex"
            :data-testid="`file-mention-option-${index}`"
            @mouseenter="emit('hover', index)"
            @mousedown.prevent
            @click="emit('select', file)"
          >
            <FileIcon class="size-4 shrink-0 text-primary" />
            <span data-testid="file-mention-label" class="min-w-0 flex-1 truncate text-sm">
              <span data-testid="file-mention-name" class="font-medium">{{ file.name }}</span>
              <span
                v-if="directoryPath(file.path)"
                data-testid="file-mention-directory"
                class="ml-2 text-ink-muted"
              >
                {{ directoryPath(file.path) }}
              </span>
            </span>
          </Button>
        </ScrollArea>
      </CommandList>
    </Command>
  </div>
</template>
