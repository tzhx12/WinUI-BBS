<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import type { AdminPost } from '../../types/admin'
import { formatDate } from '../../utils'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
import WinSelect from '../../components/ui/WinSelect.vue'
defineOptions({ inheritAttrs: false })
const site = useSite(),
  router = useRouter(),
  status = ref('all')
const {
  data: posts,
  loading,
  error,
  saving,
  reload,
  run,
} = useResource(
  () =>
    api<AdminPost[]>(`/api/admin/posts${status.value === 'all' ? '' : `?status=${status.value}`}`, {
      token: site.token.value,
    }),
  [],
)
watch(status, reload)
const names = { published: '已发布', pending: '待审核', hidden: '已隐藏', rejected: '未通过' }
async function remove(post: AdminPost) {
  if (
    !(await site.confirm(`删除“${post.title}”？`, '帖子将进入管理员删除记录，仅管理员可以恢复。', '删除帖子'))
  )
    return
  if (
    await run(
      () => api(`/api/admin/posts/${post.id}`, { method: 'DELETE', token: site.token.value }),
      '帖子已移入删除记录',
    )
  )
    await Promise.all([reload(), site.loadCategories()])
}
async function update(post: AdminPost, changes: { status?: string; isPinned?: boolean }) {
  if (
    await run(
      () => api(`/api/admin/posts/${post.id}`, { method: 'PATCH', token: site.token.value, body: changes }),
      '帖子已更新',
    )
  )
    await Promise.all([reload(), site.loadCategories()])
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="发帖管理" description="管理置顶、列表可见性与帖子删除。"
        ><WinButton label="删除记录" icon="delete" @click="router.push('/admin/deleted-posts')"
      /></PageHeader>
      <div class="section-toolbar">
        <WinSelect
          v-model="status"
          label="帖子状态"
          :options="[
            { value: 'all', label: '全部' },
            { value: 'published', label: '已发布' },
            { value: 'pending', label: '待审核' },
            { value: 'hidden', label: '已隐藏' },
            { value: 'rejected', label: '未通过' },
          ]"
        /><span class="secondary-text">{{ posts.length }} 篇帖子</span>
      </div>
      <ResourceState :loading="loading" :error="error" />
      <p class="field-hint">隐藏后不出现在首页、热门、搜索和板块列表中，仍可通过帖子链接阅读。</p>
      <div v-if="!loading" class="table-surface">
        <table class="data-table">
          <thead>
            <tr>
              <th>帖子</th>
              <th>板块</th>
              <th>作者</th>
              <th>阅读等级</th>
              <th>回复</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="post in posts" :key="post.id">
              <td class="post-table-title">
                <strong>{{ post.title }}</strong
                ><small class="cell-secondary"
                  >{{ formatDate(post.created_at) }}<span v-if="post.is_pinned"> · 已置顶</span></small
                >
              </td>
              <td>{{ post.category_name }}</td>
              <td>
                {{ post.display_name }}<small class="cell-secondary">UID {{ post.author_uid }}</small>
              </td>
              <td>{{ post.minimum_reader_level ? `Lv.${post.minimum_reader_level}+` : '公开' }}</td>
              <td>{{ post.reply_count }}</td>
              <td>
                <span :class="['status-tag', post.status === 'published' ? 'success' : 'warning']">{{
                  names[post.status]
                }}</span>
              </td>
              <td>
                <div class="row-actions">
                  <WinButton
                    v-if="post.status === 'published' || post.status === 'hidden'"
                    label="查看"
                    icon="eye"
                    subtle
                    @click="router.push(`/post/${post.id}`)"
                  /><WinButton
                    v-else-if="site.user.value?.permissions?.includes('posts.review')"
                    label="前往审核"
                    icon="check"
                    subtle
                    :disabled="saving"
                    @click="router.push('/admin/reviews')"
                  /><WinButton
                    :label="post.is_pinned ? '取消置顶' : '置顶'"
                    icon="pin"
                    subtle
                    :disabled="saving"
                    @click="update(post, { isPinned: !post.is_pinned })"
                  /><WinButton
                    v-if="post.status === 'published' || post.status === 'hidden'"
                    :label="post.status === 'hidden' ? '取消隐藏' : '隐藏'"
                    subtle
                    :disabled="saving"
                    @click="update(post, { status: post.status === 'hidden' ? 'published' : 'hidden' })"
                  />
                  <WinButton label="删除" icon="delete" subtle :disabled="saving" @click="remove(post)" />
                </div>
              </td>
            </tr>
            <tr v-if="!posts.length">
              <td colspan="7" class="table-empty">暂无帖子</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
