<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { InfoBar, PasswordBox, PersonPicture, TextBox } from 'winuionweb'
import { api, uploadForm } from '../api'
import { useSite } from '../site'
import WinButton from './ui/WinButton.vue'
import WinDialog from './ui/WinDialog.vue'
import EmailCodeInput from './EmailCodeInput.vue'

defineOptions({ inheritAttrs: false })
const site = useSite()
withDefaults(defineProps<{ showActions?: boolean }>(), { showActions: false })
const emit = defineEmits<{ updated: [] }>()
defineExpose({ editAvatar, editNickname })
const passwordOpen = ref(false),
  newPassword = ref(''),
  confirmPassword = ref(''),
  passwordCode = ref(''),
  passwordMessage = ref('')
function editPassword() {
  newPassword.value = ''
  confirmPassword.value = ''
  passwordCode.value = ''
  passwordMessage.value = ''
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
      body: { password: newPassword.value, code: passwordCode.value },
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
  }
}
const usernameOpen = ref(false),
  nicknameOpen = ref(false),
  avatarOpen = ref(false),
  saving = ref(false),
  profileError = ref('')
const username = ref(''),
  nickname = ref(''),
  avatarInput = ref<HTMLInputElement | null>(null),
  avatarFile = ref<File | null>(null),
  avatarPreview = ref('')
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
function clearAvatar() {
  if (avatarPreview.value) URL.revokeObjectURL(avatarPreview.value)
  avatarPreview.value = ''
  avatarFile.value = null
  if (avatarInput.value) avatarInput.value.value = ''
}
function editAvatar() {
  clearAvatar()
  profileError.value = ''
  avatarOpen.value = true
}
function selectAvatar(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (avatarPreview.value) URL.revokeObjectURL(avatarPreview.value)
  avatarFile.value = file
  avatarPreview.value = URL.createObjectURL(file)
  profileError.value = ''
}
async function saveAvatar() {
  if (!avatarFile.value) return
  saving.value = true
  profileError.value = ''
  try {
    await api('/api/me/avatar', {
      method: 'POST',
      token: site.token.value,
      body: uploadForm(avatarFile.value),
    })
    await site.refreshUser()
    emit('updated')
    avatarOpen.value = false
    site.notify('头像已更新')
  } catch (cause) {
    profileError.value = (cause as Error).message
  } finally {
    saving.value = false
  }
}
onBeforeUnmount(clearAvatar)
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
      :disabled="saving"
      @error="profileError = $event"
      @sent="passwordMessage = $event"
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
    <TextBox
      v-model:Text="nickname"
      Header="昵称"
      aria-label="昵称"
      :MaxLength="48"
      :IsEnabled="!saving"
    />
  </WinDialog>
  <WinDialog
    v-model:open="avatarOpen"
    title="上传头像"
    primary="保存头像"
    :busy="saving || !avatarFile"
    :error="profileError"
    @primary="saveAvatar"
    @closed="clearAvatar"
  >
    <div class="avatar-upload-preview">
      <PersonPicture
        :DisplayName="site.user.value?.displayName"
        :ProfilePicture="avatarPreview || site.user.value?.avatarUrl || undefined"
        :Width="96"
        :Height="96"
      />
    </div>
    <WinButton label="选择图片" icon="image" :disabled="saving" @click="avatarInput?.click()" />
    <input
      ref="avatarInput"
      type="file"
      class="visually-hidden"
      accept="image/png,image/jpeg,image/webp,image/gif"
      @change="selectAvatar"
    />
    <p v-if="avatarFile" class="file-selection">{{ avatarFile.name }}</p>
  </WinDialog>
</template>
