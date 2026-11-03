<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { InfoBar, TextBox, PasswordBox } from 'winuionweb'
import { api } from '../api'
import type { User } from '../types'
import WinDialog from './ui/WinDialog.vue'
import WinButton from './ui/WinButton.vue'
import TurnstileWidget from './TurnstileWidget.vue'
import { useSite } from '../site'
import EmailCodeInput from './EmailCodeInput.vue'
const site = useSite()
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  authenticated: [value: { token: string; user: User }]
}>()
const mode = ref<'login' | 'register' | 'forgot'>('login')
const verificationCode = ref(''),
  message = ref(''),
  totpCode = ref(''),
  challengeToken = ref(''),
  twoFactorPending = ref(false),
  turnstileToken = ref(''),
  turnstileGeneration = ref(0)
const title = computed(() =>
  twoFactorPending.value
    ? '验证两步验证码'
    : mode.value === 'login'
      ? '登录社区'
      : mode.value === 'register'
        ? '创建账号'
        : '找回密码',
)
const primary = computed(() =>
  twoFactorPending.value
    ? '验证并登录'
    : mode.value === 'login'
      ? '登录'
      : mode.value === 'register'
        ? '注册'
        : '发送找回链接',
)
const captchaRequired = computed(() => site.settings.turnstile.enabled && !twoFactorPending.value)
const captchaAction = computed(() =>
  mode.value === 'register' ? 'register' : mode.value === 'forgot' ? 'password-reset-request' : 'login',
)
const identity = ref('')
const username = ref('')
const email = ref('')
const displayName = ref('')
const password = ref('')
const invitationCode = ref(new URLSearchParams(window.location.hash.split('?')[1]).get('invite') || '')
const error = ref('')
const busy = ref(false)
function changeMode(value: 'login' | 'register' | 'forgot') {
  mode.value = value
  twoFactorPending.value = false
  challengeToken.value = ''
  verificationCode.value = ''
  error.value = ''
  message.value = ''
  resetCaptcha()
}
function switchMode() {
  changeMode(mode.value === 'login' ? 'register' : 'login')
}
function resetCaptcha() {
  turnstileToken.value = ''
  turnstileGeneration.value += 1
}
function onRegistrationCodeSent(value: string) {
  message.value = value
}
watch(
  () => props.open,
  (open) => {
    if (open) {
      mode.value = 'login'
      twoFactorPending.value = false
      challengeToken.value = ''
      error.value = ''
      password.value = ''
      message.value = ''
      verificationCode.value = ''
      totpCode.value = ''
      resetCaptcha()
    }
  },
)
async function submit() {
  busy.value = true
  error.value = ''
  try {
    if (twoFactorPending.value) {
      const result = await api<{ token: string; user: User }>('/api/auth/login/totp', {
        method: 'POST',
        body: { challengeToken: challengeToken.value, code: totpCode.value },
      })
      emit('authenticated', result)
      return
    }
    if (mode.value === 'forgot') {
      const result = await api<{ message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: {
          email: email.value,
          ...(captchaRequired.value ? { turnstileToken: turnstileToken.value } : {}),
        },
      })
      message.value = result.message
      return
    }
    const result = await api<{
      token?: string
      user?: User
      requiresTwoFactor?: boolean
      challengeToken?: string
    }>(`/api/auth/${mode.value}`, {
      method: 'POST',
      body:
        mode.value === 'login'
          ? {
              identity: identity.value,
              password: password.value,
              ...(captchaRequired.value ? { turnstileToken: turnstileToken.value } : {}),
            }
          : {
              username: username.value,
              email: email.value,
              displayName: displayName.value || username.value,
              password: password.value,
              invitationCode: invitationCode.value || undefined,
              verificationCode: site.settings.emailSecurity.registrationVerification
                ? verificationCode.value
                : undefined,
              ...(captchaRequired.value ? { turnstileToken: turnstileToken.value } : {}),
            },
    })
    if (result.requiresTwoFactor && result.challengeToken) {
      twoFactorPending.value = true
      challengeToken.value = result.challengeToken
      password.value = ''
      totpCode.value = ''
      resetCaptcha()
      return
    }
    password.value = ''
    if (!result.token || !result.user) throw new Error('登录响应无效，请重试')
    emit('authenticated', { token: result.token, user: result.user })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '登录失败'
  } finally {
    busy.value = false
    if (captchaRequired.value) resetCaptcha()
  }
}
</script>
<template>
  <WinDialog
    :open="open"
    :title="title"
    :primary="busy ? '正在处理…' : primary"
    :busy="busy"
    :error="error"
    @update:open="emit('update:open', $event)"
    @primary="submit"
  >
    <form class="form-stack" @submit.prevent="submit">
      <TextBox
        v-if="mode === 'login' && !twoFactorPending"
        v-model:Text="identity"
        Header="用户名或邮箱"
        aria-label="用户名或邮箱"
        autocomplete="username"
      />
      <template v-else-if="mode === 'register' && !twoFactorPending"
        ><TextBox v-model:Text="username" Header="用户名" aria-label="用户名" :MaxLength="32" />
        <TextBox v-model:Text="email" Header="邮箱" aria-label="邮箱" autocomplete="email" />
        <TextBox v-model:Text="displayName" Header="显示名称" aria-label="显示名称" :MaxLength="48" />
      </template>
      <TextBox v-if="mode === 'forgot'" v-model:Text="email" Header="注册邮箱" autocomplete="email" />
      <EmailCodeInput
        v-if="mode === 'register' && site.settings.emailSecurity.registrationVerification"
        v-model="verificationCode"
        purpose="registration"
        :email="email"
        :turnstile-token="turnstileToken"
        :captcha-required="captchaRequired"
        :disabled="busy"
        @error="error = $event"
        @sent="onRegistrationCodeSent"
        @used="resetCaptcha"
      />
      <TextBox
        v-if="mode === 'register' && site.settings.registrationMode === 'invite'"
        v-model:Text="invitationCode"
        Header="邀请码"
        aria-label="邀请码"
      />
      <PasswordBox
        v-if="mode !== 'forgot' && !twoFactorPending"
        v-model:Password="password"
        Header="密码"
        aria-label="密码"
        :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
      />
      <small v-if="mode === 'register'" class="field-hint">密码至少 10 位</small>
      <p v-if="mode === 'forgot'" class="field-hint">
        找回链接有效期 {{ site.settings.emailSecurity.resetMinutes }} 分钟，每天最多
        {{ site.settings.emailSecurity.recoveryDailyLimit }} 次。
      </p>
      <template v-if="twoFactorPending">
        <p class="field-hint">请输入身份验证器当前的 6 位验证码。</p>
        <TextBox
          v-model:Text="totpCode"
          Header="身份验证器验证码"
          aria-label="身份验证器验证码"
          :MaxLength="6"
          inputmode="numeric"
          autocomplete="one-time-code"
        />
      </template>
      <TurnstileWidget
        v-if="captchaRequired"
        :key="turnstileGeneration"
        :site-key="site.settings.turnstile.siteKey"
        :action="captchaAction"
        @verified="turnstileToken = $event"
        @error="error = $event"
      />
      <InfoBar v-if="message" :IsOpen="true" :Message="message" Severity="Success" :IsClosable="false" />
      <WinButton
        v-if="mode === 'login' && !twoFactorPending && site.settings.emailSecurity.recoveryEnabled"
        label="找回密码"
        subtle
        @click="changeMode('forgot')"
      />
      <WinButton
        v-if="mode === 'forgot' || twoFactorPending"
        label="返回登录"
        subtle
        @click="changeMode('login')"
      />
      <WinButton
        v-if="
          !twoFactorPending &&
          (mode === 'register' || (mode === 'login' && site.settings.registrationEnabled))
        "
        :label="mode === 'login' ? '创建新账号' : '已有账号，返回登录'"
        subtle
        @click="switchMode"
      />
    </form>
  </WinDialog>
</template>
