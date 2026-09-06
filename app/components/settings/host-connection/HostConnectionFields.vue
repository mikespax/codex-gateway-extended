<script setup lang="ts">
import { Input } from "@codex-gateway/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@codex-gateway/ui/select";
import { Textarea } from "@codex-gateway/ui/textarea";
import type { HostConnectionFormValue } from "./form";

const model = defineModel<HostConnectionFormValue>({ required: true });
defineProps<{ create?: boolean }>();
const { t } = useI18n();
</script>

<template>
  <Input
    v-model="model.name"
    :data-testid="create ? 'host-name-input' : undefined"
    :aria-label="t('app.hostName')"
    :placeholder="t('app.hostName')"
  />
  <Input
    v-model="model.sshHost"
    :data-testid="create ? 'host-ssh-input' : undefined"
    :aria-label="t('app.sshHost')"
    :placeholder="t('app.sshHost')"
  />
  <div class="grid grid-cols-[minmax(0,1fr)_minmax(6rem,8rem)] gap-2">
    <Input v-model="model.username" :aria-label="t('app.user')" :placeholder="t('app.user')" />
    <Input
      v-model="model.port"
      :aria-label="t('app.port')"
      type="number"
      :placeholder="t('app.port')"
    />
  </div>
  <Input
    v-model="model.proxyUrl"
    :data-testid="create ? 'host-proxy-url-input' : undefined"
    :aria-label="t('app.sshProxy')"
    :placeholder="t('app.sshProxyPlaceholder')"
  />
  <Select v-model="model.authMode">
    <SelectTrigger
      :data-testid="create ? 'host-auth-select' : undefined"
      class="w-full bg-surface"
      :aria-label="t('app.auth')"
      ><SelectValue
    /></SelectTrigger>
    <SelectContent>
      <SelectItem value="agent">{{ t("app.sshAgent") }}</SelectItem>
      <SelectItem value="privateKey">{{ t("app.privateKeyPath") }}</SelectItem>
      <SelectItem
        :data-testid="create ? 'host-auth-password-option' : undefined"
        value="password"
        >{{ t("app.password") }}</SelectItem
      >
    </SelectContent>
  </Select>
  <Input
    v-if="model.authMode === 'privateKey'"
    v-model="model.privateKeyPath"
    :aria-label="t('app.privateKeyPath')"
    :placeholder="t('app.privateKeyPath')"
  />
  <Textarea
    v-if="model.authMode === 'privateKey'"
    v-model="model.privateKey"
    class="min-h-32 bg-surface font-mono text-sm"
    :aria-label="t('app.privateKey')"
    :placeholder="t('app.privateKey')"
  />
  <Input
    v-if="model.authMode === 'password'"
    v-model="model.password"
    :aria-label="t('app.password')"
    type="password"
    :placeholder="t('app.sshPassword')"
  />
</template>
