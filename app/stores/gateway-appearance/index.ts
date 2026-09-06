import { defineStore, skipHydrate } from "pinia";
import { computed } from "vue";
import { useAccountLocalStorage } from "@/composables/storage/useAccountLocalStorage";

const CHAT_TEXT_SIZES = ["small", "default", "large", "larger", "largest"] as const;
const CHAT_TEXT_SIZE_SET: ReadonlySet<string> = new Set(CHAT_TEXT_SIZES);
const DEFAULT_CHAT_TEXT_SIZE = "default";
const COLORWAYS = ["green", "neutral", "blue", "violet", "amber"] as const;
const COLORWAY_SET: ReadonlySet<string> = new Set(COLORWAYS);
const DEFAULT_COLORWAY = "green";

type ChatTextSize = (typeof CHAT_TEXT_SIZES)[number];
export type GatewayColorway = (typeof COLORWAYS)[number];

export const GATEWAY_COLORWAY_OPTIONS: ReadonlyArray<{
  value: GatewayColorway;
  labelKey: string;
}> = [
  { value: "green", labelKey: "app.colorwayGreen" },
  { value: "neutral", labelKey: "app.colorwayNeutral" },
  { value: "blue", labelKey: "app.colorwayBlue" },
  { value: "violet", labelKey: "app.colorwayViolet" },
  { value: "amber", labelKey: "app.colorwayAmber" },
];

const CHAT_TEXT_FONT_SIZE: Record<ChatTextSize, string> = {
  small: "0.8125rem",
  default: "0.9375rem",
  large: "1.0625rem",
  larger: "1.1875rem",
  largest: "1.3125rem",
};

function isChatTextSize(value: string): value is ChatTextSize {
  return CHAT_TEXT_SIZE_SET.has(value);
}

function isGatewayColorway(value: string): value is GatewayColorway {
  return COLORWAY_SET.has(value);
}

export const useGatewayAppearanceStore = defineStore("gateway-appearance", () => {
  const chatTextSizePreference = useAccountLocalStorage<string>(
    "chat-text-size",
    DEFAULT_CHAT_TEXT_SIZE,
  );
  const colorwayPreference = useAccountLocalStorage<string>("colorway", DEFAULT_COLORWAY);
  const colorway = computed<GatewayColorway>(() =>
    isGatewayColorway(colorwayPreference.value) ? colorwayPreference.value : DEFAULT_COLORWAY,
  );
  const chatTextSize = computed<ChatTextSize>(() =>
    isChatTextSize(chatTextSizePreference.value)
      ? chatTextSizePreference.value
      : DEFAULT_CHAT_TEXT_SIZE,
  );
  const chatTextSizeIndex = computed(() => CHAT_TEXT_SIZES.indexOf(chatTextSize.value));
  const chatTextFontSize = computed(() => CHAT_TEXT_FONT_SIZE[chatTextSize.value]);
  const canDecreaseChatTextSize = computed(() => chatTextSizeIndex.value > 0);
  const canIncreaseChatTextSize = computed(
    () => chatTextSizeIndex.value < CHAT_TEXT_SIZES.length - 1,
  );

  function decreaseChatTextSize() {
    const next = CHAT_TEXT_SIZES[chatTextSizeIndex.value - 1];
    if (next) chatTextSizePreference.value = next;
  }

  function increaseChatTextSize() {
    const next = CHAT_TEXT_SIZES[chatTextSizeIndex.value + 1];
    if (next) chatTextSizePreference.value = next;
  }

  function setColorway(value: unknown) {
    if (typeof value === "string" && isGatewayColorway(value)) {
      colorwayPreference.value = value;
    }
  }

  return {
    chatTextSizePreference: skipHydrate(chatTextSizePreference),
    colorwayPreference: skipHydrate(colorwayPreference),
    colorway,
    chatTextSize,
    chatTextFontSize,
    canDecreaseChatTextSize,
    canIncreaseChatTextSize,
    decreaseChatTextSize,
    increaseChatTextSize,
    setColorway,
  };
});
