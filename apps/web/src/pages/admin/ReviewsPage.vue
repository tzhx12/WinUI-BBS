<script setup lang="ts">
import { ref, watch } from 'vue'
import { NumberBox, TextBox } from 'winuionweb'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import type { ReviewPost } from '../../types/admin'
import { formatDateTime } from '../../utils'
import PostBody from '../../components/PostBody.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
import WinSelect from '../../components/ui/WinSelect.vue'
import WinDialog from '../../components/ui/WinDialog.vue'
defineOptions({ inheritAttrs: false })
const site = useSite(),
  status = ref('pending'),
  selected = ref<ReviewPost | null>(null)
const dialog = ref(false),
  decision = ref<'reject' | 'ban'>('reject'),
  reason = ref(''),
  banMinutes = ref(1440)
const {
  data: posts,
  loading,
  error,
  saving,
  reload,
  run,
} = useResource(
  () => api<ReviewPost[]>(`/api/admin/reviews?status=${status.value}`, { token: site.token.value }),
  [],
)
watch(status, () => {
  selected.value = null
  void reload()
})
async function read(post: ReviewPost) {
  await run(async () => {
    selected.value = await api<ReviewPost>(`/api/admin/reviews/${post.id}`, { token: site.token.value })
  })
}
function openDecision(action: 'reject' | 'ban') {
  decision.value = action
  reason.value = ''
  error.value = ''
  dialog.value = true
}
async function decide(action: 'approve' | 'reject' | 'ban') {
  if (!selected.value) return
  if (
    await run(
      () =>
        api(`/api/admin/reviews/${selected.value!.id}/decision`, {
          method: 'POST',
          token: site.token.value,
          body: {
            action,
            reason: action === 'approve' ? '' : reason.value,
            ...(action === 'ban' ? { banMinutes: banMinutes.value } : {}),
          },
        }),
      action === 'approve'
        ? '审核已通过，帖子已发布'
        : action === 'ban'
          ? '帖子已拒绝，账号已封禁并发送通知'
          : '帖子已拒绝并发送通知',
    )
  ) {
    dialog.value = false
    selected.value = null
    await Promise.all([reload(), site.loadCategories()])
  }
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader
        :title="selected ? '阅读与审核' : '发帖审核'"
        :description="selected ? selected.category_name : '阅读待审核帖子，决定是否公开。'"
      >
        <WinButton
          v-if="selected"
          label="返回审核列表"
          icon="back"
          :disabled="saving"
          @click="selected = null"
        />
        <WinButton v-else label="刷新" icon="refresh" :disabled="loading" @click="reload" />
      </PageHeader>
      <ResourceState :loading="loading" :error="dialog ? '' : error" />
      <template v-if="selected">
        <section class="surface-card review-detail">
          <div class="review-author-meta">
            <div>
              <strong>{{ selected.display_name }}</strong
              ><span>UID {{ selected.author_uid }}</span>
            </div>
            <div>
              <span>发帖时间</span><strong>{{ formatDateTime(selected.created_at) }}</strong>
            </div>
            <div>
              <span>用户组</span><strong>{{ selected.groups.join('、') || '无用户组' }}</strong>
            </div>
            <div>
              <span>来源 IP</span><strong>{{ selected.author_ip || '历史帖子未记录' }}</strong>
            </div>
          </div>
          <h1>{{ selected.title }}</h1>
          <PostBody :data="selected.body" />
          <p v-if="selected.review_reason" class="notification-body">
            审核原因：{{ selected.review_reason }}
          </p>
        </section>
        <div v-if="selected.status === 'pending'" class="review-decision-bar">
          <WinButton label="通过审核" icon="check" accent :disabled="saving" @click="decide('approve')" />
          <WinButton label="拒绝通过" icon="close" :disabled="saving" @click="openDecision('reject')" />
          <WinButton label="封禁发帖账号" icon="lock" :disabled="saving" @click="openDecision('ban')" />
        </div>
      </template>
      <template v-else>
        <div class="section-toolbar">
          <WinSelect
            v-model="status"
            label="审核状态"
            :options="[
              { value: 'pending', label: '待审核' },
              { value: 'published', label: '已通过' },
              { value: 'rejected', label: '未通过' },
            ]"
          /><span class="secondary-text">{{ posts.length }} 篇帖子</span>
        </div>
        <div v-if="!loading" class="table-surface">
          <table class="data-table">
            <thead>
              <tr>
                <th>帖子 / 时间</th>
                <th>发帖人</th>
                <th>用户组</th>
                <th>来源 IP</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="post in posts" :key="post.id">
                <td class="post-table-title">
                  <strong>{{ post.title }}</strong
                  ><small class="cell-secondary"
                    >{{ post.category_name }} · {{ formatDateTime(post.created_at) }}</small
                  ><small v-if="post.reviewer_name" class="cell-secondary"
                    >审核人：{{ post.reviewer_name }}</small
                  >
                </td>
                <td>
                  {{ post.display_name
                  }}<small class="cell-secondary">UID {{ post.author_uid }} · {{ post.username }}</small>
                </td>
                <td>{{ post.groups.join('、') || '无用户组' }}</td>
                <td>{{ post.author_ip || '未记录' }}</td>
                <td>
                  <WinButton
                    :label="post.status === 'pending' ? '阅读并审核' : '查看'"
                    icon="eye"
                    :disabled="saving"
                    @click="read(post)"
                  />
                </td>
              </tr>
              <tr v-if="!posts.length">
                <td colspan="5" class="table-empty">
                  {{ status === 'pending' ? '暂无待审核帖子' : '暂无审核记录' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <WinDialog
        v-model:open="dialog"
        :title="decision === 'ban' ? '拒绝帖子并封禁账号' : '拒绝通过'"
        :primary="decision === 'ban' ? '封禁并通知' : '拒绝并通知'"
        :busy="saving"
        :error="error"
        @primary="decide(decision)"
      >
        <p>帖子《{{ selected?.title }}》将保持不公开，以下原因会发送给作者。</p>
        <TextBox
          v-model:Text="reason"
          Header="原因"
          aria-label="审核原因"
          :AcceptsReturn="true"
          :MaxLength="2000"
        />
        <NumberBox
          v-if="decision === 'ban'"
          v-model:Value="banMinutes"
          Header="封禁时长（分钟）"
          :Minimum="30"
          :Maximum="1576800"
          SpinButtonPlacementMode="Inline"
          AutomationProperties.Name="封禁时长（分钟）"
        />
      </WinDialog>
    </div>
  </div>
</template>
