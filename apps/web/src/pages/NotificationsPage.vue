<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useResource } from '../composables/useResource'
import { useSite } from '../site'
import type { SiteNotification } from '../types'
import { formatDateTime } from '../utils'
import PageHeader from '../components/ui/PageHeader.vue'
import ResourceState from '../components/ui/ResourceState.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import WinButton from '../components/ui/WinButton.vue'
defineOptions({ inheritAttrs: false })
const site = useSite(),
  router = useRouter(),
  hasMore = ref(false)
const {
  data: notices,
  loading,
  error,
  saving,
  reload,
  run,
} = useResource(async () => {
  if (!site.user.value) return []
  const result = await api<SiteNotification[]>('/api/me/notifications', { token: site.token.value })
  hasMore.value = result.length === 50
  await site.refreshUnread()
  return result
}, [])
watch(site.token, reload)
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
  await router.push(`/post/${notice.post_id}`)
}
async function more() {
  await run(async () => {
    const result = await api<SiteNotification[]>(`/api/me/notifications?before=${notices.value.at(-1)!.id}`, {
      token: site.token.value,
    })
    notices.value.push(...result)
    hasMore.value = result.length === 50
  })
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content notifications-page">
      <PageHeader
        title="站内通知"
        :description="
          site.unreadCount.value ? `${site.unreadCount.value} 条未读通知` : '社区公告与发帖审核消息'
        "
      >
        <WinButton v-if="site.user.value" label="刷新" icon="refresh" :disabled="loading" @click="reload" />
        <WinButton
          v-if="site.unreadCount.value && !site.user.value?.isBanned"
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
                    : '社区公告'
            }}</span
            ><span v-if="!notice.read_at" class="status-tag warning">未读</span
            ><time class="secondary-text">{{ formatDateTime(notice.created_at) }}</time>
          </div>
          <h2>{{ notice.title }}</h2>
          <p class="notification-body">{{ notice.body }}</p>
          <div class="section-toolbar">
            <span class="secondary-text">{{ notice.sender_name || '社区管理' }}</span>
            <div class="row-actions">
              <WinButton v-if="notice.post_id" label="查看帖子" icon="eye" subtle @click="openPost(notice)" />
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
      </template>
    </div>
  </div>
</template>
