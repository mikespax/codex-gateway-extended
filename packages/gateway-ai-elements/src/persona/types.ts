import type { EventCallback } from "@rive-app/webgl2";

export type PersonaState = "idle" | "listening" | "thinking" | "speaking" | "asleep";

export type PersonaVariant = "command" | "glint" | "halo" | "mana" | "obsidian" | "opal";

export interface PersonaProps {
  state?: PersonaState;
  class?: string;
  variant?: PersonaVariant;
}

export interface PersonaEmits {
  (event: "load"): void;
  (event: "loadError", error: Parameters<EventCallback>[0]): void;
  (event: "ready"): void;
  (event: "pause", riveEvent: Parameters<EventCallback>[0]): void;
  (event: "play", riveEvent: Parameters<EventCallback>[0]): void;
  (event: "stop", riveEvent: Parameters<EventCallback>[0]): void;
}
