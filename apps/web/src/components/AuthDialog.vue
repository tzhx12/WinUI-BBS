<script setup lang="ts">
import { ref, watch } from 'vue'
import { TextBox, PasswordBox } from 'winuionweb'
import { api } from '../api'
import type { User } from '../types'
import WinDialog from './ui/WinDialog.vue'
import WinButton from './ui/WinButton.vue'
import { useSite } from '../site'
const site = useSite()
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  authenticated: [value: { token: string; user: User }]
}>()
const mode = ref<'login' | 'register'>('login')
const identity = ref('')
const username = ref('')
const email = ref('')
const displayName = ref('')
const password = ref('')
const invitationCode = ref(new URLSearchParams(window.location.hash.split('?')[1]).get('invite') || '')
const error = ref('')
const busy = ref(false)
function switchMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  error.value = ''
}
watch(
  () => props.open,
  (open) => {
    if (open) {
      mode.value = 'login'
      error.value = ''
      password.value = ''
    }
  },
)
async function submit() {
  busy.value = true
  error.value = ''
  try {
    const result = await api<{ token: string; user: User }>(`/api/auth/${mode.value}`, {
      method: 'POST',
      body:
        mode.value === 'login'
          ? { identity: identity.value, password: password.value }
          : {
              username: username.value,
              email: email.value,
              displayName: displayName.value || username.value,
              password: password.value,
              invitationCode: invitationCode.value || undefined,
            },
    })
    password.value = ''
    emit('authenticated', result)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '登录失败'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <WinDialog
    :open="open"
    :title="mode === 'login' ? '登录社区' : '创建账号'"
    :primary="busy ? '正在处理…' : mode === 'login' ? '登录' : '注册'"
    :busy="busy"
    :error="error"
    @update:open="emit('update:open', $event)"
    @primary="submit"
  >
    <form class="form-stack" @submit.prevent="submit">
      <TextBox
        v-if="mode === 'login'"
        v-model:Text="identity"
        Header="用户名或邮箱"
        aria-label="用户名或邮箱"
        autocomplete="username"
      />
      <template v-else
        ><TextBox v-model:Text="username" Header="用户名" aria-label="用户名" :MaxLength="32" />
        <TextBox v-model:Text="email" Header="邮箱" aria-label="邮箱" autocomplete="email" />
        <TextBox v-model:Text="displayName" Header="显示名称" aria-label="显示名称" :MaxLength="48" />
      </template>
      <TextBox
        v-if="mode === 'register' && site.settings.registrationMode === 'invite'"
        v-model:Text="invitationCode"
        Header="邀请码"
        aria-label="邀请码"
      />
      <PasswordBox
        v-model:Password="password"
        Header="密码"
        aria-label="密码"
        :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
      />
      <small v-if="mode === 'register'" class="field-hint">密码至少 10 位</small>
      <WinButton
        v-if="mode === 'register' || site.settings.registrationEnabled"
        :label="mode === 'login' ? '创建新账号' : '已有账号，返回登录'"
        subtle
        @click="switchMode"
      />
    </form>
  </WinDialog>
</template>
