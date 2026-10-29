<script setup lang="ts">
import { computed, ref } from 'vue'
import { ToggleSwitch } from 'winuionweb'
import { api } from '../api'
import { useSite } from '../site'
import type { ReplyEntry } from '../types'
import WinButton from './ui/WinButton.vue'
import WinDialog from './ui/WinDialog.vue'
const props = defineProps<{ postId: string; entry: ReplyEntry; readOnly?: boolean }>()
const emit = defineEmits<{ deleted: [result: { retainedChildren: boolean; removedCount: number }] }>()
const site = useSite()
const manager = computed(() => !!site.user.value?.permissions?.includes('posts.manage'))
const visible = computed(
  () =>
    !props.readOnly &&
    !site.user.value?.isBanned &&
    !!site.user.value &&
    (manager.value || props.entry.author_uid === site.user.value.uid) &&
    (!props.entry.deleted_at || manager.value),
)
const open = ref(false),
  all = ref(false),
  busy = ref(false),
  error = ref('')
function show() {
  all.value = !!props.entry.deleted_at
  error.value = ''
  open.value = true
}
async function remove() {
  busy.value = true
  error.value = ''
  try {
    const result = await api<{ retainedChildren: boolean; removedCount: number }>(
      `/api/posts/${props.postId}/replies/${props.entry.id}?scope=${manager.value && !props.entry.parent_reply_id && all.value ? 'thread' : 'reply'}`,
      { method: 'DELETE', token: site.token.value },
    )
    open.value = false
    site.notify('回复已删除')
    emit('deleted', result)
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <WinButton
    v-if="visible"
    :label="entry.deleted_at ? '删除此楼下全部回复' : '删除回复'"
    icon="delete"
    subtle
    :disabled="busy"
    @click="show"
  />
  <WinDialog
    v-model:open="open"
    title="删除回复？"
    primary="删除"
    :busy="busy"
    :error="error"
    @primary="remove"
  >
    <p>删除后无法恢复。</p>
    <ToggleSwitch
      v-if="manager && !entry.parent_reply_id && !entry.deleted_at"
      v-model:IsOn="all"
      Header="同时删除此回复下的所有楼中楼"
      OnContent="删除整层回复"
      OffContent="仅删除主回复，保留楼中楼"
    />
    <p v-if="!entry.parent_reply_id && !all" class="secondary-text">已有楼中楼会保留在原位置。</p>
    <p v-if="manager" class="secondary-text">将通知被删除回复的作者，并写入管理记录。</p>
  </WinDialog>
</template>
