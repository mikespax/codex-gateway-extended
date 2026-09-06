<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  HostRecord,
  ProjectRecord,
  ThreadMoveReadiness,
  ThreadMoveReadinessStatus,
} from "~~/shared/types";
import { Button } from "@codex-gateway/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@codex-gateway/ui/dialog";
import { Input } from "@codex-gateway/ui/input";
import { Label } from "@codex-gateway/ui/label";
import { gatewayApi } from "@/utils/gateway-api";
import { messageFromError } from "@/stores/gateway/thread-utils/identity";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@codex-gateway/ui/select";

const props = defineProps<{
  open: boolean;
  sourceHostId: number;
  sourceThreadId: string;
  sourceTitle: string;
  sourceCwd: string | null;
  hosts: HostRecord[];
  projects: ProjectRecord[];
  submitting: boolean;
  error?: string;
}>();

type ThreadMoveMode = "native";

const emit = defineEmits<{
  "update:open": [open: boolean];
  submit: [
    input: {
      mode: ThreadMoveMode;
      targetHostId: number;
      targetProjectId: number | null;
      targetCwd: string | null;
    },
  ];
}>();

const mode = ref<ThreadMoveMode>("native");
const targetHostId = ref<number | null>(null);
const targetProjectId = ref<number | null>(null);
const targetProjectChoice = ref<"custom" | "preset" | string>("custom");
const targetCwd = ref("");
const readiness = ref<ThreadMoveReadiness | null>(null);
const readinessLoading = ref(false);
const readinessError = ref("");
const preparing = ref(false);
const operationsFallbackAppliedKey = ref<string | null>(null);
const targetCwdEdited = ref(false);
let readinessRequestId = 0;
const targetHosts = computed(() => props.hosts.filter((host) => host.id !== props.sourceHostId));
const targetHost = computed(() => props.hosts.find((host) => host.id === targetHostId.value));
const targetProjects = computed(() =>
  props.projects.filter((project) => project.hostId === targetHostId.value),
);
const recommendedTargetPath = computed(() => presetPathForHost(targetHost.value, props.sourceCwd));
const targetProjectSelectValue = computed(() =>
  targetProjectId.value === null ? targetProjectChoice.value : String(targetProjectId.value),
);
const canSubmit = computed(
  () => !props.submitting && !readinessLoading.value && readiness.value?.status === "ready",
);
const canPrepare = computed(
  () =>
    !props.submitting &&
    !preparing.value &&
    !readinessLoading.value &&
    readiness.value?.status === "target_workspace_missing" &&
    targetHostId.value !== null &&
    targetCwd.value.trim().startsWith("/"),
);

const readinessMessageKey: Record<ThreadMoveReadinessStatus, string> = {
  ready: "app.moveThreadReadinessReady",
  source_workspace_missing: "app.moveThreadReadinessSourceWorkspaceMissing",
  target_workspace_missing: "app.moveThreadReadinessTargetWorkspaceMissing",
  source_not_git: "app.moveThreadReadinessSourceNotGit",
  target_not_git: "app.moveThreadReadinessTargetNotGit",
  repository_mismatch: "app.moveThreadReadinessRepositoryMismatch",
  source_commit_missing_on_target: "app.moveThreadReadinessSourceCommitMissing",
};

const { t } = useI18n();
const readinessMessage = computed(() =>
  readiness.value === null
    ? ""
    : t(
        readiness.value.status === "ready" && mode.value === "native"
          ? "app.moveThreadNativeReadinessReady"
          : readinessMessageKey[readiness.value.status],
      ),
);
const operationsFallbackMessage = computed(() => {
  const fallback = readiness.value;
  if (fallback?.sourceWorkspaceKind !== "operations_fallback") return "";
  return t("app.moveThreadReadinessOperationsFallback", {
    source: fallback.sourceWorkspaceCwd,
    target: fallback.recommendedTargetCwd ?? t("app.moveThreadReadinessTargetHostPath"),
  });
});

watch(
  () => props.open,
  (open) => {
    if (open) reset();
    else clearReadiness();
  },
);

watch(targetHostId, () => {
  operationsFallbackAppliedKey.value = null;
  targetCwdEdited.value = false;
  configureTarget();
});

watch([targetHostId, targetProjectId, targetCwd, () => props.sourceThreadId], () => {
  void refreshReadiness();
});

function selectProject(value: unknown) {
  targetCwdEdited.value = true;
  if (typeof value !== "string" || value === "custom") {
    targetProjectId.value = null;
    targetProjectChoice.value = "custom";
    if (targetCwd.value.trim() === "") targetCwd.value = props.sourceCwd ?? "";
    return;
  }

  if (value === "preset") {
    targetProjectId.value = null;
    targetProjectChoice.value = "preset";
    targetCwd.value = recommendedTargetPath.value ?? props.sourceCwd ?? "";
    return;
  }

  const projectId = Number(value);
  if (!Number.isInteger(projectId)) return;
  targetProjectId.value = projectId;
  targetProjectChoice.value = value;
  const project = targetProjects.value.find((candidate) => candidate.id === projectId);
  if (project !== undefined) targetCwd.value = project.remotePath;
}

function markTargetCwdEdited() {
  targetCwdEdited.value = true;
}

function reset() {
  mode.value = "native";
  const firstHost = targetHosts.value[0];
  targetHostId.value = firstHost?.id ?? null;
  configureTarget(firstHost);
}

function configureTarget(host = targetHost.value) {
  const presetPath = presetPathForHost(host, props.sourceCwd);
  if (presetPath !== null) {
    const presetProject = props.projects.find(
      (project) => project.hostId === host?.id && project.remotePath === presetPath,
    );
    targetProjectId.value = presetProject?.id ?? null;
    targetProjectChoice.value = presetProject === undefined ? "preset" : String(presetProject.id);
    targetCwd.value = presetPath;
    return;
  }
  const firstProject = host
    ? props.projects.find((project) => project.hostId === host.id)
    : undefined;
  if (firstProject !== undefined) {
    targetProjectId.value = firstProject.id;
    targetProjectChoice.value = String(firstProject.id);
    targetCwd.value = firstProject.remotePath;
    return;
  }

  targetProjectId.value = null;
  targetProjectChoice.value = presetPath === null ? "custom" : "preset";
  targetCwd.value = presetPath ?? props.sourceCwd ?? "";
}

function presetPathForHost(host: HostRecord | undefined, sourceCwd: string | null): string | null {
  if (host === undefined) return null;
  const name = host.name
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  if (isOperationsWorkspace(sourceCwd)) {
    if (name.includes("lenovo")) return "/root/stickerlight-ops";
    if (name.includes("mac")) return "/Users/Sparks/stickerlight-ops";
  }
  const workspaceName = sourceWorkspaceName(sourceCwd);
  if (name.includes("lenovo")) return `/root/workspaces/${workspaceName}`;
  if (name.includes("mac")) return `/Users/Sparks/workspaces/${workspaceName}`;
  if (name.includes("vps") || name.includes("contabo")) return "/root";
  return null;
}

function isOperationsWorkspace(sourceCwd: string | null) {
  const normalized = sourceCwd?.trim().replace(/\/+$/, "") || "/";
  return (
    normalized === "/" ||
    normalized === "/root" ||
    normalized === "/tmp" ||
    normalized === "/var/tmp" ||
    normalized === "/root/stickerlight-ops"
  );
}

function sourceWorkspaceName(sourceCwd: string | null) {
  const basename = sourceCwd?.split("/").filter(Boolean).at(-1) ?? "conversation";
  const safeName = basename
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^\.+/, "")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return safeName === "" ? "conversation" : safeName;
}

function submit() {
  if (!canSubmit.value || targetHostId.value === null) return;
  emit("submit", {
    mode: mode.value,
    targetHostId: targetHostId.value,
    targetProjectId: targetProjectId.value,
    targetCwd: targetCwd.value.trim() || null,
  });
}

function clearReadiness() {
  readinessRequestId += 1;
  readiness.value = null;
  readinessLoading.value = false;
  readinessError.value = "";
  preparing.value = false;
}

async function refreshReadiness() {
  const hostId = targetHostId.value;
  const cwd = targetCwd.value.trim();
  if (!props.open || hostId === null || cwd === "" || !cwd.startsWith("/")) {
    clearReadiness();
    return;
  }

  const requestId = ++readinessRequestId;
  readiness.value = null;
  readinessError.value = "";
  readinessLoading.value = true;
  try {
    const params = new URLSearchParams({
      sourceHostId: String(props.sourceHostId),
      sourceThreadId: props.sourceThreadId,
      targetHostId: String(hostId),
      targetCwd: cwd,
    });
    const result = await gatewayApi<ThreadMoveReadiness>(
      `/api/threads/move/readiness?${params.toString()}`,
    );
    if (requestId === readinessRequestId) {
      readiness.value = result;
      applyOperationsFallbackTarget(result, hostId);
    }
  } catch (error: unknown) {
    if (requestId === readinessRequestId) {
      readinessError.value = messageFromError(error, t("app.moveThreadReadinessFailed"));
    }
  } finally {
    if (requestId === readinessRequestId) readinessLoading.value = false;
  }
}

function applyOperationsFallbackTarget(result: ThreadMoveReadiness, hostId: number) {
  const recommended = result.recommendedTargetCwd?.trim();
  if (
    result.sourceWorkspaceKind !== "operations_fallback" ||
    recommended === undefined ||
    recommended === "" ||
    targetCwdEdited.value ||
    targetCwd.value.trim() === recommended
  ) {
    return;
  }
  const applicationKey = `${hostId}:${recommended}`;
  if (operationsFallbackAppliedKey.value === applicationKey) return;
  operationsFallbackAppliedKey.value = applicationKey;
  targetProjectId.value = null;
  targetProjectChoice.value = "preset";
  targetCwd.value = recommended;
}

async function prepareWorkspace() {
  const hostId = targetHostId.value;
  const cwd = targetCwd.value.trim();
  if (!canPrepare.value || hostId === null || !cwd.startsWith("/")) return;
  preparing.value = true;
  readinessError.value = "";
  try {
    await gatewayApi<ThreadMoveReadiness>("/api/threads/move/prepare-workspace", {
      method: "POST",
      body: {
        sourceHostId: props.sourceHostId,
        sourceThreadId: props.sourceThreadId,
        targetHostId: hostId,
        targetCwd: cwd,
      },
    });
    await refreshReadiness();
  } catch (error: unknown) {
    readinessError.value = messageFromError(error, t("app.moveThreadPrepareFailed"));
  } finally {
    preparing.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent data-testid="move-thread-dialog" class="sm:max-w-lg">
      <form class="grid gap-4" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>{{ $t("app.moveThreadTitle") }}</DialogTitle>
          <DialogDescription>
            {{ $t("app.moveThreadNativeDescription", { title: sourceTitle }) }}
          </DialogDescription>
        </DialogHeader>

        <div class="grid gap-2">
          <Label for="move-thread-host">{{ $t("app.moveThreadTargetHost") }}</Label>
          <Select
            :model-value="targetHostId === null ? undefined : String(targetHostId)"
            :disabled="submitting || preparing || targetHosts.length === 0"
            @update:model-value="targetHostId = Number($event)"
          >
            <SelectTrigger id="move-thread-host" data-testid="move-thread-host" class="w-full">
              <SelectValue :placeholder="$t('app.moveThreadTargetHost')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="host in targetHosts" :key="host.id" :value="String(host.id)">
                {{ host.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p v-if="targetHosts.length === 0" class="text-xs text-destructive">
            {{ $t("app.moveThreadNoTargets") }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="move-thread-project">{{ $t("app.moveThreadTargetProject") }}</Label>
          <Select
            :model-value="targetProjectSelectValue"
            :disabled="submitting || preparing || targetHostId === null"
            @update:model-value="selectProject($event)"
          >
            <SelectTrigger
              id="move-thread-project"
              data-testid="move-thread-project"
              class="w-full"
            >
              <SelectValue :placeholder="$t('app.moveThreadTargetProject')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-if="targetProjects.length === 0 && recommendedTargetPath !== null"
                value="preset"
              >
                Recommended — {{ recommendedTargetPath }}
              </SelectItem>
              <SelectItem value="custom">{{ $t("app.moveThreadCustomPath") }}</SelectItem>
              <SelectItem
                v-for="project in targetProjects"
                :key="project.id"
                :value="String(project.id)"
              >
                {{ project.name }} — {{ project.remotePath }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p
            v-if="
              targetHostId !== null && targetProjects.length === 0 && recommendedTargetPath === null
            "
            class="text-xs text-ink-muted"
          >
            {{ $t("app.moveThreadNoProjects") }}
          </p>
        </div>

        <div class="grid gap-2">
          <Label for="move-thread-cwd">{{ $t("app.moveThreadTargetPath") }}</Label>
          <Input
            id="move-thread-cwd"
            v-model="targetCwd"
            data-testid="move-thread-cwd"
            :disabled="submitting || preparing"
            :placeholder="$t('app.moveThreadTargetPathPlaceholder')"
            @update:model-value="markTargetCwdEdited"
          />
          <p class="text-xs leading-5 text-warning">
            {{ $t("app.moveThreadNativeWarning") }}
          </p>
        </div>

        <div
          data-testid="move-thread-readiness"
          class="rounded-md border border-hairline bg-surface/60 p-3 text-sm"
        >
          <p v-if="readinessLoading" class="text-ink-muted">
            {{ $t("app.moveThreadReadinessChecking") }}
          </p>
          <p v-else-if="readinessError" class="whitespace-pre-line text-destructive">
            {{ readinessError }}
          </p>
          <p
            v-else-if="readiness !== null"
            :class="readiness.status === 'ready' ? 'text-success' : 'text-destructive'"
          >
            <span
              v-if="operationsFallbackMessage"
              class="mb-2 block text-ink-muted"
              data-testid="move-thread-operations-fallback"
            >
              {{ operationsFallbackMessage }}
            </span>
            {{ readinessMessage }}
          </p>
          <p v-else class="text-ink-muted">
            {{ $t("app.moveThreadReadinessRequired") }}
          </p>
          <Button
            v-if="canPrepare"
            type="button"
            class="mt-3"
            data-testid="move-thread-prepare"
            :disabled="preparing"
            @click="prepareWorkspace"
          >
            {{ $t("app.moveThreadPrepareWorkspace") }}
          </Button>
        </div>

        <div
          v-if="error"
          class="whitespace-pre-line rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          {{ error }}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="submitting || preparing"
            @click="emit('update:open', false)"
          >
            {{ $t("app.cancel") }}
          </Button>
          <Button type="submit" data-testid="move-thread-submit" :disabled="!canSubmit">
            {{ $t("app.moveThreadNativeAction") }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
