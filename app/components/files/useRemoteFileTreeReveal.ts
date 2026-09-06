import scrollIntoView from "scroll-into-view-if-needed";
import { nextTick, ref, watch, type ComputedRef, type Ref } from "vue";
import type { RemoteDirectoryEntry } from "~~/shared/types";
import { useGatewayFileWorkspaceStore } from "@/stores/file-workspace";

interface FileTreeNode {
  path: string;
  type: RemoteDirectoryEntry["type"];
  children?: FileTreeNode[];
}

export function useRemoteFileTreeReveal(options: {
  hostId: () => number;
  threadId: () => string;
  rootPath: () => string;
  visible: () => boolean;
  activePath: ComputedRef<string | null>;
  tree: ComputedRef<FileTreeNode[]>;
  selected: Ref<FileTreeNode | undefined>;
  viewport: Readonly<Ref<HTMLElement | null>>;
}) {
  const fileWorkspace = useGatewayFileWorkspaceStore();
  const revealSequence = ref(0);

  watch(
    () =>
      [
        options.hostId(),
        options.threadId(),
        options.rootPath(),
        options.activePath.value,
        options.visible(),
      ] as const,
    async ([hostId, threadId, rootPath, path, visible]) => {
      const sequence = ++revealSequence.value;
      if (!visible || rootPath === "") return;
      if (path === null || path === "") {
        options.selected.value = undefined;
        return;
      }

      // Files outside the conversation root remain valid preview documents. They deliberately do
      // not affect the tree because their ancestors cannot be represented beneath this TreeRoot.
      if (!(await fileWorkspace.revealFileInTree(hostId, threadId, path))) {
        if (sequence === revealSequence.value) options.selected.value = undefined;
        return;
      }
      await nextTick();
      if (sequence !== revealSequence.value) return;

      const node = findNode(options.tree.value, path);
      options.selected.value = node;
      await nextTick();
      if (!node || sequence !== revealSequence.value) return;

      const viewport = options.viewport.value?.querySelector<HTMLElement>(
        "[data-testid='remote-file-tree-scroll']",
      );
      const row = [...(viewport?.querySelectorAll<HTMLElement>("[data-file-path]") ?? [])].find(
        (element) => element.dataset.filePath === path,
      );
      if (!viewport || !row) return;

      // Native scrollIntoView walks every scrollable ancestor up to document.scrollingElement.
      // During a restored Dockview scope the browser can therefore reveal the file row by scrolling
      // the entire application, moving the workspace above the viewport. The library boundary
      // includes this tree viewport but stops before its parents, so only the file tree can move.
      // Do not replace this with an unbounded native call, even with block/inline set to "nearest".
      scrollIntoView(row, {
        boundary: viewport,
        block: "nearest",
        inline: "nearest",
        scrollMode: "if-needed",
      });
    },
    { immediate: true },
  );
}

function findNode(nodes: FileTreeNode[], path: string): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const child = node.children ? findNode(node.children, path) : undefined;
    if (child) return child;
  }
  return undefined;
}
