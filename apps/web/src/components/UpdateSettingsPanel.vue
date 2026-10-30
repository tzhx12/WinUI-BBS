<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ToggleSwitch } from 'winuionweb'
import { api } from '../api'
import { useResource } from '../composables/useResource'
import { useSite } from '../site'
import ResourceState from './ui/ResourceState.vue'
import WinButton from './ui/WinButton.vue'
import WinSelect from './ui/WinSelect.vue'

type Settings = { automatic: boolean; channel: 'releases' | 'pre-releases' }
type Job = { id?: string; state: string; message: string; version?: string; updatedAt?: string }
type Status = { currentVersion: string; managed: boolean; settings: Settings; job: Job | null }
type Check = {
  available: boolean
  checkedAt: string
  latest: { version: string; url: string; notes: string } | null
}
const site = useSite()
const { data, loading, saving, error, run } = useResource(
  () => api<Status>('/api/admin/updates', { token: site.token.value }),
  null as Status | null,
)
const checked = ref<Check | null>(null)
const pending = ref(false)
const busy = computed(
  () => saving.value || pending.value || ['checking', 'installing'].includes(data.value?.job?.state || ''),
)
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
onUnmounted(() => {
  disposed = true
  clearTimeout(timer)
})
watch(data, (status) => {
  if (['checking', 'installing'].includes(status?.job?.state || '') && !pending.value) {
    pending.value = true
    requestId = status?.job?.id
    timer = setTimeout(poll, 1000)
  }
})
async function save() {
  if (
    await run(
      () =>
        api('/api/admin/updates', { method: 'PATCH', token: site.token.value, body: data.value!.settings }),
      '更新设置已保存',
    )
  )
    checked.value = null
}
async function check() {
  await run(async () => {
    checked.value = null
    await api('/api/admin/updates', { method: 'PATCH', token: site.token.value, body: data.value!.settings })
    checked.value = await api<Check>('/api/admin/updates/check', { method: 'POST', token: site.token.value })
  })
}
async function poll() {
  if (disposed) return
  try {
    const status = await api<Status>('/api/admin/updates', { token: site.token.value })
    data.value = status
    if (
      status.job &&
      status.job.id === requestId &&
      ['complete', 'failed', 'current'].includes(status.job.state)
    ) {
      pending.value = false
      checked.value = null
      return
    }
  } catch {
    /* The application restarts during installation. */
  }
  if (!disposed) timer = setTimeout(poll, 5000)
}
let requestId: string | undefined
async function install() {
  await run(async () => {
    const queued = await api<{ id: string }>('/api/admin/updates/install', {
      method: 'POST',
      token: site.token.value,
    })
    requestId = queued.id
    pending.value = true
    timer = setTimeout(poll, 1000)
  }, '更新已提交，站点将在安装时短暂重启')
}
</script>

<template>
  <section class="surface-card form-stack update-settings">
    <div class="setting-row update-heading">
      <div>
        <h2>系统更新</h2>
        <p v-if="data" class="secondary-text">当前版本 {{ data.currentVersion }}</p>
      </div>
      <WinButton
        :label="saving ? '正在处理…' : '检查更新'"
        :disabled="loading || busy || !data"
        @click="check"
      />
    </div>
    <ResourceState :loading="loading" :error="error" />
    <template v-if="data">
      <WinSelect
        v-model="data.settings.channel"
        label="更新渠道"
        :disabled="busy"
        :options="[
          { value: 'releases', label: 'Releases（正式版）' },
          { value: 'pre-releases', label: 'Pre-releases（预发布版）' },
        ]"
        @update:model-value="checked = null"
      />
      <p class="field-hint">预发布渠道包含正式版和 RC 版本，可能存在尚未修复的问题。</p>
      <div class="setting-row">
        <div>
          <h3>自动更新</h3>
          <p class="secondary-text">每小时检查所选渠道，有新版本时自动安装并重启。</p>
        </div>
        <ToggleSwitch
          v-model:IsOn="data.settings.automatic"
          :IsEnabled="data.managed && !busy"
          aria-label="自动更新"
          OnContent="开"
          OffContent="关"
        />
      </div>
      <p v-if="!data.managed" class="field-hint">使用一键安装部署后，可在此启用自动更新。</p>
      <div v-if="checked" class="update-result" role="status">
        <strong>{{
          checked.available
            ? `发现新版本 ${checked.latest!.version}`
            : checked.latest
              ? '已是所选渠道的最新版本'
              : '所选渠道暂未发布可安装版本'
        }}</strong>
        <div v-if="checked.latest" class="row-actions">
          <a :href="checked.latest.url" target="_blank" rel="noopener noreferrer">查看发布说明</a
          ><WinButton
            v-if="checked.available && data.managed"
            label="立即更新"
            accent
            :disabled="busy"
            @click="install"
          />
        </div>
      </div>
      <p v-if="pending || data.job" role="status" :class="{ 'error-text': data.job?.state === 'failed' }">
        {{ data.job?.message || '等待更新服务处理…' }}
      </p>
      <div class="row-actions"><WinButton label="保存更新设置" :disabled="busy" @click="save" /></div>
    </template>
  </section>
</template>

<style scoped>
.update-heading {
  align-items: start;
  gap: 16px;
}
.update-heading h2 {
  margin-bottom: 8px;
}
.update-heading p {
  margin: 0;
}
.update-result {
  display: grid;
  gap: 12px;
  padding: 16px 0;
  border-top: 1px solid var(--card-stroke);
}
.update-settings p,
.update-settings strong {
  overflow-wrap: anywhere;
}
.update-settings .setting-row > div {
  min-width: 0;
}
.error-text {
  color: var(--error-color, #c42b1c);
}
@media (max-width: 480px) {
  .update-heading {
    flex-wrap: wrap;
  }
}
</style>
