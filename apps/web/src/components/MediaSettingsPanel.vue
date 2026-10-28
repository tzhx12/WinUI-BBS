<script setup lang="ts">
import { TextBox, ToggleSwitch } from 'winuionweb'
import { api } from '../api'
import { useSite } from '../site'
import { useResource } from '../composables/useResource'
import type { MediaSettings } from '../types/admin'
import MediaLimitsFields from './MediaLimitsFields.vue'
import WinButton from './ui/WinButton.vue'
import ResourceState from './ui/ResourceState.vue'
import RemoteEmojiBrowser from './RemoteEmojiBrowser.vue'
const emit = defineEmits<{ added: [] }>()
const site = useSite()
const { data, loading, error, saving, run } = useResource(
  () => api<MediaSettings>('/api/admin/media-settings', { token: site.token.value }),
  null as MediaSettings | null,
)
async function save() {
  await run(
    () =>
      api('/api/admin/media-settings', {
        method: 'PATCH',
        token: site.token.value,
        body: { mediaLimits: data.value!.media_limits, remoteEmoji: data.value!.remote_emoji },
      }),
    '媒体设置已保存',
  )
}
</script>
<template>
  <ResourceState :loading="loading" :error="error" /><template v-if="data"
    ><section class="surface-card form-stack">
      <h2>默认上传限额</h2>
      <MediaLimitsFields v-model="data.media_limits" />
      <h2>远端表情包</h2>
      <ToggleSwitch
        v-model:IsOn="data.remote_emoji.enabled"
        Header="允许远端下载"
        OnContent="开启"
        OffContent="关闭"
      /><TextBox v-model:Text="data.remote_emoji.sourceUrl" Header="远端站点" aria-label="远端站点" /><TextBox
        v-model:Text="data.remote_emoji.apiUrl"
        Header="API 地址"
        aria-label="远端表情 API 地址"
      />
      <div class="form-actions">
        <WinButton label="保存媒体设置" accent :disabled="saving" @click="save" />
      </div>
    </section>
    <RemoteEmojiBrowser v-if="data.remote_emoji.enabled" admin @added="emit('added')"
  /></template>
</template>
