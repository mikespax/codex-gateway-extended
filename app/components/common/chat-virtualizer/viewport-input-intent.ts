import { useEventListener, type Fn } from "@vueuse/core";

type ViewportInputIntentOptions = {
  getViewport: () => HTMLElement | null;
  onKeydown: (event: KeyboardEvent) => void;
  onPointerDown: (event: PointerEvent) => void;
  onScroll: (event: Event) => void;
  onTouchMove: (event: TouchEvent) => void;
  onTouchStart: (event: TouchEvent) => void;
  onWheel: (event: WheelEvent) => void;
  onBound?: (viewport: HTMLElement) => void;
};

export function createViewportInputIntent(options: ViewportInputIntentOptions) {
  let boundViewport: HTMLElement | null = null;
  let stopListeners: Fn[] = [];

  function bind() {
    const viewport = options.getViewport();
    if (!viewport || viewport === boundViewport) {
      return;
    }
    unbind();
    boundViewport = viewport;
    if (!viewport.hasAttribute("tabindex")) {
      viewport.tabIndex = 0;
    }
    options.onBound?.(viewport);
    stopListeners = [
      useEventListener(viewport, "scroll", options.onScroll, { passive: true }),
      useEventListener(viewport, "wheel", options.onWheel, { passive: true }),
      useEventListener(viewport, "touchstart", options.onTouchStart, { passive: true }),
      useEventListener(viewport, "touchmove", options.onTouchMove, { passive: true }),
      useEventListener(viewport, "keydown", options.onKeydown),
      useEventListener(viewport, "pointerdown", options.onPointerDown, { passive: true }),
    ];
  }

  function unbind() {
    if (!boundViewport) {
      return;
    }
    stopListeners.forEach((stop) => stop());
    stopListeners = [];
    boundViewport = null;
  }

  return {
    bind,
    unbind,
  };
}
