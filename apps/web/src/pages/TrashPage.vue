<script setup lang="ts">
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useSite } from '../site'
import { useResource } from '../composables/useResource'
import { formatDate, formatDateTime } from '../utils'
import PageHeader from '../components/ui/PageHeader.vue'
import ResourceState from '../components/ui/ResourceState.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import WinButton from '../components/ui/WinButton.vue'
defineOptions({ inheritAttrs: false })
interface TrashedPost {
  id: string
  title: string
  category_name: string
  status: string
  deleted_at: string
  purge_after: string
}
const site = useSite(),
  router = useRouter()
const { data, loading, error, saving, reload, run } = useResource(
  () => api<TrashedPost[]>('/api/me/trash', { token: site.token.value }),
  [],
)
async function restore(post: TrashedPost) {
  if (
    await run(
      () => api(`/api/me/trash/${post.id}/restore`, { method: 'POST', token: site.token.value }),
      '帖子已恢复',
    )
  )
    await Promise.all([reload(), site.loadCategories()])
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="回收站" description="仅自己可见，到期后自动清理。"
        ><WinButton label="返回用户后台" icon="back" @click="router.push('/account')"
      /></PageHeader>
      <ResourceState :loading="loading" :error="error" />
      <EmptyState v-if="!loading && !data.length" title="回收站为空" icon="delete" />
      <section v-for="post in data" :key="post.id" class="surface-card trash-post">
        <div class="section-toolbar">
          <div>
            <WinButton :label="post.title" subtle @click="router.push(`/account/trash/${post.id}`)" />
            <p class="secondary-text">{{ post.category_name }} · {{ formatDate(post.deleted_at) }} 删除</p>
          </div>
          <WinButton label="恢复帖子" icon="refresh" :disabled="saving" @click="restore(post)" />
        </div>
        <small class="secondary-text">{{ formatDateTime(post.purge_after) }} 到期清理</small>
      </section>
    </div>
  </div>
</template>
