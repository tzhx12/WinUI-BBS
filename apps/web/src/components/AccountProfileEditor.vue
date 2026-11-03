<script setup lang="ts">
import { computed, ref } from 'vue'
import { InfoBar, PasswordBox, PersonPicture, TextBox } from 'winuionweb'
import QRCode from 'qrcode'
import { api, uploadForm } from '../api'
import { useSite } from '../site'
import WinButton from './ui/WinButton.vue'
import WinDialog from './ui/WinDialog.vue'
import EmailCodeInput from './EmailCodeInput.vue'
import ImageCropDialog from './ui/ImageCropDialog.vue'
import { imageCropPresets } from '../imageCrop'
import TurnstileWidget from './TurnstileWidget.vue'

defineOptions({ inheritAttrs: false })
const site = useSite()
withDefaults(defineProps<{ showActions?: boolean }>(), { showActions: false })
const emit = defineEmits<{ updated: [] }>()
defineExpose({ editAvatar, editNickname })
const passwordOpen = ref(false),
  newPassword = ref(''),
  confirmPassword = ref(''),
  passwordCode = ref(''),
  passwordMessage = ref(''),
  passwordCaptchaToken = ref(''),
  passwordCaptchaGeneration = ref(0)
function editPassword() {
  newPassword.value = ''
  confirmPassword.value = ''
  passwordCode.value = ''
  passwordMessage.value = ''
  resetPasswordCaptcha()
  profileError.value = ''
  passwordOpen.value = true
}
async function changePassword() {
  if (newPassword.value !== confirmPassword.value) {
    profileError.value = '两次输入的密码不一致'
    return
  }
  saving.value = true
  profileError.value = ''
  try {
    const result = await api<{ token: string }>('/api/me/password', {
      method: 'POST',
      token: site.token.value,
      body: {
        password: newPassword.value,
        code: passwordCode.value,
        ...(site.settings.turnstile.enabled ? { turnstileToken: passwordCaptchaToken.value } : {}),
      },
    })
    await site.authenticate({ token: result.token, user: site.user.value! })
    passwordOpen.value = false
    newPassword.value = ''
    confirmPassword.value = ''
    passwordCode.value = ''
    site.notify('密码已更改，其他登录凭证已失效')
  } catch (cause) {
    profileError.value = (cause as Error).message
  } finally {
    saving.value = false
    if (site.settings.turnstile.enabled) resetPasswordCaptcha()
  }
}
function resetPasswordCaptcha() {
  passwordCaptchaToken.value = ''
  passwordCaptchaGeneration.value += 1
}
function onPasswordCodeSent(message: string) {
  passwordMessage.value = message
}
const usernameOpen = ref(false),
  nicknameOpen = ref(false),
  saving = ref(false),
  profileError = ref('')
const username = ref(''),
  nickname = ref(''),
  avatarCropper = ref<InstanceType<typeof ImageCropDialog> | null>(null)
const twoFactorMode = ref<'setup' | 'disable'>('setup'),
  twoFactorOpen = ref(false),
  twoFactorBusy = ref(false),
  twoFactorError = ref(''),
  twoFactorPassword = ref(''),
  twoFactorCode = ref(''),
  twoFactorSetup = ref<{ secret: string; otpauthUrl: string } | null>(null),
  twoFactorQr = ref('')
const twoFactorEnabled = computed(() => site.user.value?.twoFactorEnabled ?? false)
const twoFactorDialogTitle = computed(() =>
  twoFactorMode.value === 'disable' ? '关闭两步验证' : '开启两步验证',
)
function openTwoFactor(mode: 'setup' | 'disable') {
  twoFactorMode.value = mode
  twoFactorPassword.value = ''
  twoFactorCode.value = ''
  twoFactorSetup.value = null
  twoFactorQr.value = ''
  twoFactorError.value = ''
  twoFactorOpen.value = true
}
async function saveTwoFactor() {
  twoFactorBusy.value = true
  twoFactorError.value = ''
  try {
    if (twoFactorMode.value === 'setup' && !twoFactorSetup.value) {
      const setup = await api<{ secret: string; otpauthUrl: string }>('/api/me/totp/setup', {
        method: 'POST',
        token: site.token.value,
        body: { password: twoFactorPassword.value },
      })
      const qr = await QRCode.toDataURL(setup.otpauthUrl, {
        width: 200,
        margin: 2,
        errorCorrectionLevel: 'M',
      })
      twoFactorSetup.value = setup
      twoFactorQr.value = qr
      twoFactorPassword.value = ''
      return
    }
    const path = twoFactorMode.value === 'setup' ? '/api/me/totp/enable' : '/api/me/totp/disable'
    const result = await api<{ token: string }>(path, {
      method: 'POST',
      token: site.token.value,
      body:
        twoFactorMode.value === 'setup'
          ? { code: twoFactorCode.value }
          : { password: twoFactorPassword.value, code: twoFactorCode.value },
    })
    await site.authenticate({ token: result.token, user: site.user.value! })
    twoFactorOpen.value = false
    site.notify(twoFactorMode.value === 'setup' ? '两步验证已启用' : '两步验证已关闭')
  } catch (cause) {
    twoFactorError.value = (cause as Error).message
  } finally {
    twoFactorBusy.value = false
  }
}
const usernameChangeDate = computed(() => {
  const availableAt = site.user.value?.usernameChangeAvailableAt
  return availableAt
    ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
        new Date(availableAt),
      )
    : ''
})
function editUsername() {
  username.value = site.user.value!.username
  profileError.value = ''
  usernameOpen.value = true
}
async function saveUsername() {
  saving.value = true
  profileError.value = ''
  try {
    await api('/api/me/profile', {
      method: 'PATCH',
      token: site.token.value,
      body: { username: username.value },
    })
    await site.refreshUser()
    usernameOpen.value = false
    site.notify('用户名已更新')
  } catch (cause) {
    profileError.value = (cause as Error).message
  } finally {
    saving.value = false
  }
}
function editNickname() {
  nickname.value = site.user.value!.displayName
  profileError.value = ''
  nicknameOpen.value = true
}
async function saveNickname() {
  saving.value = true
  profileError.value = ''
  try {
    await api('/api/me/profile', {
      method: 'PATCH',
      token: site.token.value,
      body: { displayName: nickname.value },
    })
    await site.refreshUser()
    emit('updated')
    nicknameOpen.value = false
    site.notify('昵称已更新')
  } catch (cause) {
    profileError.value = (cause as Error).message
  } finally {
    saving.value = false
  }
}
function editAvatar() {
  profileError.value = ''
  avatarCropper.value?.choose()
}
async function saveAvatar(file: File) {
  saving.value = true
  profileError.value = ''
  try {
    await api('/api/me/avatar', {
      method: 'POST',
      token: site.token.value,
      body: uploadForm(file),
    })
    await site.refreshUser()
    emit('updated')
    avatarCropper.value?.close()
    site.notify('头像已更新')
  } catch (cause) {
    profileError.value = (cause as Error).message
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <div v-if="showActions && site.user.value && !site.user.value.isBanned" class="profile-management-list">
    <section class="surface-card setting-row">
      <div>
        <h2>头像</h2>
        <PersonPicture
          :DisplayName="site.user.value.displayName"
          :ProfilePicture="site.user.value.avatarUrl || undefined"
          :Width="64"
          :Height="64"
          :MinWidth="64"
          :MinHeight="64"
        />
      </div>
      <WinButton label="上传头像" icon="image" @click="editAvatar" />
    </section>
    <section class="surface-card setting-row">
      <div>
        <h2>昵称</h2>
        <p class="secondary-text">{{ site.user.value.displayName }}</p>
      </div>
      <WinButton label="更改昵称" icon="edit" @click="editNickname" />
    </section>
    <section class="surface-card setting-row">
      <div>
        <h2>用户名</h2>
        <p class="secondary-text">@{{ site.user.value.username }}</p>
      </div>
      <WinButton label="更改用户名" icon="edit" @click="editUsername" />
    </section>
    <section class="surface-card setting-row">
      <div><h2>密码</h2></div>
      <WinButton label="更改密码" icon="lock" @click="editPassword" />
    </section>
    <section class="surface-card setting-row two-factor-row">
      <div>
        <h2>两步验证</h2>
        <p class="secondary-text">
          {{ twoFactorEnabled ? '登录时需要输入身份验证器验证码。' : '使用身份验证器验证码保护账号登录。' }}
        </p>
      </div>
      <WinButton
        :label="twoFactorEnabled ? '关闭两步验证' : '开启两步验证'"
        icon="lock"
        @click="openTwoFactor(twoFactorEnabled ? 'disable' : 'setup')"
      />
    </section>
  </div>
  <WinDialog
    v-model:open="usernameOpen"
    title="更改用户名"
    primary="保存"
    :busy="saving"
    :error="profileError"
    @primary="saveUsername"
  >
    <TextBox
      v-model:Text="username"
      Header="用户名"
      aria-label="用户名"
      :MaxLength="32"
      :IsEnabled="!saving"
    />
    <p class="field-hint">3–32 位字母、数字、下划线、点或连字符，用于登录。</p>
    <p class="field-hint">
      180 天内仅可修改一次，管理用户组成员除外。<template v-if="usernameChangeDate"
        >下次可修改日期：{{ usernameChangeDate }}。</template
      >
    </p>
  </WinDialog>
  <WinDialog
    v-model:open="passwordOpen"
    title="更改密码"
    primary="更改密码"
    :busy="saving"
    :error="profileError"
    @primary="changePassword"
  >
    <p>验证码将发送到 {{ site.user.value?.email }}。</p>
    <EmailCodeInput
      v-model="passwordCode"
      purpose="password_change"
      :token="site.token.value"
      :turnstile-token="passwordCaptchaToken"
      :captcha-required="site.settings.turnstile.enabled"
      :disabled="saving"
      @error="profileError = $event"
      @sent="onPasswordCodeSent"
      @used="resetPasswordCaptcha"
    />
    <TurnstileWidget
      v-if="site.settings.turnstile.enabled && passwordOpen"
      :key="passwordCaptchaGeneration"
      :site-key="site.settings.turnstile.siteKey"
      action="password-change"
      @verified="passwordCaptchaToken = $event"
      @error="profileError = $event"
    />
    <InfoBar
      v-if="passwordMessage"
      :IsOpen="true"
      :Message="passwordMessage"
      Severity="Success"
      :IsClosable="false"
    />
    <PasswordBox v-model:Password="newPassword" Header="新密码" autocomplete="new-password" /><PasswordBox
      v-model:Password="confirmPassword"
      Header="确认新密码"
      autocomplete="new-password"
    />
    <p class="field-hint">
      密码需为 10–128 位，每 {{ site.settings.emailSecurity.passwordChangeSeconds }} 秒最多更改一次。
    </p>
  </WinDialog>
  <WinDialog
    v-model:open="nicknameOpen"
    title="更改昵称"
    primary="保存"
    :busy="saving"
    :error="profileError"
    @primary="saveNickname"
  >
    <TextBox v-model:Text="nickname" Header="昵称" aria-label="昵称" :MaxLength="48" :IsEnabled="!saving" />
  </WinDialog>
  <ImageCropDialog
    ref="avatarCropper"
    v-bind="imageCropPresets.avatar"
    title="裁剪头像"
    primary="保存头像"
    :busy="saving"
    :error="profileError"
    @selected="profileError = ''"
    @confirm="saveAvatar"
  />
  <WinDialog
    v-model:open="twoFactorOpen"
    :title="twoFactorDialogTitle"
    :primary="
      twoFactorSetup && twoFactorMode === 'setup'
        ? '启用两步验证'
        : twoFactorMode === 'disable'
          ? '关闭两步验证'
          : '继续'
    "
    :busy="twoFactorBusy"
    :error="twoFactorError"
    @primary="saveTwoFactor"
  >
    <template v-if="twoFactorMode === 'setup' && !twoFactorSetup">
      <p>输入当前密码以生成绑定二维码。</p>
      <PasswordBox v-model:Password="twoFactorPassword" Header="当前密码" autocomplete="current-password" />
    </template>
    <template v-else-if="twoFactorMode === 'setup'">
      <p>用身份验证器扫描二维码，再输入应用显示的验证码。</p>
      <img class="two-factor-qr" :src="twoFactorQr" alt="身份验证器绑定二维码" />
      <details>
        <summary class="field-hint">无法扫描？手动输入密钥</summary>
        <code class="two-factor-secret">{{ twoFactorSetup?.secret }}</code>
      </details>
      <TextBox
        v-model:Text="twoFactorCode"
        Header="身份验证器验证码"
        aria-label="身份验证器验证码"
        :MaxLength="6"
        inputmode="numeric"
        autocomplete="one-time-code"
      />
    </template>
    <template v-else>
      <p>输入当前密码和身份验证器中的 6 位验证码以关闭保护。</p>
      <PasswordBox v-model:Password="twoFactorPassword" Header="当前密码" autocomplete="current-password" />
      <TextBox
        v-model:Text="twoFactorCode"
        Header="身份验证器验证码"
        aria-label="身份验证器验证码"
        :MaxLength="6"
        inputmode="numeric"
        autocomplete="one-time-code"
      />
    </template>
  </WinDialog>
</template>

<style scoped>
.two-factor-row {
  align-items: center;
}
.two-factor-qr {
  display: block;
  width: 200px;
  height: 200px;
  max-width: 100%;
  margin: 0 auto;
  padding: 8px;
  background: white;
  image-rendering: pixelated;
}
.two-factor-secret {
  display: block;
  margin-top: 8px;
  overflow-wrap: anywhere;
  user-select: all;
}
</style>
