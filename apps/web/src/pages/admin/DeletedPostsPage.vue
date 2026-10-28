<script setup lang="ts">
import { useRouter } from 'vue-router'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import type { DeletedPost } from '../../types/admin'
import { formatDateTime } from '../../utils'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
defineOptions({ inheritAttrs: false })
const site = useSite(),
  router = useRouter()
const {
  data: posts,
  loading,
  error,
  saving,
  reload,
  run,
} = useResource(() => api<DeletedPost[]>('/api/admin/deleted-posts', { token: site.token.value }), [])
const names = { published: '已发布', pending: '待审核', hidden: '已隐藏', rejected: '未通过' }
async function restore(post: DeletedPost) {
  if (!(await site.confirm(`恢复“${post.title}”？`, `恢复后保持原状态：${names[post.status]}。`, '恢复帖子')))
    return
  if (
    await run(
      () => api(`/api/admin/deleted-posts/${post.id}/restore`, { method: 'POST', token: site.token.value }),
      '帖子已恢复',
    )
  )
    await Promise.all([reload(), site.loadCategories()])
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="删除记录" description="管理员删除的帖子保留在这里，仅管理员可以恢复。"
        ><WinButton label="返回发帖管理" icon="back" @click="router.push('/admin/posts')"
      /></PageHeader>
      <ResourceState :loading="loading" :error="error" />
      <div v-if="!loading" class="table-surface">
        <table class="data-table">
          <thead>
            <tr>
              <th>帖子</th>
              <th>作者</th>
              <th>删除时间</th>
              <th>操作人</th>
              <th>原状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="post in posts" :key="post.id">
              <td>
                <strong>{{ post.title }}</strong
                ><small class="cell-secondary">{{ post.category_name }}</small>
              </td>
              <td>
                {{ post.display_name }}<small class="cell-secondary">UID {{ post.author_uid }}</small>
              </td>
              <td>{{ formatDateTime(post.deleted_at) }}</td>
              <td>{{ post.deleted_by_name || '已删除账号' }}</td>
              <td>{{ names[post.status] }}</td>
              <td><WinButton label="恢复帖子" icon="refresh" :disabled="saving" @click="restore(post)" /></td>
            </tr>
            <tr v-if="!posts.length">
              <td colspan="6" class="table-empty">暂无删除记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
