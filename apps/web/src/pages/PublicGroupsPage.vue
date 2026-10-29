<script setup lang="ts">
import { watch } from 'vue'
import { InfoBar, ProgressRing } from 'winuionweb'
import { api } from '../api'
import { useResource } from '../composables/useResource'
import { useSite } from '../site'
import PageHeader from '../components/ui/PageHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import WinButton from '../components/ui/WinButton.vue'
import IconGlyph from '../components/IconGlyph.vue'
defineOptions({ inheritAttrs: false })
interface PublicGroup {
  id: string
  name: string
  description: string
  member_count: number
  joined: boolean
}
const site = useSite()
const {
  data: groups,
  error,
  loading,
  saving,
  reload,
  run,
} = useResource(() => api<PublicGroup[]>('/api/groups/public', { token: site.token.value }), [])
watch(site.token, reload)
async function toggle(group: PublicGroup) {
  if (!site.user.value) {
    site.authOpen.value = true
    return
  }
  if (
    await run(
      () =>
        api(`/api/groups/${group.id}/${group.joined ? 'leave' : 'join'}`, {
          method: group.joined ? 'DELETE' : 'POST',
          token: site.token.value,
        }),
      group.joined ? '已退出用户组' : '已加入用户组',
    )
  )
    await Promise.all([reload(), site.refreshUser()])
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="公开用户组" description="找到感兴趣的用户组，自由加入或退出。" /><InfoBar
        :IsOpen="true"
        v-if="error"
        :Message="error"
        Severity="Error"
        :IsClosable="false"
      />
      <div v-if="loading" class="loading-state"><ProgressRing :IsActive="true" /></div>
      <EmptyState v-else-if="!groups.length" title="暂无公开用户组" icon="people" />
      <div v-else class="group-grid">
        <section v-for="group in groups" :key="group.id" class="surface-card public-group">
          <IconGlyph name="people" :size="28" />
          <h2>{{ group.name }}</h2>
          <p v-if="group.description" class="secondary-text">{{ group.description }}</p>
          <div class="section-toolbar">
            <span class="secondary-text">{{ group.member_count }} 位成员</span
            ><WinButton
              :label="group.joined ? '退出用户组' : '加入用户组'"
              :accent="!group.joined"
              :disabled="saving || site.user.value?.isBanned"
              @click="toggle(group)"
            />
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
