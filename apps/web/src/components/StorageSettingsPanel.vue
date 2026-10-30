<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { NumberBox, PasswordBox, TextBox, ToggleSwitch } from 'winuionweb'
import { api } from '../api'
import { useSite } from '../site'
import { useResource } from '../composables/useResource'
import type { StorageOverview } from '../types/admin'
import { formatBytes } from '../utils'
import ResourceState from './ui/ResourceState.vue'
import WinButton from './ui/WinButton.vue'
import WinSelect from './ui/WinSelect.vue'

const site = useSite()
const { data, loading, error, saving, run, reload } = useResource(
  () => api<StorageOverview>('/api/admin/storage', { token: site.token.value }),
  null as StorageOverview | null,
)
const testing = ref(false),
  checked = ref('')
const gib = 1024 ** 3,
  mib = 1024 ** 2
const localLimit = computed({
  get: () => (data.value?.settings.localMaxBytes || 0) / gib,
  set: (value) => {
    if (data.value) data.value.settings.localMaxBytes = Math.round(value * gib)
  },
})
const objectLimit = computed({
  get: () => (data.value?.settings.s3.capacityBytes || 0) / gib,
  set: (value) => {
    if (data.value) data.value.settings.s3.capacityBytes = Math.round(value * gib)
  },
})
const recycleSize = computed({
  get: () => (data.value?.settings.recycleBytes || 0) / mib,
  set: (value) => {
    if (data.value) data.value.settings.recycleBytes = Math.round(value * mib)
  },
})
const capacities = computed(() =>
  data.value ? [data.value.status.local, ...(data.value.status.s3 ? [data.value.status.s3] : [])] : [],
)
const clamped = (value: number) => Math.min(100, Math.max(0, value))
async function refreshStatus() {
  await run(async () => {
    const fresh = await api<StorageOverview>('/api/admin/storage', { token: site.token.value })
    if (data.value) data.value.status = fresh.status
  })
}
async function save() {
  checked.value = ''
  if (
    await run(
      () =>
        api('/api/admin/storage', { method: 'PATCH', token: site.token.value, body: data.value!.settings }),
      '存储设置已保存',
    )
  )
    await reload()
}
async function testConnection() {
  testing.value = true
  checked.value = ''
  try {
    if (
      await run(() =>
        api('/api/admin/storage/test', {
          method: 'POST',
          token: site.token.value,
          body: data.value!.settings,
        }),
      )
    )
      checked.value = '连接正常，已验证上传、读取和删除。'
  } finally {
    testing.value = false
  }
}
let refreshing = false
const timer = setInterval(async () => {
  if (!data.value || loading.value || saving.value || refreshing || document.hidden) return
  refreshing = true
  try {
    await refreshStatus()
  } finally {
    refreshing = false
  }
}, 60000)
onUnmounted(() => clearInterval(timer))
</script>
<template>
  <div class="storage-settings">
    <ResourceState :loading="loading" :error="error" />
    <template v-if="data">
      <section class="surface-card storage-summary">
        <div class="section-toolbar">
          <div>
            <h2>存储容量</h2>
            <p class="secondary-text">本站剩余可用容量</p>
          </div>
          <WinButton label="刷新容量" icon="refresh" :disabled="saving" @click="refreshStatus" />
        </div>
        <strong class="storage-total">{{ formatBytes(data.status.totalFreeBytes) }}</strong>
        <div class="storage-capacities">
          <div v-for="capacity in capacities" :key="capacity.backend" class="storage-capacity">
            <div class="storage-capacity-heading">
              <strong>{{ capacity.backend === 'local' ? '本地存储' : '对象存储' }}</strong
              ><span :class="['secondary-text', { 'storage-warning': capacity.percent >= 95 }]"
                >{{ Math.min(100, capacity.percent).toFixed(1) }}% 已用</span
              >
            </div>
            <progress
              :value="clamped(capacity.percent)"
              max="100"
              :aria-label="`${capacity.backend === 'local' ? '本地' : '对象'}存储使用率`"
              :class="{ 'storage-warning': capacity.percent >= 95 }"
            />
            <div class="storage-capacity-heading">
              <span>剩余 {{ formatBytes(capacity.freeBytes) }}</span
              ><small class="secondary-text"
                >本站已用 {{ formatBytes(capacity.usedBytes) }} /
                {{ formatBytes(capacity.capacityBytes) }}</small
              >
            </div>
          </div>
        </div>
        <details class="storage-disks">
          <summary>服务器磁盘 · 共剩余 {{ formatBytes(data.status.serverFreeBytes) }}</summary>
          <div v-for="disk in data.status.disks" :key="disk.name" class="storage-disk">
            <div class="storage-capacity-heading">
              <strong
                >{{ disk.name }}
                <small v-if="disk.uploadDisk" class="secondary-text">图片存储所在磁盘</small></strong
              ><span>剩余 {{ formatBytes(disk.freeBytes) }} / {{ formatBytes(disk.totalBytes) }}</span>
            </div>
            <progress
              :value="clamped((1 - disk.freeBytes / disk.totalBytes) * 100)"
              max="100"
              :aria-label="`${disk.name} 磁盘使用率`"
            />
          </div>
        </details>
      </section>
      <section class="surface-card form-stack">
        <h2>存储策略</h2>
        <div class="limits-grid">
          <NumberBox
            v-model:Value="localLimit"
            Header="本地最大容量 (GiB)"
            AutomationProperties.Name="本地最大容量 (GiB)"
            :Minimum="0"
            :Maximum="1000000"
            SpinButtonPlacementMode="Inline"
          />
          <WinSelect
            v-model="data.settings.preference"
            label="优先使用"
            :options="[
              { value: 'local', label: '本地存储' },
              { value: 's3', label: '对象存储' },
            ]"
          />
          <NumberBox
            v-model:Value="recycleSize"
            Header="每次回收空间 (MiB)"
            AutomationProperties.Name="每次回收空间 (MiB)"
            :Minimum="1"
            :Maximum="1048576"
            SpinButtonPlacementMode="Inline"
          />
        </div>
        <p class="secondary-text">
          本地容量设为 0 时使用所在磁盘的可用空间。优先存储空间不足时自动切换到另一处存储。
        </p>
        <p class="secondary-text">
          全部存储都满后，继续上传会从最早的普通图片开始回收，每批至少释放设定容量；可回收图片不足时释放剩余可回收空间。表情包、头像和站点图标始终保留。
        </p>
        <p class="secondary-text">
          未启用对象存储时，本地存储或所在磁盘使用率达到 95% 会发站内信；对象存储配额达到 95%
          也会提醒拥有图床管理权限的管理员。
        </p>
      </section>
      <section class="surface-card form-stack">
        <h2>兼容 S3 的对象存储</h2>
        <ToggleSwitch
          v-model:IsOn="data!.settings.s3.enabled"
          Header="启用对象存储"
          OnContent="已启用"
          OffContent="未启用"
        />
        <div class="form-grid">
          <TextBox
            v-model:Text="data!.settings.s3.endpoint"
            Header="S3 API 端点"
            aria-label="S3 API 端点"
            PlaceholderText="https://…r2.cloudflarestorage.com"
          />
          <TextBox v-model:Text="data!.settings.s3.bucket" Header="Bucket 名称" aria-label="Bucket 名称" />
          <TextBox
            v-model:Text="data!.settings.s3.region"
            Header="区域"
            aria-label="区域"
            PlaceholderText="auto"
          />
          <TextBox v-model:Text="data!.settings.s3.prefix" Header="对象路径前缀" aria-label="对象路径前缀" />
          <PasswordBox
            v-model:Password="data!.settings.s3.accessKeyId"
            Header="Access Key ID"
            aria-label="Access Key ID"
            :PlaceholderText="data!.settings.s3.hasCredentials ? '已保存，留空保留' : '输入 Access Key ID'"
            autocomplete="new-password"
          />
          <PasswordBox
            v-model:Password="data!.settings.s3.secretAccessKey"
            Header="Secret Access Key"
            aria-label="Secret Access Key"
            :PlaceholderText="
              data!.settings.s3.hasCredentials ? '已保存，留空保留' : '输入 Secret Access Key'
            "
            autocomplete="new-password"
          />
          <NumberBox
            v-model:Value="objectLimit"
            Header="本站对象存储配额 (GiB)"
            AutomationProperties.Name="本站对象存储配额 (GiB)"
            :Minimum="0"
            :Maximum="1000000"
            SpinButtonPlacementMode="Inline"
          />
        </div>
        <p class="secondary-text">
          填写为本站分配的配额。容量统计包含本站上传文件；其他应用或手动上传到存储桶的文件不计入此配额。
        </p>
        <ToggleSwitch
          v-model:IsOn="data!.settings.s3.forcePathStyle"
          Header="使用路径式寻址"
          OnContent="路径式"
          OffContent="虚拟主机式"
        />
        <div class="form-actions">
          <WinButton label="测试对象存储连接" :disabled="saving" @click="testConnection" /><span
            v-if="testing"
            role="status"
            >正在测试…</span
          ><span v-else-if="checked" role="status">{{ checked }}</span>
        </div>
      </section>
      <div class="form-actions">
        <WinButton label="保存存储设置" accent :disabled="saving" @click="save" />
      </div>
    </template>
  </div>
</template>
<style scoped>
.storage-settings {
  display: grid;
  gap: 20px;
}
.storage-summary h2,
.storage-summary p {
  margin: 0;
}
.storage-total {
  display: block;
  font-size: 36px;
  font-weight: 600;
  line-height: 1.3;
  margin: 8px 0 24px;
}
.storage-capacities {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: 28px;
}
.storage-capacity-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 16px;
}
.storage-capacity progress,
.storage-disk progress {
  display: block;
  width: 100%;
  height: 7px;
  border: 0;
  border-radius: 8px;
  overflow: hidden;
  margin: 12px 0;
  appearance: none;
  background: var(--control-stroke-color-default);
}
progress::-webkit-progress-bar {
  background: var(--control-stroke-color-default);
  border-radius: 8px;
}
progress::-webkit-progress-value {
  background: var(--accent);
  border-radius: 8px;
}
progress::-moz-progress-bar {
  background: var(--accent);
}
.storage-warning {
  color: var(--system-fill-color-caution, #9d5d00);
}
progress.storage-warning::-webkit-progress-value {
  background: var(--system-fill-color-caution, #9d5d00);
}
.storage-disks {
  margin-top: 24px;
  border-top: 1px solid var(--control-stroke-color-default);
  padding-top: 16px;
}
.storage-disks summary {
  cursor: pointer;
}
.storage-disk {
  margin-top: 20px;
}
.form-stack > p {
  margin: 0;
  line-height: 1.6;
}
@media (max-width: 640px) {
  .storage-total {
    font-size: 30px;
  }
  .storage-capacity-heading small {
    width: 100%;
  }
}
</style>
