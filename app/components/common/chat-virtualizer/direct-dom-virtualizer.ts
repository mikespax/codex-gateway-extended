import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type PartialKeys,
  type VirtualizerOptions,
} from "@tanstack/virtual-core";
import {
  computed,
  onScopeDispose,
  shallowRef,
  triggerRef,
  unref,
  watch,
  type ComputedRef,
  type ComponentPublicInstance,
  type Ref,
} from "vue";

type MaybeRef<T> = T | Ref<T> | ComputedRef<T>;
type DirectDomMode = "position" | "transform";

type DirectDomVirtualizerOptions<
  TScrollElement extends Element,
  TItemElement extends Element,
> = PartialKeys<
  VirtualizerOptions<TScrollElement, TItemElement>,
  "observeElementRect" | "observeElementOffset" | "scrollToFn"
>;

type DirectDomState<TItemElement extends Element> = {
  container: HTMLElement | null;
  lastPositions: WeakMap<HTMLElement, number>;
  lastSize: number | null;
  mode: DirectDomMode;
  pendingMeasurements: Set<TItemElement>;
  prevRange: { startIndex: number; endIndex: number; isScrolling: boolean } | null;
};

// Mirrors TanStack React adapter's directDomUpdates path for chat streams.
// Vue's published adapter does not expose that flag yet, so this wraps the
// official virtual-core and lets TanStack own end anchoring/follow behavior. This adapter may
// synchronize Vue and write row transforms, but it must not capture anchors or write scrollTop;
// doing so would create a second scroll transaction beside virtual-core's official Chat mode.
export function useDirectDomVirtualizer<
  TScrollElement extends Element,
  TItemElement extends Element,
>(
  options: MaybeRef<DirectDomVirtualizerOptions<TScrollElement, TItemElement>>,
  directOptions: { mode?: DirectDomMode } = {},
) {
  const directState: DirectDomState<TItemElement> = {
    container: null,
    lastPositions: new WeakMap<HTMLElement, number>(),
    lastSize: null,
    mode: directOptions.mode ?? "transform",
    pendingMeasurements: new Set<TItemElement>(),
    prevRange: null,
  };

  const resolvedOptions = computed(() => ({
    observeElementRect,
    observeElementOffset,
    scrollToFn: (
      offset: number,
      scrollOptions: { adjustments?: number; behavior?: ScrollBehavior },
      changedInstance: Virtualizer<TScrollElement, TItemElement>,
    ) => {
      // Virtual Core updates its size cache before applying an end-anchor correction. Because this
      // adapter owns the sizer directly, the browser would otherwise receive the new scrollTop
      // while the DOM still exposes the old maximum and clamp the write. The final measured row
      // then leaves exactly its estimate-to-real delta below a supposedly pinned chat.
      //
      // Keep this ordering at the adapter boundary, where every Core-driven scroll passes through;
      // a component ResizeObserver or repeated scrollToEnd would create a second scroll owner and
      // race native iOS momentum. This mirrors the official React direct-DOM adapter requirement
      // that the size container commit before Core synchronizes the scroll position.
      applyContainerSize(changedInstance);
      elementScroll(offset, scrollOptions, changedInstance);
    },
    ...unref(options),
  }));

  const instance = new Virtualizer<TScrollElement, TItemElement>(
    wrapOptions(resolvedOptions.value),
  );
  const state = shallowRef(instance);
  const commitVersion = shallowRef(0);
  const cleanup = instance._didMount();

  function scheduleDomCommit() {
    commitVersion.value += 1;
  }

  // A sync watcher can run before Vue has even queued the component patch, so
  // nextTick from that watcher is not a reliable layout-effect equivalent.
  // A post-flush watcher always sees committed keyed rows and still runs before
  // the browser paints the frame.
  watch(
    commitVersion,
    () => {
      // Match the official React adapter's layout-effect order exactly. The sizer must expose the
      // new scroll range before Core resolves an end anchor; row positions are safe to write only
      // after that transaction. Do not queue row measurements until the ancestor ref mounts:
      // framework refs merely register elements, while this post-flush phase is the commit point.
      applyContainerSize(instance);
      instance._willUpdate();
      applyDirectStyles(instance);
    },
    { flush: "post" },
  );

  watch(
    () => resolvedOptions.value.getScrollElement(),
    (element) => {
      if (element) scheduleDomCommit();
    },
    { flush: "sync", immediate: true },
  );

  watch(
    resolvedOptions,
    (nextOptions) => {
      // setOptions receives stable row keys before Vue patches the DOM. In end-anchored Chat mode,
      // virtual-core captures and resolves prepend/append anchors here; the post-flush callback
      // above only applies the positions core computed. Do not add a Vue-side anchor fallback.
      instance.setOptions(wrapOptions(nextOptions));
      // React-rendered virtualizers put the new sizer height in the same render that creates the
      // new row refs. Our direct-DOM sizer is intentionally outside Vue's style bindings, so mirror
      // that ordering here: setOptions has already computed the new total and this synchronous,
      // idempotent write runs before Vue mounts/measures the corresponding children. Waiting for
      // the post-flush adapter effect lets WebKit clamp Core's first end correction to the previous
      // scrollHeight. Keep this limited to the sizer; Core still owns row measurements and every
      // scroll transaction.
      applyContainerSize(instance);
      triggerRef(state);
      scheduleDomCommit();
    },
    { flush: "sync", immediate: true },
  );

  onScopeDispose(cleanup);

  function wrapOptions(
    nextOptions: VirtualizerOptions<TScrollElement, TItemElement>,
  ): VirtualizerOptions<TScrollElement, TItemElement> {
    return {
      ...nextOptions,
      onChange: (changedInstance, sync) => {
        applyDirectStyles(changedInstance);
        if (shouldRerender(changedInstance)) {
          triggerRef(state);
        }
        nextOptions.onChange?.(changedInstance, sync);
      },
    };
  }

  function shouldRerender(changedInstance: Virtualizer<TScrollElement, TItemElement>) {
    const range = changedInstance.range;
    const prev = directState.prevRange;
    const should =
      !prev ||
      prev.isScrolling !== changedInstance.isScrolling ||
      prev.startIndex !== range?.startIndex ||
      prev.endIndex !== range?.endIndex;
    if (should) {
      directState.prevRange = range
        ? {
            startIndex: range.startIndex,
            endIndex: range.endIndex,
            isScrolling: changedInstance.isScrolling,
          }
        : null;
    }
    return should;
  }

  function applyContainerSize(
    changedInstance: Virtualizer<TScrollElement, TItemElement> = instance,
  ) {
    const container = directState.container;
    if (!container) {
      return;
    }

    const totalSize = changedInstance.getTotalSize();
    if (totalSize !== directState.lastSize) {
      directState.lastSize = totalSize;
      const sizeAxis = changedInstance.options.horizontal ? "width" : "height";
      container.style[sizeAxis] = `${totalSize}px`;
    }
  }

  function applyDirectStyles(
    changedInstance: Virtualizer<TScrollElement, TItemElement> = instance,
  ) {
    const container = directState.container;
    if (!container) {
      return;
    }

    applyContainerSize(changedInstance);

    const horizontal = Boolean(changedInstance.options.horizontal);
    const positionAxis = horizontal ? "left" : "top";
    const scrollMargin = changedInstance.options.scrollMargin;
    const useTransform = directState.mode === "transform";

    for (const item of changedInstance.getVirtualItems()) {
      const element = changedInstance.elementsCache.get(item.key);
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      const next = item.start - scrollMargin;
      if (useTransform) {
        const transform = horizontal
          ? `translate3d(${next}px, 0, 0)`
          : `translate3d(0, ${next}px, 0)`;
        if (
          directState.lastPositions.get(element) === next &&
          element.style.transform === transform
        ) {
          continue;
        }
        directState.lastPositions.set(element, next);
        element.style.transform = transform;
      } else {
        const position = `${next}px`;
        if (
          directState.lastPositions.get(element) === next &&
          element.style[positionAxis] === position
        ) {
          continue;
        }
        directState.lastPositions.set(element, next);
        element.style[positionAxis] = `${next}px`;
      }
    }
  }

  function containerRef(refValue: Element | ComponentPublicInstance | null) {
    const element = refValue instanceof HTMLElement ? refValue : null;
    // Vue may invoke a function ref again for the same DOM node after every component patch.
    // Treat this as a binding callback, not a render notification: resetting the cache and
    // scheduling a commit for an unchanged node creates a render -> ref -> post-flush watcher ->
    // triggerRef feedback loop. Content and viewport changes are already owned by TanStack's
    // observers, so doing nothing here is intentional.
    if (directState.container === element) return;
    directState.container = element;
    directState.lastSize = null;
    if (element) {
      const totalSize = instance.getTotalSize();
      directState.lastSize = totalSize;
      const sizeAxis = instance.options.horizontal ? "width" : "height";
      element.style[sizeAxis] = `${totalSize}px`;

      // The official React direct-DOM adapter requires the size container to commit before Core's
      // scroll synchronization. Vue invokes descendant function refs before this ancestor ref, so
      // measuring those rows immediately would violate that requirement: WebKit clamps Core's end
      // correction against the old scrollHeight and leaves exactly one estimated row below the
      // viewport. Hold only the not-yet-registered DOM nodes until the sizer exists, then pass every
      // measurement straight to virtual-core. This is ref-order normalization, not a second anchor
      // or scroll policy; no offsets are captured and no scroll position is written here.
      for (const pendingElement of directState.pendingMeasurements) {
        instance.measureElement(pendingElement);
      }
      directState.pendingMeasurements.clear();
      scheduleDomCommit();
    }
  }

  function measureElement(element: TItemElement) {
    if (directState.container === null) {
      directState.pendingMeasurements.add(element);
      return;
    }
    instance.measureElement(element);
    applyDirectStyles();
  }

  function invalidateDirectStyles() {
    directState.lastPositions = new WeakMap<HTMLElement, number>();
    directState.lastSize = null;
  }

  function refresh(options: { forceStyles?: boolean; remeasure?: boolean } = {}) {
    if (options.forceStyles === true) {
      invalidateDirectStyles();
    }
    instance._willUpdate();
    if (options.remeasure !== false) instance.measure();
    applyDirectStyles();
    triggerRef(state);
  }

  return {
    containerRef,
    measureElement,
    refresh,
    virtualizer: state,
  };
}
