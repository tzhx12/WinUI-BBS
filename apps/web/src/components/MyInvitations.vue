<script setup lang="ts">
import { api } from '../api'
import { useSite } from '../site'
import { useResource } from '../composables/useResource'
import type { Invitation } from '../types/admin'
import ResourceState from './ui/ResourceState.vue'
import WinButton from './ui/WinButton.vue'
const site = useSite()
const { data, loading, error } = useResource(
  () => api<Invitation[]>('/api/me/invitations', { token: site.token.value }),
  [],
)
async function copy(code: string) {
  await navigator.clipboard.writeText(
    `${(site.settings.url || window.location.origin).replace(/\/$/, '')}/#/home?invite=${encodeURIComponent(code)}`,
  )
  site.notify('邀请链接已复制')
}
</script>
<template>
  <section class="surface-card">
    <ResourceState :loading="loading" :error="error" />
    <p v-if="!loading && !data.length" class="secondary-text">暂无邀请码</p>
    <div v-for="code in data" :key="code.id" class="setting-row">
      <div>
        <code>{{ code.code }}</code
        ><small
          >{{ code.used_count }} / {{ code.max_uses }} 次 · {{ code.is_enabled ? '启用' : '停用' }}</small
        >
      </div>
      <WinButton
        label="复制邀请链接"
        icon="copy"
        :disabled="!code.is_enabled || code.used_count >= code.max_uses"
        @click="copy(code.code)"
      />
    </div>
  </section>
</template>
