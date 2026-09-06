import type { ChartConfig } from ".";
import { isClient } from "@vueuse/core";
import { useId } from "reka-ui";
import { h, render, type Component } from "vue";
import { z } from "zod";

const unknownRecordSchema = z.looseObject({});

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  const result = unknownRecordSchema.safeParse(value);
  return result.success ? result.data : null;
}

// Simple cache using a Map to store serialized object keys
const cache = new Map<string, string>();

// Convert object to a consistent string key
function serializeKey(value: unknown): string {
  const record = recordFromUnknown(value);
  const serialized = JSON.stringify(value, record ? Object.keys(record).sort() : undefined);
  return serialized ?? Object.prototype.toString.call(value);
}

export function componentToString(
  config: ChartConfig,
  component: Component,
  props?: Record<string, unknown>,
) {
  if (!isClient) return;

  // This function will be called once during mount lifecycle
  const id = useId();

  // https://unovis.dev/docs/auxiliary/Crosshair#component-props
  return (_data: unknown, x: number | Date) => {
    const data = recordFromUnknown(_data)?.data ?? _data;
    const serializedKey = `${id}-${serializeKey(data)}`;
    const cachedContent = cache.get(serializedKey);
    if (cachedContent !== undefined) return cachedContent;

    const vnode = h<unknown>(component, { ...props, payload: data, config, x });
    const div = document.createElement("div");
    render(vnode, div);
    cache.set(serializedKey, div.innerHTML);
    return div.innerHTML;
  };
}
