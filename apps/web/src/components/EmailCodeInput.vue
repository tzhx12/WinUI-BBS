<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { TextBox } from 'winuionweb'
import { api } from '../api'
import WinButton from './ui/WinButton.vue'
const props = defineProps<{
  modelValue: string
  purpose: 'registration' | 'password_change'
  email?: string
  token?: string | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  error: [message: string]
  sent: [message: string]
}>()
const busy = ref(false),
  remaining = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
const label = computed(() => (remaining.value ? `${remaining.value} 秒后重发` : '获取验证码'))
async function send() {
  busy.value = true
  emit('error', '')
  try {
    const result = await api<{ retryAfterSeconds: number; expiresInMinutes: number }>(
      props.purpose === 'registration' ? '/api/auth/email-code' : '/api/me/password/code',
      {
        method: 'POST',
        token: props.token,
        body: props.purpose === 'registration' ? { email: props.email } : undefined,
      },
    )
    remaining.value = result.retryAfterSeconds
    clearInterval(timer)
    timer = setInterval(() => {
      remaining.value = Math.max(0, remaining.value - 1)
      if (!remaining.value) clearInterval(timer)
    }, 1000)
    emit('sent', `验证码已发送，有效期 ${result.expiresInMinutes} 分钟。`)
  } catch (cause) {
    emit('error', (cause as Error).message)
  } finally {
    busy.value = false
  }
}
onBeforeUnmount(() => clearInterval(timer))
</script>
<template>
  <div class="email-code-field">
    <TextBox
      :Text="modelValue"
      Header="邮箱验证码"
      :MaxLength="6"
      inputmode="numeric"
      autocomplete="one-time-code"
      :IsEnabled="!disabled"
      @update:Text="emit('update:modelValue', $event)"
    />
    <WinButton
      :label="busy ? '正在发送…' : label"
      :disabled="disabled || busy || remaining > 0 || (purpose === 'registration' && !email?.trim())"
      @click="send"
    />
  </div>
</template>
<style scoped>
.email-code-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
}
</style>
