import { computed, ref } from "vue";
import { defineStore } from "pinia";
import type {
  HostRecord,
  ModelRecord,
  ProjectDirectoryAvailability,
  ProjectRecord,
} from "~~/shared/types";
import type { HostConnectionStatus } from "@/stores/gateway/types";
import { createHostActions } from "@/stores/gateway/actions/hosts";
import { createProjectActions } from "@/stores/gateway/actions/projects";

export const useGatewayCatalogStore = defineStore("gateway-catalog", () => {
  const hosts = ref<HostRecord[]>([]);
  const projects = ref<ProjectRecord[]>([]);
  const projectDirectoryAvailability = ref<Record<number, ProjectDirectoryAvailability>>({});
  const models = ref<ModelRecord[]>([]);
  const modelsHostId = ref<number | null>(null);
  const loadingModels = ref(false);
  const hostConnectionStatuses = ref<
    Record<number, { status: HostConnectionStatus; message?: string | null; updatedAt?: number }>
  >({});
  const defaultModel = computed(
    () => models.value.find((model) => model.isDefault === true) ?? models.value[0] ?? null,
  );

  function setHostConnectionStatus(
    hostId: number,
    status: HostConnectionStatus,
    message?: string | null,
  ) {
    hostConnectionStatuses.value = {
      ...hostConnectionStatuses.value,
      [hostId]: { status, message, updatedAt: Date.now() },
    };
  }

  function resetState() {
    hosts.value = [];
    projects.value = [];
    projectDirectoryAvailability.value = {};
    models.value = [];
    modelsHostId.value = null;
    loadingModels.value = false;
    hostConnectionStatuses.value = {};
  }

  return {
    hosts,
    projects,
    projectDirectoryAvailability,
    models,
    modelsHostId,
    loadingModels,
    hostConnectionStatuses,
    defaultModel,
    setHostConnectionStatus,
    resetState,
    ...createHostActions(),
    ...createProjectActions(),
  };
});
