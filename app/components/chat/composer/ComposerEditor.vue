<script setup lang="ts">
import { basicSetup } from "codemirror";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import {
  EditorState,
  Prec,
  StateEffect,
  type Extension,
  type Range,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  placeholder as placeholderExtension,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { FileReference } from "~~/shared/types";
import type { ComposerFileReference } from "@/stores/gateway/types";
import { gatewayApi } from "@/utils/gateway-api";
import ComposerFileMentionMenu from "./ComposerFileMentionMenu.vue";

const MAX_REFERENCES = 10;

const props = defineProps<{
  modelValue: string;
  references: ComposerFileReference[];
  scopeKey: string;
  projectId: number | null;
  disabled: boolean;
  placeholder: string;
  limitMessage: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string, scopeKey: string];
  "update:references": [value: ComposerFileReference[], scopeKey: string];
  keydown: [event: KeyboardEvent];
  paste: [event: ClipboardEvent];
  limit: [message: string];
}>();

const container = ref<HTMLElement | null>(null);
const view = shallowRef<EditorView | null>(null);
const menuOpen = ref(false);
const query = ref("");
const queryFrom = ref(0);
const files = ref<FileReference[]>([]);
const selectedIndex = ref(0);
const loading = ref(false);
const searchError = ref<string | null>(null);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchController: AbortController | null = null;
let viewportFrame: number | null = null;
let syncing = false;

class FileReferenceWidget extends WidgetType {
  constructor(private readonly reference: ComposerFileReference) {
    super();
  }

  override eq(other: FileReferenceWidget) {
    return other.reference.id === this.reference.id && other.reference.name === this.reference.name;
  }

  override toDOM() {
    const reference = document.createElement("span");
    reference.className = "cm-file-reference";
    reference.dataset.fileReference = this.reference.path;
    reference.textContent = `@${this.reference.name}`;
    return reference;
  }
}

onMounted(() => {
  if (!container.value) return;
  view.value = new EditorView({
    parent: container.value,
    state: EditorState.create({ doc: props.modelValue, extensions: extensions() }),
  });
  window.visualViewport?.addEventListener("resize", queueSelectionIntoView);
  window.visualViewport?.addEventListener("scroll", queueSelectionIntoView);
});

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
  if (viewportFrame !== null) cancelAnimationFrame(viewportFrame);
  window.visualViewport?.removeEventListener("resize", queueSelectionIntoView);
  window.visualViewport?.removeEventListener("scroll", queueSelectionIntoView);
  searchController?.abort();
  view.value?.destroy();
  view.value = null;
});

function queueSelectionIntoView() {
  if (viewportFrame !== null) cancelAnimationFrame(viewportFrame);
  viewportFrame = requestAnimationFrame(() => {
    viewportFrame = null;
    const editor = view.value;
    if (!editor?.hasFocus) return;
    editor.requestMeasure();
    editor.dispatch({
      effects: EditorView.scrollIntoView(editor.state.selection.main.head, { y: "nearest" }),
    });
  });
}

function focus() {
  if (props.disabled) return;
  view.value?.focus();
  queueSelectionIntoView();
}

defineExpose({ focus });

watch(
  () => props.modelValue,
  (value) => {
    const editor = view.value;
    if (!editor || editor.state.doc.toString() === value) return;
    syncing = true;
    try {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    } finally {
      syncing = false;
    }
  },
);

watch(
  () => props.references,
  () => reconfigure(),
  { deep: true },
);
watch(() => props.disabled, reconfigure);
watch(() => props.placeholder, reconfigure);

function reconfigure() {
  const editor = view.value;
  if (!editor) return;
  editor.dispatch({ effects: StateEffect.reconfigure.of(extensions()) });
}

function extensions(): Extension[] {
  const mentionPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(editor: EditorView) {
        this.decorations = mentionDecorations(editor.state.doc);
      }
      update(update: ViewUpdate) {
        if (update.docChanged) this.decorations = mentionDecorations(update.state.doc);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
  return [
    basicSetup,
    EditorView.lineWrapping,
    EditorView.editable.of(!props.disabled),
    placeholderExtension(props.placeholder),
    mentionPlugin,
    EditorView.atomicRanges.of(
      (editor) => editor.plugin(mentionPlugin)?.decorations ?? Decoration.none,
    ),
    Prec.high(
      EditorView.domEventHandlers({
        keydown: (event) => {
          if (handleMentionKeydown(event)) return true;
          emit("keydown", event);
          return event.defaultPrevented;
        },
        paste: (event) => {
          emit("paste", event);
          return event.defaultPrevented;
        },
        focus: () => {
          queueSelectionIntoView();
          return false;
        },
      }),
    ),
    EditorView.contentAttributes.of({
      "aria-label": props.placeholder,
      placeholder: props.placeholder,
      spellcheck: "true",
      autocapitalize: "sentences",
      autocorrect: "on",
      inputmode: "text",
      enterkeyhint: "enter",
      "data-testid": "composer-input",
      "data-value": props.modelValue,
    }),
    EditorView.updateListener.of(handleUpdate),
  ];
}

function mentionDecorations(doc: Text) {
  const ranges: Array<Range<Decoration>> = [];
  for (const reference of props.references) {
    const literal = `@${reference.path}`;
    let offset = 0;
    while (offset < doc.length) {
      const found = doc.sliceString(offset).indexOf(literal);
      if (found < 0) break;
      const from = offset + found;
      const to = from + literal.length;
      ranges.push(
        Decoration.replace({
          widget: new FileReferenceWidget(reference),
        }).range(from, to),
      );
      offset = to;
    }
  }
  return Decoration.set(ranges.sort((left, right) => left.from - right.from));
}

function handleUpdate(update: ViewUpdate) {
  if (update.docChanged) {
    const text = update.state.doc.toString();
    update.view.contentDOM.dataset.value = text;
    if (!syncing) {
      emit("update:modelValue", text, props.scopeKey);
      const retained = props.references.filter((reference) => text.includes(`@${reference.path}`));
      if (retained.length !== props.references.length)
        emit("update:references", retained, props.scopeKey);
    }
  }
  if (update.docChanged || update.selectionSet) updateMentionQuery(update.view);
}

function updateMentionQuery(editor: EditorView) {
  if (props.disabled || props.projectId === null || editor.state.selection.ranges.length !== 1) {
    dismissMenu();
    return;
  }
  const cursor = editor.state.selection.main.head;
  const line = editor.state.doc.lineAt(cursor);
  const before = editor.state.doc.sliceString(line.from, cursor);
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(before);
  if (!match) {
    dismissMenu();
    return;
  }
  query.value = match[1] ?? "";
  queryFrom.value = cursor - query.value.length - 1;
  menuOpen.value = true;
  selectedIndex.value = 0;
  scheduleSearch();
}

function scheduleSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchController?.abort();
  searchTimer = setTimeout(() => void search(), 100);
}

async function search() {
  if (!menuOpen.value || props.projectId === null) return;
  const controller = new AbortController();
  searchController = controller;
  loading.value = true;
  searchError.value = null;
  try {
    const result = await gatewayApi<{ files: FileReference[] }>(
      `/api/projects/${props.projectId}/files`,
      {
        query: { q: query.value },
        signal: controller.signal,
      },
    );
    if (controller.signal.aborted) return;
    files.value = result.files;
    selectedIndex.value = 0;
  } catch (error) {
    if (controller.signal.aborted) return;
    files.value = [];
    searchError.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (searchController === controller) {
      loading.value = false;
      searchController = null;
    }
  }
}

function moveSelection(delta: number) {
  if (!menuOpen.value) return false;
  if (files.value.length === 0) return true;
  selectedIndex.value = (selectedIndex.value + delta + files.value.length) % files.value.length;
  return true;
}

function selectCurrent() {
  if (!menuOpen.value) return false;
  if (files.value.length === 0) return true;
  selectFile(files.value[selectedIndex.value]!);
  return true;
}

function handleMentionKeydown(event: KeyboardEvent) {
  if (!menuOpen.value || event.isComposing) return false;
  const handlers: Partial<Record<string, () => boolean>> = {
    ArrowDown: () => moveSelection(1),
    ArrowUp: () => moveSelection(-1),
    Enter: selectCurrent,
    Escape: dismissMenu,
  };
  return handlers[event.key]?.() ?? false;
}

function selectFile(file: FileReference) {
  const editor = view.value;
  if (!editor) return;
  const existing = props.references.find((reference) => reference.path === file.path);
  if (!existing && props.references.length >= MAX_REFERENCES) {
    emit("limit", props.limitMessage);
    return;
  }
  const cursor = editor.state.selection.main.head;
  editor.dispatch({
    changes: { from: queryFrom.value, to: cursor, insert: `@${file.path} ` },
    selection: { anchor: queryFrom.value + file.path.length + 2 },
  });
  if (!existing) {
    emit(
      "update:references",
      [
        ...props.references,
        { ...file, id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${file.path}` },
      ],
      props.scopeKey,
    );
  }
  dismissMenu();
  focus();
}

function dismissMenu() {
  if (!menuOpen.value) return false;
  menuOpen.value = false;
  files.value = [];
  searchError.value = null;
  searchController?.abort();
  return true;
}
</script>

<template>
  <ComposerFileMentionMenu
    :open="menuOpen"
    :files="files"
    :selected-index="selectedIndex"
    :loading="loading"
    :query="query"
    :error="searchError"
    @hover="selectedIndex = $event"
    @select="selectFile"
  />
  <div
    ref="container"
    data-testid="composer-editor"
    class="composer-editor relative"
    :class="{ 'composer-empty': !modelValue }"
  />
</template>

<style>
.composer-editor .cm-editor {
  max-height: min(28dvh, 10rem);
  min-height: 3.25rem;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  transition:
    border-color 120ms ease,
    box-shadow 120ms ease,
    background-color 120ms ease;
}
.composer-editor.composer-empty:not(:focus-within)::before {
  position: absolute;
  top: 0.75rem;
  left: 0.25rem;
  z-index: 1;
  width: 2px;
  height: 1.5rem;
  border-radius: 999px;
  background: var(--primary);
  content: "";
  pointer-events: none;
  animation: composer-caret-blink 1.05s steps(1, end) infinite;
}
@keyframes composer-caret-blink {
  0%,
  48% {
    opacity: 1;
  }
  49%,
  100% {
    opacity: 0.15;
  }
}
.composer-editor:focus-within .cm-editor {
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 8%, transparent);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--primary) 28%, transparent),
    0 0 18px color-mix(in srgb, var(--primary) 18%, transparent);
}
.composer-editor .cm-scroller {
  overflow: auto;
  overscroll-behavior: contain;
  scroll-padding-block: 1rem;
  font-family: inherit;
}
.composer-editor .cm-content {
  min-height: 3.25rem;
  padding: 0.5rem 0.25rem;
  font-size: 1rem;
  line-height: 1.5rem;
  caret-color: var(--primary);
}
.composer-editor .cm-focused .cm-content {
  caret-color: var(--primary);
}
.composer-editor .cm-focused {
  outline: none;
}
.composer-editor .cm-gutters {
  display: none;
}
.composer-editor .cm-activeLine,
.composer-editor .cm-activeLineGutter {
  background: transparent;
}
.composer-editor .cm-file-reference {
  display: inline-flex;
  max-width: min(100%, 28rem);
  align-items: center;
  gap: 0.25rem;
  overflow: hidden;
  border-radius: 0.5rem;
  background: color-mix(in srgb, var(--primary) 13%, transparent);
  padding: 0.0625rem 0.25rem 0.0625rem 0.375rem;
  color: var(--primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875rem;
  vertical-align: baseline;
  white-space: nowrap;
}
@media (max-width: 47.999rem) {
  .composer-editor:focus-within .cm-editor,
  .composer-editor:focus-within .cm-content {
    min-height: min(32dvh, 12rem);
  }
  .composer-editor:focus-within .cm-editor {
    max-height: min(48dvh, 18rem);
  }
}
@media (min-width: 48rem) {
  .composer-editor .cm-editor {
    max-height: min(24vh, 12rem);
    min-height: clamp(3.75rem, 10vh, 6rem);
  }
  .composer-editor .cm-content {
    min-height: clamp(3.75rem, 10vh, 6rem);
    line-height: 1.75rem;
  }
}
</style>
