import { computed, ref } from "vue";
import { defineStore, skipHydrate } from "pinia";
import type {
  HostRecord,
  ModelRecord,
  ProjectDirectoryAvailability,
  ProjectRecord,
} from "~~/shared/types";
import type { HostConnectionStatus } from "@/stores/gateway/types";
import { createHostActions } from "@/stores/gateway/actions/hosts";
import { createProjectActions } from "@/stores/gateway/actions/projects";
import { useAccountLocalStorage } from "@/composables/storage/useAccountLocalStorage";

function modelKey(model: ModelRecord) {
  const id = model.id.trim();
  return id === "" ? model.model.trim() : id;
}

function isOpenAiModel(model: ModelRecord) {
  const provider = model.modelProvider?.trim().toLowerCase() ?? "";
  // Current Codex app-server model/list responses do not include a provider field. In that
  // payload shape the catalog is the selected app-server's OpenAI model catalog. If a newer
  // server provides the field, keep non-OpenAI providers outside this preference.
  return provider === "" || provider === "openai";
}

export const useGatewayCatalogStore = defineStore("gateway-catalog", () => {
  const hosts = ref<HostRecord[]>([]);
  const projects = ref<ProjectRecord[]>([]);
  const projectDirectoryAvailability = ref<Record<number, ProjectDirectoryAvailability>>({});
  const models = ref<ModelRecord[]>([]);
  const modelsHostId = ref<number | null>(null);
  const loadingModels = ref(false);
  const hiddenOpenAiModelIds = useAccountLocalStorage<string[]>("hidden-openai-models", []);
  const hostConnectionStatuses = ref<
    Record<number, { status: HostConnectionStatus; message?: string | null; updatedAt?: number }>
  >({});
  const openAiModels = computed(() => models.value.filter(isOpenAiModel));
  const hiddenOpenAiModelIdSet = computed(
    () => new Set(hiddenOpenAiModelIds.value.filter((value) => typeof value === "string")),
  );
  const visibleModels = computed(() =>
    models.value.filter(
      (model) => !isOpenAiModel(model) || !hiddenOpenAiModelIdSet.value.has(modelKey(model)),
    ),
  );
  const defaultModel = computed(
    () =>
      visibleModels.value.find((model) => model.isDefault === true) ??
      visibleModels.value[0] ??
      models.value.find((model) => model.isDefault === true) ??
      models.value[0] ??
      null,
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

  function isModelVisible(model: ModelRecord) {
    return !isOpenAiModel(model) || !hiddenOpenAiModelIdSet.value.has(modelKey(model));
  }

  function setModelVisibility(model: ModelRecord, visible: boolean) {
    if (!isOpenAiModel(model)) return;
    const key = modelKey(model);
    if (key === "") return;
    const hidden = new Set(hiddenOpenAiModelIds.value);
    if (visible) hidden.delete(key);
    else hidden.add(key);
    hiddenOpenAiModelIds.value = [...hidden].sort();
  }

  function resetModelVisibility() {
    hiddenOpenAiModelIds.value = [];
  }

  return {
    hosts,
    projects,
    projectDirectoryAvailability,
    models,
    modelsHostId,
    loadingModels,
    hiddenOpenAiModelIds: skipHydrate(hiddenOpenAiModelIds),
    openAiModels,
    visibleModels,
    hostConnectionStatuses,
    defaultModel,
    isModelVisible,
    setModelVisibility,
    resetModelVisibility,
    setHostConnectionStatus,
    resetState,
    ...createHostActions(),
    ...createProjectActions(),
  };
});
