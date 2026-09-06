import type { InjectionKey, Ref } from "vue";

/**
 * Semantic layout commits from an optional parent workspace. The virtualizer remains usable
 * outside Dockview; a host that changes panel geometry can provide this revision without exposing
 * its complete panel API to the timeline.
 */
export const CHAT_VIEWPORT_LAYOUT_REVISION: InjectionKey<Ref<number>> = Symbol(
  "chat-viewport-layout-revision",
);
