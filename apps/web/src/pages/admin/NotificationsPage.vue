<script setup lang="ts">
import { reactive, ref } from 'vue'
import { TextBox } from 'winuionweb'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import type { Announcement } from '../../types/admin'
import { formatDateTime } from '../../utils'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
import WinSelect from '../../components/ui/WinSelect.vue'
import WinDialog from '../../components/ui/WinDialog.vue'
defineOptions({ inheritAttrs: false })
const site = useSite(),
  dialog = ref(false),
  groups = ref<Array<{ id: string; name: string }>>([])
const form = reactive({ title: '', body: '', audienceType: 'all', groupId: '', userUid: '' })
const {
  data: notices,
  loading,
  error,
  saving,
  reload,
  run,
} = useResource(async () => {
  const [notices, targets] = await Promise.all([
    api<Announcement[]>('/api/admin/notifications', { token: site.token.value }),
    api<Array<{ id: string; name: string }>>('/api/admin/notification-groups', { token: site.token.value }),
  ])
  groups.value = targets
  return notices
}, [])
function compose() {
  Object.assign(form, { title: '', body: '', audienceType: 'all', groupId: '', userUid: '' })
  error.value = ''
  dialog.value = true
}
async function send() {
  if (
    await run(async () => {
      const result = await api<{ recipientCount: number }>('/api/admin/notifications', {
        method: 'POST',
        token: site.token.value,
        body: {
          title: form.title,
          body: form.body,
          audience: {
            type: form.audienceType,
            ...(form.audienceType === 'all'
              ? {}
              : { id: form.audienceType === 'group' ? form.groupId : form.userUid.trim() }),
          },
        },
      })
      site.notify(`通知已发送给 ${result.recipientCount} 位用户`)
    })
  ) {
    dialog.value = false
    await Promise.all([reload(), site.refreshUnread()])
  }
}
function audience(notice: Announcement) {
  return notice.audience.type === 'all'
    ? '全体用户'
    : notice.audience.type === 'user'
      ? `UID ${notice.audience.id}`
      : groups.value.find((g) => g.id === notice.audience.id)?.name || '已删除用户组'
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content notifications-page">
      <PageHeader title="公告与通知" description="向全体用户、指定用户组或某位用户发送站内消息。"
        ><WinButton label="发送通知" icon="mail" accent @click="compose"
      /></PageHeader>
      <ResourceState :loading="loading" :error="dialog ? '' : error" />
      <section v-for="notice in notices" :key="notice.id" class="surface-card">
        <div class="section-toolbar">
          <span class="tag">{{ audience(notice) }}</span
          ><time class="secondary-text">{{ formatDateTime(notice.created_at) }}</time>
        </div>
        <h2>{{ notice.title }}</h2>
        <p class="notification-body">{{ notice.body }}</p>
        <p class="secondary-text">
          {{ notice.sender_name || '社区管理' }} · 已发送 {{ notice.recipient_count }} 人 · 已读
          {{ notice.read_count }} 人
        </p>
      </section>
      <p v-if="!loading && !notices.length" class="table-empty">还没有发送过通知</p>
      <WinDialog
        v-model:open="dialog"
        title="发送站内通知"
        primary="发送通知"
        :busy="saving"
        :error="error"
        @primary="send"
      >
        <WinSelect
          v-model="form.audienceType"
          label="接收范围"
          :options="[
            { value: 'all', label: '全体用户' },
            { value: 'group', label: '指定用户组' },
            { value: 'user', label: '指定用户' },
          ]"
        />
        <WinSelect
          v-if="form.audienceType === 'group'"
          v-model="form.groupId"
          label="用户组"
          :options="groups.map((g) => ({ value: g.id, label: g.name }))"
        />
        <TextBox
          v-if="form.audienceType === 'user'"
          v-model:Text="form.userUid"
          Header="用户 UID"
          aria-label="接收用户 UID"
        />
        <TextBox v-model:Text="form.title" Header="标题" aria-label="通知标题" :MaxLength="180" />
        <TextBox
          v-model:Text="form.body"
          Header="正文"
          aria-label="通知正文"
          :AcceptsReturn="true"
          :MaxLength="10000"
          :MinHeight="150"
        />
      </WinDialog>
    </div>
  </div>
</template>
