<script setup lang="ts">
import { ref } from 'vue'
import { TextBox } from 'winuionweb'
import { api } from '../api'
import { useSite } from '../site'
import WinDialog from './ui/WinDialog.vue'

const props = defineProps<{
  targetType: 'post' | 'reply' | 'user'
  postId?: string
  replyId?: string
  userUid?: string
  ownerUid?: string
  label?: string
}>()
const site = useSite()
const open = ref(false),
  reason = ref(''),
  saving = ref(false),
  error = ref('')
function startReport() {
  if (!site.user.value) {
    site.authOpen.value = true
    return
  }
  open.value = true
}
async function submit() {
  if (!reason.value.trim() || saving.value) return
  saving.value = true
  error.value = ''
  try {
    await api('/api/reports', {
      method: 'POST',
      token: site.token.value,
      body: {
        targetType: props.targetType,
        postId: props.postId,
        replyId: props.replyId,
        userUid: props.userUid,
        reason: reason.value,
      },
    })
    open.value = false
    reason.value = ''
    site.notify('举报已提交，管理员会尽快处理')
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <template v-if="!site.user.value || (site.user.value.uid !== userUid && site.user.value.uid !== ownerUid)">
    <a href="#report" class="report-link" @click.prevent="startReport">{{ label || '举报' }}</a>
    <WinDialog
      v-model:open="open"
      title="举报内容"
      primary="提交举报"
      :busy="saving"
      :error="error"
      @primary="submit"
    >
      <p class="secondary-text">请说明举报理由，管理员会根据社区规则处理。</p>
      <TextBox
        v-model:Text="reason"
        Header="举报理由"
        aria-label="举报理由"
        :AcceptsReturn="true"
        :MaxLength="2000"
        :MinHeight="120"
      />
    </WinDialog>
  </template>
</template>
