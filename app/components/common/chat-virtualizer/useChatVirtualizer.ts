import { useEventListener } from "@vueuse/core";
import {
  computed,
  nextTick,
  ref,
  toValue,
  type ComponentPublicInstance,
  type MaybeRefOrGetter,
} from "vue";
import { createChatVirtualizerBehavior } from "./anchoring";
import { useDirectDomVirtualizer } from "./direct-dom-virtualizer";

interface ChatVirtualizerOptions {
  count: MaybeRefOrGetter<number>;
  getViewport: () => HTMLElement | null;
  getItemKeySnapshot: () => (index: number) => string | number;
  estimateSize: (index: number) => number;
  threshold?: MaybeRefOrGetter<number>;
  overscan?: MaybeRefOrGetter<number>;
  onViewportScroll?: (viewport: HTMLElement) => void;
}

export function useChatVirtualizer(options: ChatVirtualizerOptions) {
  const threshold = () => toValue(options.threshold) ?? 120;
  // Mirror core's at-end result only from real scroll transactions. Reading isAtEnd from a
  // computed during setOptions can observe core's eagerly resolved anchor against Vue's previous
  // DOM height; that transient geometry must not drive UI policy such as intermediate collapse.
  // This ref does not infer input intent or write scrollTop: TanStack remains the sole authority.
  const followLatest = ref(true);
  const viewportElement = computed(options.getViewport);
  const directVirtualizer = useDirectDomVirtualizer(
    computed(() => {
      const getItemKey = options.getItemKeySnapshot();
      return {
        count: toValue(options.count),
        getScrollElement: options.getViewport,
        // Core calls both the previous and next getItemKey while classifying an update as prepend
        // or append. Capture this render's immutable row-array reference, matching React's
        // `useCallback(..., [messages])`; a permanent callback that reads live Vue props makes the
        // "previous" function see new keys and silently disables Core's official prepend anchor.
        getItemKey,
        estimateSize: options.estimateSize,
        overscan: toValue(options.overscan) ?? 0,
        ...createChatVirtualizerBehavior(threshold()),
      };
    }),
  );
  const virtualizer = directVirtualizer.virtualizer;
  const virtualItems = computed(() => virtualizer.value.getVirtualItems());
  const isScrolling = computed(() => virtualizer.value.isScrolling);
  const userDetached = computed(() => !followLatest.value);

  // Virtual Core intentionally coalesces onChange by range/isScrolling. A single very tall Agent
  // row can scroll without changing either value, so onChange is not an offset event stream. Use
  // VueUse's passive native listener only to project actual viewport geometry into UI state; core
  // still owns measurements, end following, iOS deferral, prepend anchors, and every scroll write.
  useEventListener(
    viewportElement,
    "scroll",
    (event) => {
      const viewport = event.currentTarget;
      if (!(viewport instanceof HTMLElement)) return;
      // Diff and command output own bounded nested scrollports. Ignore their scroll events at the
      // outer Chat boundary just as stick-to-bottom-state does; only geometry changes reported by
      // the outer viewport may change followLatest. Do not infer this from item types or stop
      // nested scrolling in each card, because scroll ownership belongs to the two viewports.
      if (event.target !== viewport) return;
      const distanceFromEnd = Math.max(
        0,
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight,
      );
      followLatest.value = distanceFromEnd <= threshold();
      options.onViewportScroll?.(viewport);
    },
    { passive: true },
  );

  function elementFromRef(refValue: Element | ComponentPublicInstance | null) {
    return refValue instanceof Element ? refValue : null;
  }

  function measureElement(refValue: Element | ComponentPublicInstance | null) {
    const element = elementFromRef(refValue);
    if (element === null) return null;

    const index = element instanceof HTMLElement ? Number(element.dataset.index) : Number.NaN;
    if (Number.isFinite(index)) directVirtualizer.measureElement(element);
    return element;
  }

  function refresh() {
    // Dockview can keep a panel mounted while its viewport is temporarily hidden. Reconnect the
    // official observer and reapply core-computed transforms when it becomes visible again, but do
    // not restore a DOM anchor or write scrollTop here. TanStack's measurement cache and Chat
    // anchoring remain the only source of scroll geometry.
    directVirtualizer.refresh({ forceStyles: true, remeasure: false });
  }

  async function scrollToLatest() {
    // Explicit navigation/submission intent takes ownership before Vue commits the appended row.
    // Setting this after nextTick leaves the intervening append classified as detached and is the
    // reason a newly submitted user message could remain hidden behind the composer.
    followLatest.value = true;
    await nextTick();
    refresh();
    // The official Chat guide recommends an imperative initial scroll after the viewport mounts.
    // Later appends and streaming growth are owned by followOnAppend/end anchoring; repeatedly
    // calling this method for content updates would override a reader who intentionally scrolled up.
    virtualizer.value.scrollToEnd({ behavior: "auto" });
  }

  return {
    containerRef: directVirtualizer.containerRef,
    followLatest,
    isScrolling,
    measureElement,
    refresh,
    scrollToLatest,
    userDetached,
    virtualItems,
    virtualizer,
  };
}
