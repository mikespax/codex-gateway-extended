import { memoryHousekeepingService } from "../utils/gateway/infra/background/memory-housekeeping";

export default defineNitroPlugin((nitroApp) => {
  memoryHousekeepingService.start();
  nitroApp.hooks.hook("close", () => {
    memoryHousekeepingService.stop();
  });
});
