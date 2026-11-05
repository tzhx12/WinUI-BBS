<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { TextBox } from 'winuionweb'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useResource } from '../composables/useResource'
import { useSite } from '../site'
import type { NotificationBlockPage, SiteNotification } from '../types'
import { formatDateTime, postPath } from '../utils'
import PageHeader from '../components/ui/PageHeader.vue'
import ResourceState from '../components/ui/ResourceState.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import WinButton from '../components/ui/WinButton.vue'
import SelectorSwitch from '../components/ui/SelectorSwitch.vue'
import SelectorPage from '../components/ui/SelectorPage.vue'
defineOptions({ inheritAttrs: false })
const site = useSite(),
  router = useRouter()
const section = ref('all'),
  hasMore = ref(false),
  replyPage = ref(1),
  replyTotalPages = ref(1)
const blockPage = ref(1),
  blockTotalPages = ref(1),
  blocks = ref<NotificationBlockPage['blocks']>([]),
  blockTotal = ref(0),
  username = ref(''),
  blockLoading = ref(false),
  blockError = ref('')
const {
  data: inbox,
  loading,
  error,
  saving,
  reload,
  run,
} = useResource(
  async () => {
    if (!site.user.value || section.value === 'blocks')
      return { notices: [], page: 1, totalPages: 1, hasMore: false }
    if (section.value === 'replies') {
      const result = await api<{ notices: SiteNotification[]; page: number; totalPages: number }>(
        `/api/me/notifications?kind=reply&page=${replyPage.value}`,
        { token: site.token.value },
      )
      await site.refreshUnread()
      return { ...result, hasMore: false }
    }
    const result = await api<SiteNotification[]>('/api/me/notifications', { token: site.token.value })
    await site.refreshUnread()
    return { notices: result, page: 1, totalPages: 1, hasMore: result.length === 50 }
  },
  { notices: [] as SiteNotification[], page: 1, totalPages: 1, hasMore: false },
)
const notices = computed(() => inbox.value.notices)
watch(inbox, (value) => {
  hasMore.value = value.hasMore
  replyPage.value = value.page
  replyTotalPages.value = value.totalPages
})
let blockRequest = 0
onBeforeUnmount(() => {
  blockRequest++
})
watch([site.token, section], () => {
  void reload()
  if (section.value === 'blocks') void loadBlocks(1)
  else blockRequest++
})
async function loadBlocks(page: number) {
  const version = ++blockRequest
  if (!site.user.value) return
  blockLoading.value = true
  blockError.value = ''
  try {
    const result = await api<NotificationBlockPage>(`/api/me/notification-blocks?page=${page}`, {
      token: site.token.value,
    })
    if (version !== blockRequest) return
    blocks.value = result.blocks
    blockPage.value = result.page
    blockTotalPages.value = result.totalPages
    blockTotal.value = result.total
  } catch (cause) {
    if (version === blockRequest) blockError.value = (cause as Error).message
  } finally {
    if (version === blockRequest) blockLoading.value = false
  }
}
async function addBlock() {
  if (!username.value.trim()) return
  if (
    await run(
      () =>
        api('/api/me/notification-blocks', {
          method: 'POST',
          token: site.token.value,
          body: { username: username.value.trim() },
        }),
      '已屏蔽该用户的通知',
    )
  ) {
    username.value = ''
    await Promise.all([loadBlocks(blockPage.value), site.refreshUnread()])
  }
}
async function removeBlock(uid: string) {
  if (
    await run(
      () => api(`/api/me/notification-blocks/${uid}`, { method: 'DELETE', token: site.token.value }),
      '已撤销屏蔽',
    )
  )
    await Promise.all([loadBlocks(blockPage.value), site.refreshUnread()])
}
async function markRead(notice: SiteNotification) {
  if (site.user.value?.isBanned) return
  if (
    await run(() =>
      api(`/api/me/notifications/${notice.id}/read`, { method: 'POST', token: site.token.value }),
    )
  ) {
    notice.read_at = new Date().toISOString()
    await site.refreshUnread()
  }
}
async function readAll() {
  if (
    await run(
      () => api('/api/me/notifications/read-all', { method: 'POST', token: site.token.value }),
      '已全部标为已读',
    )
  )
    await reload()
}
async function openPost(notice: SiteNotification) {
  await markRead(notice)
  if (notice.post_id && notice.category_slug)
    await router.push({
      path: postPath({
        id: notice.post_id,
        category_slug: notice.category_slug,
        status: notice.post_status ?? undefined,
      }),
      query: notice.reply_id ? { reply: notice.reply_id } : undefined,
    })
}
async function more() {
  if (!notices.value.length) return
  const currentNotices = notices.value
  const currentToken = site.token.value
  await run(async () => {
    const result = await api<SiteNotification[]>(`/api/me/notifications?before=${notices.value.at(-1)!.id}`, {
      token: site.token.value,
    })
    if (section.value === 'all' && notices.value === currentNotices && site.token.value === currentToken) {
      currentNotices.push(...result)
      hasMore.value = result.length === 50
    }
  })
}
function changeReplyPage(page: number) {
  replyPage.value = page
  void reload()
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content notifications-page">
      <PageHeader
        title="站内通知"
        :description="site.unreadCount.value ? `${site.unreadCount.value} 条未读通知` : '社区消息与回复'"
      >
        <WinButton
          v-if="site.user.value && section !== 'blocks'"
          label="刷新"
          icon="refresh"
          :disabled="loading"
          @click="reload"
        />
        <WinButton
          v-if="site.unreadCount.value && !site.user.value?.isBanned && section === 'all'"
          label="全部标为已读"
          icon="check"
          :disabled="saving"
          @click="readAll"
        />
      </PageHeader>
      <EmptyState v-if="!site.user.value" title="登录后查看通知" icon="mail"
        ><WinButton label="登录" accent @click="site.authOpen.value = true"
      /></EmptyState>
      <template v-else>
        <SelectorSwitch
          v-model="section"
          aria-label="通知类别"
          :options="[
            { value: 'all', label: '全部通知' },
            { value: 'replies', label: '回复我的' },
            { value: 'blocks', label: '屏蔽管理' },
          ]"
        />
        <SelectorPage :selected="section">
          <section v-if="section === 'all'" class="notification-list">
            <ResourceState :loading="loading" :error="error" />
            <EmptyState v-if="!loading && !notices.length" title="暂无通知" icon="mail" />
            <article
              v-for="notice in notices"
              :key="notice.id"
              :class="['surface-card', 'inbox-notice', { unread: !notice.read_at }]"
            >
              <div class="section-toolbar">
                <span class="tag">{{
                  notice.kind === 'review'
                    ? '发帖审核'
                    : notice.kind === 'moderation'
                      ? '回复管理'
                      : notice.kind === 'storage'
                        ? '存储提醒'
                        : notice.kind === 'reply'
                          ? '回复我的'
                          : '社区公告'
                }}</span>
                <span v-if="!notice.read_at" class="status-tag warning">未读</span>
                <time class="secondary-text">{{ formatDateTime(notice.created_at) }}</time>
              </div>
              <h2>{{ notice.title }}</h2>
              <p class="notification-body">{{ notice.body }}</p>
              <div class="section-toolbar">
                <span class="secondary-text">{{ notice.sender_name || '社区管理' }}</span>
                <div class="row-actions">
                  <WinButton
                    v-if="notice.post_id"
                    :label="notice.reply_id ? '查看回复' : '查看帖子'"
                    icon="eye"
                    subtle
                    @click="openPost(notice)"
                  />
                  <WinButton
                    v-if="!notice.read_at && !site.user.value?.isBanned"
                    label="标为已读"
                    icon="check"
                    :disabled="saving"
                    @click="markRead(notice)"
                  />
                </div>
              </div>
            </article>
            <WinButton v-if="hasMore" label="加载更多" :disabled="saving" @click="more" />
          </section>
          <section v-else-if="section === 'replies'" class="notification-list">
            <ResourceState :loading="loading" :error="error" />
            <EmptyState v-if="!loading && !notices.length" title="还没有人回复你" icon="mail" />
            <article
              v-for="notice in notices"
              :key="notice.id"
              :class="['surface-card', 'inbox-notice', { unread: !notice.read_at }]"
            >
              <div class="section-toolbar">
                <span class="tag">回复我的</span
                ><span v-if="!notice.read_at" class="status-tag warning">未读</span
                ><time class="secondary-text">{{ formatDateTime(notice.created_at) }}</time>
              </div>
              <p class="notification-body">{{ notice.body }}</p>
              <div class="section-toolbar">
                <span class="secondary-text">{{ notice.sender_name || '已注销用户' }}</span
                ><WinButton
                  label="查看回复"
                  icon="eye"
                  subtle
                  :disabled="!notice.post_id || !notice.reply_id"
                  @click="openPost(notice)"
                />
              </div>
            </article>
            <nav v-if="replyTotalPages > 1" class="feed-pagination" aria-label="回复通知翻页">
              <WinButton
                label="上一页"
                :disabled="loading || replyPage <= 1"
                @click="changeReplyPage(replyPage - 1)"
              />
              <span>第 {{ replyPage }} / {{ replyTotalPages }} 页 · 每页 20 条</span>
              <WinButton
                label="下一页"
                :disabled="loading || replyPage >= replyTotalPages"
                @click="changeReplyPage(replyPage + 1)"
              />
            </nav>
          </section>
          <section v-else class="notification-blocks">
            <p class="secondary-text">屏蔽后，不再收到该用户发来的通知；可随时撤销。</p>
            <div v-if="!site.user.value?.isBanned" class="notification-block-form">
              <TextBox
                v-model:Text="username"
                Header="用户名"
                aria-label="要屏蔽的用户名"
                :MaxLength="32"
              /><WinButton
                label="屏蔽用户"
                icon="lock"
                accent
                :disabled="saving || !username.trim()"
                @click="addBlock"
              />
            </div>
            <ResourceState :loading="blockLoading" :error="blockError" />
            <p class="secondary-text">{{ blockTotal }} 个屏蔽记录</p>
            <article v-for="block in blocks" :key="block.uid" class="surface-card notification-block-row">
              <div>
                <strong>{{ block.display_name }}</strong
                ><span class="secondary-text">@{{ block.username }} · UID {{ block.uid }}</span>
              </div>
              <WinButton
                v-if="!site.user.value?.isBanned"
                label="撤销屏蔽"
                subtle
                :disabled="saving"
                @click="removeBlock(block.uid)"
              />
            </article>
            <EmptyState v-if="!blockLoading && !blocks.length" title="还没有屏蔽用户" icon="people" />
            <nav v-if="blockTotalPages > 1" class="feed-pagination" aria-label="屏蔽记录翻页">
              <WinButton
                label="上一页"
                :disabled="blockLoading || blockPage <= 1"
                @click="loadBlocks(blockPage - 1)"
              />
              <span>第 {{ blockPage }} / {{ blockTotalPages }} 页 · 每页 20 条</span>
              <WinButton
                label="下一页"
                :disabled="blockLoading || blockPage >= blockTotalPages"
                @click="loadBlocks(blockPage + 1)"
              />
            </nav>
          </section>
        </SelectorPage>
      </template>
    </div>
  </div>
</template>
