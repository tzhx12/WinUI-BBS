<script setup lang="ts">
import { ref, watch } from 'vue'
import { NumberBox } from 'winuionweb'
import { useRouter } from 'vue-router'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import type { ContentReport } from '../../types/admin'
import { formatDateTime, postPath } from '../../utils'
import PostBody from '../../components/PostBody.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import EmptyState from '../../components/ui/EmptyState.vue'
import WinButton from '../../components/ui/WinButton.vue'
import WinSelect from '../../components/ui/WinSelect.vue'
import WinDialog from '../../components/ui/WinDialog.vue'
import AdminPostPagination from '../../components/AdminPostPagination.vue'
defineOptions({ inheritAttrs: false })
const site = useSite(),
  router = useRouter(),
  status = ref('pending'),
  page = ref(1),
  banMinutes = ref(1440)
const selected = ref<ContentReport | null>(null),
  action = ref(''),
  dialog = ref(false)
const { data, loading, error, saving, reload, run } = useResource(
  async () => {
    const result = await api<{
      reports: ContentReport[]
      page: number
      pageSize: number
      total: number
      totalPages: number
    }>(`/api/admin/reports?status=${status.value}&page=${page.value}`, { token: site.token.value })
    page.value = result.page
    return result
  },
  { reports: [], page: 1, pageSize: 20, total: 0, totalPages: 1 },
)
watch(status, () => {
  page.value = 1
  void reload()
})
function goPage(value: number) {
  page.value = value
  void reload()
}
function inspect(report: ContentReport) {
  selected.value = report
  action.value = ''
  error.value = ''
  dialog.value = true
}
async function resolve(actionValue: string) {
  if (!selected.value) return
  action.value = actionValue
  const label =
    actionValue === 'dismiss'
      ? '举报已标记为不处理'
      : actionValue === 'hide'
        ? '帖子已隐藏，举报已处理'
        : actionValue === 'delete'
          ? '帖子已移入删除记录'
          : actionValue === 'delete_ban'
            ? '帖子已删除并封禁作者'
            : actionValue === 'ban'
              ? '用户已封禁，举报已处理'
              : '回复已删除'
  if (
    await run(
      () =>
        api(`/api/admin/reports/${selected.value!.id}/resolve`, {
          method: 'POST',
          token: site.token.value,
          body: {
            action: actionValue,
            ...(['ban', 'delete_ban'].includes(actionValue) ? { banMinutes: banMinutes.value } : {}),
          },
        }),
      label,
    )
  ) {
    selected.value = null
    dialog.value = false
    await Promise.all([reload(), site.loadCategories()])
  }
}
function openTarget(report: ContentReport) {
  if (report.target_type === 'user' && report.target_user_uid)
    void router.push(`/users/${report.target_user_uid}`)
  else if (report.target_post_id && report.category_slug)
    void router.push({
      path: postPath({
        id: report.target_post_id,
        category_slug: report.category_slug,
        status: report.post_status || undefined,
      }),
      query: report.target_reply_id ? { reply: report.target_reply_id } : undefined,
    })
}
const targetName = (report: ContentReport) =>
  report.target_type === 'user'
    ? `${report.target_display_name || '已注销用户'} (@${report.target_username || '未知'})`
    : report.target_type === 'post'
      ? report.post_title || '帖子已删除'
      : `${report.post_title || '帖子'} · ${report.floor_number ? `第${report.floor_number}楼${report.child_number ? `-${report.child_number}层` : ''}` : '回复'}`
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader
        title="举报处理"
        :description="`${data.total} 条${status === 'pending' ? '待处理' : status === 'resolved' ? '已处理' : '全部'}举报`"
      >
        <WinButton label="刷新" icon="refresh" :disabled="loading" @click="reload" />
      </PageHeader>
      <div class="section-toolbar">
        <WinSelect
          v-model="status"
          label="举报状态"
          :options="[
            { value: 'pending', label: '待处理' },
            { value: 'resolved', label: '已处理' },
            { value: 'all', label: '全部' },
          ]"
        />
      </div>
      <ResourceState :loading="loading" :error="selected ? '' : error" />
      <EmptyState v-if="!loading && !data.reports.length" title="没有举报记录" icon="shield" />
      <article v-for="report in data.reports" :key="report.id" class="surface-card report-card">
        <div class="section-toolbar">
          <span class="tag"
            >{{
              report.target_type === 'post' ? '帖子' : report.target_type === 'reply' ? '回复' : '用户'
            }}举报</span
          >
          <span :class="['status-tag', report.status === 'pending' ? 'warning' : 'success']">{{
            report.status === 'pending' ? '待处理' : '已处理'
          }}</span>
          <time class="secondary-text">{{ formatDateTime(report.created_at) }}</time>
        </div>
        <h2>{{ targetName(report) }}</h2>
        <p class="report-reason">{{ report.reason }}</p>
        <PostBody
          v-if="report.target_type === 'reply' && report.reply_body"
          :data="report.reply_body"
          preview-mode="single"
        />
        <p class="secondary-text">
          举报人：{{ report.reporter_name || '账号已注销'
          }}<template v-if="report.reporter_uid"> · UID {{ report.reporter_uid }}</template>
        </p>
        <div class="row-actions">
          <WinButton
            label="查看目标"
            icon="eye"
            subtle
            :disabled="!report.target_post_id && !report.target_user_uid"
            @click="openTarget(report)"
          />
          <WinButton v-if="report.status === 'pending'" label="处理举报" accent @click="inspect(report)" />
          <span v-else class="secondary-text"
            >处理结果：{{
              report.resolution === 'dismiss'
                ? '不处理'
                : report.resolution === 'delete_ban'
                  ? '删帖并封禁'
                  : report.resolution === 'delete_reply'
                    ? '删除回复'
                    : report.resolution === 'delete'
                      ? '删除帖子'
                      : report.resolution === 'hide'
                        ? '隐藏帖子'
                        : '封禁用户'
            }}</span
          >
        </div>
      </article>
      <AdminPostPagination
        v-if="!error && data.totalPages > 1"
        :page="data.page"
        :total-pages="data.totalPages"
        :loading="loading"
        @change="goPage"
      />
      <WinDialog
        v-model:open="dialog"
        :title="selected ? `处理举报 #${selected.id}` : '处理举报'"
        close="关闭"
        :error="error"
        :busy="saving"
        @closed="selected = null"
      >
        <template v-if="selected">
          <p><strong>举报目标：</strong>{{ targetName(selected) }}</p>
          <p class="report-reason"><strong>举报理由：</strong>{{ selected.reason }}</p>
          <PostBody
            v-if="selected.target_type === 'reply' && selected.reply_body"
            :data="selected.reply_body"
            preview-mode="single"
          />
          <NumberBox
            v-if="selected.target_type === 'user' || selected.target_type === 'post'"
            v-model:Value="banMinutes"
            Header="封禁时长（分钟；仅封禁动作使用）"
            :Minimum="30"
            :Maximum="1576800"
            SpinButtonPlacementMode="Inline"
            AutomationProperties.Name="封禁时长（分钟）"
          />
          <div class="report-decisions">
            <template v-if="selected.target_type === 'post'">
              <WinButton label="隐藏帖子" :disabled="saving" @click="resolve('hide')" />
              <WinButton label="删帖" :disabled="saving" @click="resolve('delete')" />
              <WinButton label="删帖并封禁作者" :disabled="saving" @click="resolve('delete_ban')" />
            </template>
            <WinButton
              v-else-if="selected.target_type === 'user'"
              label="封禁用户"
              :disabled="saving"
              @click="resolve('ban')"
            />
            <WinButton v-else label="删除回复" :disabled="saving" @click="resolve('delete_reply')" />
            <WinButton label="不处理" subtle :disabled="saving" @click="resolve('dismiss')" />
          </div>
        </template>
      </WinDialog>
    </div>
  </div>
</template>
