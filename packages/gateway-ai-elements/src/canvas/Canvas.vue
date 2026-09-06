<script setup lang="ts">
import type { FlowProps, FlowSlots } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { VueFlow } from "@vue-flow/core";
import { computed, useAttrs } from "vue";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

const props = withDefaults(defineProps<FlowProps>(), {
  deleteKeyCode: () => ["Backspace", "Delete"],
  fitViewOnInit: true,
  panOnDrag: false,
  panOnScroll: true,
  selectNodesOnDrag: true,
  zoomOnDoubleClick: false,
});

const slots = defineSlots<FlowSlots>();
const attrs = useAttrs();

// Vue Flow exposes a very large overloaded event surface. Passing that overload set through
// Reka's generic emit mapper exceeds TypeScript 6's instantiation depth. Undeclared listeners are
// native Vue fallthrough attrs, so forwarding props and attrs preserves the wrapper semantics
// without weakening types or duplicating every Vue Flow event.
const forwarded = computed(() => ({ ...props, ...attrs }));
</script>

<template>
  <VueFlow data-slot="canvas" v-bind="forwarded">
    <Background />

    <template v-if="slots['connection-line']" #connection-line="connectionLineProps">
      <slot name="connection-line" v-bind="connectionLineProps" />
    </template>

    <template v-if="slots['zoom-pane']" #zoom-pane>
      <slot name="zoom-pane" />
    </template>

    <slot />
  </VueFlow>
</template>
