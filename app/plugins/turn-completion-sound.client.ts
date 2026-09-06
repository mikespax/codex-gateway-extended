import { installTurnCompletionSoundUnlock } from "@/utils/turn-completion-sound";

export default defineNuxtPlugin(() => {
  if (useDevice().isMobileOrTablet) return;
  installTurnCompletionSoundUnlock();
});
