<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { InfoBar, ListView, PasswordBox, PersonPicture, TextBox } from 'winuionweb'
import { api, uploadForm } from '../api'
import { useResource } from '../composables/useResource'
import { useSite } from '../site'
import type { PostSummary } from '../types'
import { itemTemplate } from '../utils'
import PageHeader from '../components/ui/PageHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import ResourceState from '../components/ui/ResourceState.vue'
import WinButton from '../components/ui/WinButton.vue'
import PostListItem from '../components/PostListItem.vue'
import WinDialog from '../components/ui/WinDialog.vue'
import EmailCodeInput from '../components/EmailCodeInput.vue'

defineOptions({ inheritAttrs: false })
const site = useSite()
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
const router = useRouter()
const {
  data: posts,
  loading,
  error,
  reload,
  run,
} = useResource(() => api<PostSummary[]>('/api/me/posts', { token: site.token.value }), [])
const filter = ref<'all' | 'published' | 'pending' | 'hidden' | 'rejected'>('all')
const filtered = computed(() =>
  filter.value === 'all'
    ? posts.value
    : posts.value.filter((post) => (post as PostSummary & { status?: string }).status === filter.value),
)
const template = computed(() =>
  itemTemplate(PostListItem, 'item', { canDelete: !site.user.value?.isBanned, onDelete: trashPost }),
)
async function trashPost(post: PostSummary) {
  if (!(await site.confirm(`删除“${post.title}”？`, '帖子将移入仅自己可见的回收站。', '移入回收站'))) return
  if (
    await run(
      () => api(`/api/me/posts/${post.id}`, { method: 'DELETE', token: site.token.value }),
      '帖子已移入回收站',
    )
  )
    await Promise.all([reload(), site.loadCategories()])
}
function openPost(_sender: unknown, args: { ClickedItem: PostSummary }) {
  window.location.hash = `/post/${args.ClickedItem.id}`
}
function openAppearance() {
  window.location.hash = site.user.value?.permissions?.includes('settings.manage')
    ? '/admin/appearance'
    : '/appearance'
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
    await Promise.all([site.refreshUser(), reload()])
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
    await Promise.all([site.refreshUser(), reload()])
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
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="用户后台" description="查看你的个人资料、等级和发帖记录。"
        ><WinButton label="我的关注" icon="person" @click="router.push('/account/following')" /><WinButton
          label="我的收藏"
          icon="favorite"
          @click="router.push('/account/favorites')" /><WinButton
          label="回收站"
          icon="delete"
          @click="router.push('/account/trash')" /><WinButton
          label="外观设置"
          icon="brush"
          @click="openAppearance"
      /></PageHeader>
      <InfoBar
        v-if="site.user.value?.isBanned"
        :IsOpen="true"
        Message="账号封禁期间仅可浏览，解封后恢复交互。"
        Severity="Warning"
        :IsClosable="false"
      />
      <section class="user-dashboard-summary">
        <div class="surface-card dashboard-profile">
          <div class="profile-identity">
            <PersonPicture
              :DisplayName="site.user?.value?.displayName"
              :ProfilePicture="site.user?.value?.avatarUrl || undefined"
              :Width="64"
              :Height="64"
            />
            <div>
              <h2>{{ site.user?.value?.displayName }}</h2>
              <p class="secondary-text">@{{ site.user?.value?.username }}</p>
              <p class="secondary-text">UID {{ site.user?.value?.uid }} · {{ site.user?.value?.email }}</p>
              <div
                v-if="site.user.value && !site.user.value.isBanned"
                class="row-actions profile-edit-actions"
              >
                <WinButton label="上传头像" icon="image" @click="editAvatar" />
                <WinButton label="更改用户名" icon="edit" @click="editUsername" />
                <WinButton label="更改昵称" icon="edit" @click="editNickname" />
                <WinButton label="更改密码" icon="lock" @click="editPassword" />
              </div>
            </div>
          </div>
          <div class="dashboard-stat">
            <strong>Lv.{{ site.user?.value?.level }}</strong
            ><span>{{ site.user?.value?.experience }} 经验</span>
          </div>
          <div class="dashboard-stat">
            <strong>{{ site.user?.value?.groups?.length || 0 }}</strong
            ><span>用户组</span>
          </div>
          <WinButton label="我的邀请码" icon="mail" @click="router.push('/account/invitations')" />
        </div>
      </section>
      <section class="surface-card dashboard-posts">
        <div class="section-toolbar">
          <h2>
            我的发帖 <span class="count">{{ filtered.length }}</span>
          </h2>
          <div class="dashboard-filters">
            <WinButton label="全部" :accent="filter === 'all'" subtle @click="filter = 'all'" /><WinButton
              label="已发布"
              :accent="filter === 'published'"
              subtle
              @click="filter = 'published'"
            /><WinButton
              label="待审核"
              :accent="filter === 'pending'"
              subtle
              @click="filter = 'pending'"
            /><WinButton label="隐藏" :accent="filter === 'hidden'" subtle @click="filter = 'hidden'" />
            <WinButton label="未通过" :accent="filter === 'rejected'" subtle @click="filter = 'rejected'" />
          </div>
        </div>
        <ResourceState :loading="loading" :error="error" /><EmptyState
          v-if="!loading && !filtered.length"
          title="还没有帖子"
          description="发布一个话题，它会出现在这里。"
          icon="chat"
        /><ListView
          v-else
          :ItemsSource="filtered"
          :ItemTemplate="template"
          SelectionMode="None"
          :IsItemClickEnabled="true"
          :ItemContainerStyle="{ Padding: '0', HorizontalContentAlignment: 'Stretch' }"
          class="post-list"
          @ItemClick="openPost"
        />
      </section>
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
    </div>
  </div>
</template>
