<script setup lang="ts">
import { BellIcon, BellRingIcon, Loader2Icon, Volume2Icon } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import type { GatewayNotificationSettings } from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import { Input } from "@codex-gateway/ui/input";
import { Label } from "@codex-gateway/ui/label";
import { Switch } from "@codex-gateway/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@codex-gateway/ui/select";
import { Slider } from "@codex-gateway/ui/slider";
import { useGatewayConfigStore } from "@/stores/gateway-config";
import { normalizeNotificationSettings } from "@/stores/gateway/config";
import { errorMessageLabels, messageFromError } from "@/stores/gateway/thread-utils/identity";
import {
  isTurnCompletionSoundEnabled,
  getTurnCompletionSound,
  getTurnCompletionSoundVolume,
  MAX_TURN_COMPLETION_SOUND_VOLUME,
  MIN_TURN_COMPLETION_SOUND_VOLUME,
  setTurnCompletionSound,
  setTurnCompletionSoundEnabled,
  setTurnCompletionSoundVolume,
  TURN_COMPLETION_SOUND_OPTIONS,
  TURN_COMPLETION_SOUND_VOLUME_PRESETS,
  type TurnCompletionSound,
  testTurnCompletionSound,
} from "@/utils/turn-completion-sound";
import {
  desktopNotificationPermission,
  isDesktopNotificationsEnabled,
  isDesktopNotificationsSupported,
  requestDesktopNotificationPermission,
  setDesktopNotificationsEnabled,
  testDesktopNotification,
} from "@/utils/desktop-notifications";

const store = useGatewayConfigStore();
const { t } = useI18n();
const errorLabels = computed(() => errorMessageLabels(t));
const saving = ref(false);
const error = ref("");
const form = ref<GatewayNotificationSettings>(normalizeNotificationSettings());
const completionSoundEnabled = ref(true);
const completionSound = ref<TurnCompletionSound>("chime");
const completionSoundVolume = ref(50);
const completionSoundReady = ref(false);
const desktopNotificationsSupported = ref(false);
const desktopNotificationsEnabled = ref(false);
const desktopNotificationPermissionState = ref<NotificationPermission | "unsupported">(
  "unsupported",
);
const desktopNotificationsReady = ref(false);
const device = useDevice();
const barkGroup = computed({
  get: () => form.value.bark.group ?? "",
  set: (value: string | number) => {
    form.value.bark.group = String(value).trim() || null;
  },
});

watch(
  () => store.gatewayConfig.notifications,
  (settings) => {
    form.value = normalizeNotificationSettings(settings);
  },
  { immediate: true, deep: true },
);

onMounted(() => {
  completionSoundEnabled.value = isTurnCompletionSoundEnabled();
  completionSound.value = getTurnCompletionSound();
  completionSoundVolume.value = getTurnCompletionSoundVolume();
  completionSoundReady.value = true;
  desktopNotificationsSupported.value = isDesktopNotificationsSupported();
  desktopNotificationsEnabled.value = isDesktopNotificationsEnabled();
  desktopNotificationPermissionState.value = desktopNotificationPermission();
  desktopNotificationsReady.value = true;
});

watch(completionSoundEnabled, (enabled) => {
  if (completionSoundReady.value) setTurnCompletionSoundEnabled(enabled);
});

function updateCompletionSound(value: unknown) {
  if (
    typeof value !== "string" ||
    !TURN_COMPLETION_SOUND_OPTIONS.includes(value as TurnCompletionSound)
  ) {
    return;
  }
  completionSound.value = value as TurnCompletionSound;
  if (completionSoundReady.value) setTurnCompletionSound(completionSound.value);
}

function setCompletionSoundVolume(value: number) {
  completionSoundVolume.value = value;
  if (completionSoundReady.value) setTurnCompletionSoundVolume(value);
}

const completionSoundVolumeSlider = computed({
  get: () => [completionSoundVolume.value],
  set: (value: number[]) => {
    const next = value[0];
    if (typeof next !== "number" || !Number.isFinite(next)) return;
    completionSoundVolume.value = Math.min(
      MAX_TURN_COMPLETION_SOUND_VOLUME,
      Math.max(MIN_TURN_COMPLETION_SOUND_VOLUME, Math.round(next)),
    );
    if (completionSoundReady.value) setTurnCompletionSoundVolume(completionSoundVolume.value);
  },
});

async function playTestSound() {
  if (!completionSoundEnabled.value) return;
  await testTurnCompletionSound();
}

async function enableDesktopNotifications() {
  const permission = await requestDesktopNotificationPermission();
  desktopNotificationPermissionState.value = permission;
  desktopNotificationsEnabled.value = permission === "granted";
}

async function playTestDesktopNotification() {
  if (!desktopNotificationsEnabled.value) return;
  await testDesktopNotification();
}

watch(desktopNotificationsEnabled, (enabled) => {
  if (desktopNotificationsReady.value) setDesktopNotificationsEnabled(enabled);
});

async function saveSettings() {
  error.value = "";
  saving.value = true;
  try {
    await store.saveNotificationSettings(form.value);
  } catch (caught: unknown) {
    error.value = messageFromError(
      caught,
      t("app.notificationSettingsSaveFailed"),
      errorLabels.value,
    );
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="max-w-2xl space-y-5">
    <div
      v-if="!device.isMobileOrTablet"
      data-testid="desktop-completion-sound-settings"
      class="rounded-xl border border-hairline bg-canvas-soft/70 p-4"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="flex min-w-0 items-start gap-2">
          <Volume2Icon class="mt-0.5 size-4 shrink-0 text-ink-muted" />
          <div>
            <Label for="desktop-completion-sound">{{ t("app.desktopCompletionSound") }}</Label>
            <p class="text-sm text-ink-secondary">
              {{ t("app.desktopCompletionSoundDescription") }}
            </p>
          </div>
        </div>
        <Switch
          id="desktop-completion-sound"
          v-model="completionSoundEnabled"
          :disabled="!completionSoundReady"
        />
      </div>
      <div class="mt-4 grid gap-4 border-t border-hairline pt-4">
        <div class="grid gap-2">
          <Label for="completion-sound-select">{{ t("app.completionSoundChoice") }}</Label>
          <p class="text-sm text-ink-secondary">
            {{ t("app.completionSoundChoiceDescription") }}
          </p>
          <Select
            :model-value="completionSound"
            data-testid="completion-sound-select"
            :disabled="!completionSoundReady"
            @update:model-value="updateCompletionSound"
          >
            <SelectTrigger id="completion-sound-select" class="h-10 w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="chime">{{ t("app.completionSoundChime") }}</SelectItem>
              <SelectItem value="pulse">{{ t("app.completionSoundPulse") }}</SelectItem>
              <SelectItem value="bell">{{ t("app.completionSoundBell") }}</SelectItem>
              <SelectItem value="marimba">{{ t("app.completionSoundMarimba") }}</SelectItem>
              <SelectItem value="signal">{{ t("app.completionSoundSignal") }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="grid gap-2">
          <div class="flex items-center justify-between gap-3">
            <Label for="completion-sound-volume">{{ t("app.completionSoundVolume") }}</Label>
            <span class="text-sm text-ink-secondary">
              {{ t("app.completionSoundVolumeValue", { volume: completionSoundVolume }) }}
            </span>
          </div>
          <Slider
            id="completion-sound-volume"
            v-model="completionSoundVolumeSlider"
            :min="MIN_TURN_COMPLETION_SOUND_VOLUME"
            :max="MAX_TURN_COMPLETION_SOUND_VOLUME"
            :step="1"
            :disabled="!completionSoundReady"
            data-testid="completion-sound-volume"
            :aria-label="t('app.completionSoundVolume')"
            :aria-valuetext="t('app.completionSoundVolumeValue', { volume: completionSoundVolume })"
          />
          <div class="flex items-center justify-between gap-2 text-xs text-ink-muted">
            <span>{{ t("app.completionSoundVolumeMin") }}</span>
            <span>{{ t("app.completionSoundVolumeMax") }}</span>
          </div>
          <div class="flex flex-wrap gap-1.5" :aria-label="t('app.completionSoundVolumePresets')">
            <Button
              v-for="preset in TURN_COMPLETION_SOUND_VOLUME_PRESETS"
              :key="preset"
              type="button"
              variant="outline"
              size="sm"
              class="h-7 px-2 text-xs"
              :class="
                completionSoundVolume === preset ? 'border-primary bg-primary/15 text-primary' : ''
              "
              :data-testid="`completion-sound-volume-preset-${preset}`"
              :aria-pressed="completionSoundVolume === preset"
              :disabled="!completionSoundReady"
              @click="setCompletionSoundVolume(preset)"
            >
              {{ t("app.completionSoundVolumePreset", { volume: preset }) }}
            </Button>
          </div>
        </div>
      </div>
      <div class="mt-3 flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          :disabled="!completionSoundReady || !completionSoundEnabled"
          @click="playTestSound"
        >
          <Volume2Icon class="size-4" />
          {{ t("app.testCompletionSound") }}
        </Button>
      </div>
    </div>

    <div
      v-if="!device.isMobileOrTablet"
      data-testid="desktop-notification-settings"
      class="rounded-xl border border-hairline bg-canvas-soft/70 p-4"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="flex min-w-0 items-start gap-2">
          <BellRingIcon class="mt-0.5 size-4 shrink-0 text-ink-muted" />
          <div>
            <Label for="desktop-notifications">{{ t("app.desktopNotifications") }}</Label>
            <p class="text-sm text-ink-secondary">
              {{ t("app.desktopNotificationsDescription") }}
            </p>
          </div>
        </div>
        <Switch
          id="desktop-notifications"
          v-model="desktopNotificationsEnabled"
          :disabled="
            !desktopNotificationsReady ||
            !desktopNotificationsSupported ||
            desktopNotificationPermissionState !== 'granted'
          "
        />
      </div>
      <div class="mt-3 flex flex-wrap items-center justify-end gap-2">
        <span v-if="desktopNotificationsSupported" class="text-xs text-ink-muted">
          {{
            t("app.desktopNotificationPermission", {
              permission: desktopNotificationPermissionState,
            })
          }}
        </span>
        <span v-else class="text-xs text-ink-muted">
          {{ t("app.desktopNotificationsUnsupported") }}
        </span>
        <Button
          v-if="desktopNotificationsSupported && desktopNotificationPermissionState !== 'granted'"
          type="button"
          variant="outline"
          size="sm"
          :disabled="!desktopNotificationsReady"
          @click="enableDesktopNotifications"
        >
          <BellRingIcon class="size-4" />
          {{ t("app.enableDesktopNotifications") }}
        </Button>
        <Button
          v-else-if="desktopNotificationsSupported"
          type="button"
          variant="outline"
          size="sm"
          :disabled="!desktopNotificationsReady || !desktopNotificationsEnabled"
          @click="playTestDesktopNotification"
        >
          <BellIcon class="size-4" />
          {{ t("app.testDesktopNotification") }}
        </Button>
      </div>
    </div>

    <div class="space-y-1">
      <div class="flex items-center gap-2 font-medium">
        <BellIcon class="size-4 text-ink-muted" />
        {{ t("app.barkNotifications") }}
      </div>
      <p class="text-sm text-ink-secondary">
        {{ t("app.barkNotificationsDescription") }}
      </p>
    </div>

    <div class="rounded-xl border border-hairline bg-canvas-soft/70 p-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <Label for="bark-enabled">{{ t("app.enableBark") }}</Label>
          <p class="text-sm text-ink-secondary">{{ t("app.enableBarkDescription") }}</p>
        </div>
        <Switch id="bark-enabled" v-model="form.bark.enabled" />
      </div>
    </div>

    <div class="grid gap-4">
      <div class="grid gap-2">
        <Label for="bark-server-url">{{ t("app.barkServerUrl") }}</Label>
        <Input
          id="bark-server-url"
          v-model="form.bark.serverUrl"
          autocomplete="off"
          inputmode="url"
          placeholder="https://api.day.app"
        />
      </div>
      <div class="grid gap-2">
        <Label for="bark-device-key">{{ t("app.barkDeviceKey") }}</Label>
        <Input
          id="bark-device-key"
          v-model="form.bark.deviceKey"
          autocomplete="off"
          type="password"
          :placeholder="t('app.barkDeviceKeyPlaceholder')"
        />
      </div>
      <div class="grid gap-2">
        <Label for="bark-group">{{ t("app.barkGroup") }}</Label>
        <Input
          id="bark-group"
          v-model="barkGroup"
          autocomplete="off"
          :placeholder="t('app.barkGroupPlaceholder')"
        />
      </div>
    </div>

    <div
      v-if="error"
      class="whitespace-pre-line rounded-md bg-destructive/10 p-3 text-sm text-destructive"
    >
      {{ error }}
    </div>

    <div class="flex justify-end">
      <Button :disabled="saving" @click="saveSettings">
        <Loader2Icon v-if="saving" class="size-4 animate-spin" />
        {{ t("app.saveNotificationSettings") }}
      </Button>
    </div>
  </div>
</template>
