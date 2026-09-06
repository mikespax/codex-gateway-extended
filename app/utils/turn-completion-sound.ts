const COMPLETION_SOUND_PREFERENCE_KEY = "codex-gateway.desktop-completion-sound";
const COMPLETION_SOUND_TYPE_SUFFIX = "desktop-completion-sound-type";
const COMPLETION_SOUND_VOLUME_SUFFIX = "desktop-completion-sound-volume";
const AUTH_USERNAME_KEY = "codex-gateway-auth-token:username";
const MAX_PLAYED_NOTIFICATION_KEYS = 128;

export const MIN_TURN_COMPLETION_SOUND_VOLUME = 0;
export const MAX_TURN_COMPLETION_SOUND_VOLUME = 100;
export const DEFAULT_TURN_COMPLETION_SOUND_VOLUME = 50;
export const DEFAULT_TURN_COMPLETION_SOUND = "chime";

export const TURN_COMPLETION_SOUND_OPTIONS = [
  "chime",
  "pulse",
  "bell",
  "marimba",
  "signal",
] as const;
export type TurnCompletionSound = (typeof TURN_COMPLETION_SOUND_OPTIONS)[number];
export const TURN_COMPLETION_SOUND_VOLUME_PRESETS = [0, 25, 50, 75, 100] as const;

const TURN_COMPLETION_SOUND_SET: ReadonlySet<string> = new Set(TURN_COMPLETION_SOUND_OPTIONS);

let audioContext: AudioContext | null = null;
let unlockListenersInstalled = false;
const playedNotificationKeys = new Set<string>();

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function accountStorageKey(suffix: string) {
  if (!isBrowser()) return `codex-gateway:signed-out:${suffix}`;
  try {
    const username = window.localStorage.getItem(AUTH_USERNAME_KEY)?.trim() ?? "";
    const namespace = username === "" ? "signed-out" : encodeURIComponent(username);
    return `codex-gateway:${namespace}:${suffix}`;
  } catch {
    return `codex-gateway:signed-out:${suffix}`;
  }
}

function readPreference(suffix: string, fallback: string, legacyKey?: string) {
  if (!isBrowser()) return fallback;
  try {
    const accountValue = window.localStorage.getItem(accountStorageKey(suffix));
    if (accountValue !== null) return accountValue;
    if (legacyKey !== undefined) {
      const legacyValue = window.localStorage.getItem(legacyKey);
      if (legacyValue !== null) return legacyValue;
    }
  } catch {
    // A locked-down browser may deny local storage.
  }
  return fallback;
}

function writePreference(suffix: string, value: string) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(accountStorageKey(suffix), value);
  } catch {
    // A locked-down browser may deny local storage.
  }
}

function isTurnCompletionSound(value: string): value is TurnCompletionSound {
  return TURN_COMPLETION_SOUND_SET.has(value);
}

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_TURN_COMPLETION_SOUND_VOLUME;
  return Math.min(
    MAX_TURN_COMPLETION_SOUND_VOLUME,
    Math.max(MIN_TURN_COMPLETION_SOUND_VOLUME, Math.round(value)),
  );
}

function getAudioContext() {
  if (!isBrowser() || typeof window.AudioContext !== "function") return null;
  if (audioContext !== null) return audioContext;

  try {
    audioContext = new window.AudioContext();
  } catch {
    return null;
  }
  return audioContext;
}

export function isTurnCompletionSoundEnabled() {
  return readPreference("desktop-completion-sound", "1", COMPLETION_SOUND_PREFERENCE_KEY) !== "0";
}

export function setTurnCompletionSoundEnabled(enabled: boolean) {
  writePreference("desktop-completion-sound", enabled ? "1" : "0");
}

export function getTurnCompletionSound(): TurnCompletionSound {
  const value = readPreference(COMPLETION_SOUND_TYPE_SUFFIX, DEFAULT_TURN_COMPLETION_SOUND);
  return isTurnCompletionSound(value) ? value : DEFAULT_TURN_COMPLETION_SOUND;
}

export function setTurnCompletionSound(value: unknown) {
  if (typeof value === "string" && isTurnCompletionSound(value)) {
    writePreference(COMPLETION_SOUND_TYPE_SUFFIX, value);
  }
}

export function getTurnCompletionSoundVolume() {
  const stored = Number(
    readPreference(COMPLETION_SOUND_VOLUME_SUFFIX, String(DEFAULT_TURN_COMPLETION_SOUND_VOLUME)),
  );
  return clampVolume(stored);
}

export function setTurnCompletionSoundVolume(value: number) {
  writePreference(COMPLETION_SOUND_VOLUME_SUFFIX, String(clampVolume(value)));
}

/**
 * Prime the Web Audio context from a user gesture. Browsers reject audio started without a
 * gesture, so the listener is installed once when the desktop app boots and resumed on the first
 * click or key press.
 */
export function installTurnCompletionSoundUnlock() {
  if (!isBrowser() || unlockListenersInstalled) return;
  unlockListenersInstalled = true;

  const unlock = () => {
    void unlockTurnCompletionSound();
  };
  window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
  window.addEventListener("keydown", unlock, { capture: true, passive: true });
}

export async function unlockTurnCompletionSound() {
  const context = getAudioContext();
  if (context === null) return false;
  if (context.state === "running") return true;

  try {
    await context.resume();
    return true;
  } catch {
    return false;
  }
}

/** Plays the selected short sound and returns whether it was scheduled. */
export function playTurnCompletionSound(notificationKey: string) {
  if (
    !isBrowser() ||
    !isTurnCompletionSoundEnabled() ||
    playedNotificationKeys.has(notificationKey)
  ) {
    return false;
  }

  const context = audioContext;
  if (context === null || context.state !== "running") return false;

  const start = context.currentTime;
  const peakGain = 0.08 * (getTurnCompletionSoundVolume() / MAX_TURN_COMPLETION_SOUND_VOLUME);
  for (const tone of soundPattern(getTurnCompletionSound())) {
    scheduleTone(
      context,
      tone.frequency,
      start + tone.offset,
      tone.duration,
      tone.waveform,
      peakGain,
    );
  }
  playedNotificationKeys.add(notificationKey);
  if (playedNotificationKeys.size > MAX_PLAYED_NOTIFICATION_KEYS) {
    const oldest = playedNotificationKeys.values().next().value;
    if (oldest !== undefined) playedNotificationKeys.delete(oldest);
  }
  return true;
}

export async function testTurnCompletionSound() {
  if (!(await unlockTurnCompletionSound())) return false;
  return playTurnCompletionSound(`settings-test-${Date.now()}`);
}

type SoundTone = {
  frequency: number;
  offset: number;
  duration: number;
  waveform: OscillatorType;
};

function soundPattern(sound: TurnCompletionSound): SoundTone[] {
  switch (sound) {
    case "pulse":
      return [
        { frequency: 520, offset: 0, duration: 0.1, waveform: "square" },
        { frequency: 520, offset: 0.14, duration: 0.16, waveform: "square" },
      ];
    case "bell":
      return [
        { frequency: 523, offset: 0, duration: 0.16, waveform: "sine" },
        { frequency: 659, offset: 0.11, duration: 0.2, waveform: "sine" },
        { frequency: 784, offset: 0.22, duration: 0.3, waveform: "sine" },
      ];
    case "marimba":
      return [
        { frequency: 392, offset: 0, duration: 0.14, waveform: "triangle" },
        { frequency: 523, offset: 0.1, duration: 0.16, waveform: "triangle" },
        { frequency: 659, offset: 0.2, duration: 0.24, waveform: "triangle" },
      ];
    case "signal":
      return [
        { frequency: 740, offset: 0, duration: 0.08, waveform: "sawtooth" },
        { frequency: 587, offset: 0.11, duration: 0.08, waveform: "sawtooth" },
        { frequency: 740, offset: 0.22, duration: 0.18, waveform: "sawtooth" },
      ];
    case "chime":
    default:
      return [
        { frequency: 660, offset: 0, duration: 0.14, waveform: "sine" },
        { frequency: 880, offset: 0.12, duration: 0.24, waveform: "sine" },
      ];
  }
}

function scheduleTone(
  context: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  waveform: OscillatorType,
  peakGain: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = waveform;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakGain), start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
}
