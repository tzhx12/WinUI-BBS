<script setup lang="ts">
import { postPath } from '../utils'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { InfoBar, ListView, PersonPicture } from 'winuionweb'
import { api } from '../api'
import { useResource } from '../composables/useResource'
import { useSite } from '../site'
import type { PostSummary } from '../types'
import { itemTemplate } from '../utils'
import PageHeader from '../components/ui/PageHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import ResourceState from '../components/ui/ResourceState.vue'
import WinButton from '../components/ui/WinButton.vue'
import SelectorSwitch from '../components/ui/SelectorSwitch.vue'
import SelectorPage from '../components/ui/SelectorPage.vue'
import PostListItem from '../components/PostListItem.vue'
import AccountProfileEditor from '../components/AccountProfileEditor.vue'

defineOptions({ inheritAttrs: false })
const site = useSite()
const router = useRouter()
const {
  data: posts,
  loading,
  error,
  reload,
  run,
} = useResource(() => api<PostSummary[]>('/api/me/posts', { token: site.token.value }), [])
const filter = ref<'all' | 'pending' | 'hidden' | 'rejected'>('all')
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
  window.location.hash = postPath(args.ClickedItem)
}
function openAppearance() {
  window.location.hash = site.user.value?.permissions?.includes('settings.manage')
    ? '/admin/appearance'
    : '/appearance'
}
const profileEditor = ref<InstanceType<typeof AccountProfileEditor> | null>(null)
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
            <button
              class="profile-avatar-button"
              type="button"
              aria-label="更换头像"
              title="更换头像"
              :disabled="!site.user.value || site.user.value.isBanned"
              @click="profileEditor?.editAvatar()"
            >
              <PersonPicture
                :DisplayName="site.user.value?.displayName"
                :ProfilePicture="site.user.value?.avatarUrl || undefined"
                :Width="64"
                :Height="64"
              />
            </button>
            <div>
              <div class="profile-name-row">
                <h2>{{ site.user?.value?.displayName }}</h2>
                <WinButton
                  v-if="site.user.value && !site.user.value.isBanned"
                  label="更改昵称"
                  icon="edit"
                  icon-only
                  subtle
                  @click="profileEditor?.editNickname()"
                />
              </div>
              <p class="secondary-text">@{{ site.user?.value?.username }}</p>
              <p class="secondary-text">UID {{ site.user?.value?.uid }} · {{ site.user?.value?.email }}</p>
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
          <div class="row-actions dashboard-profile-actions">
            <WinButton
              label="资料管理"
              icon="person"
              accent
              @click="router.push('/account/profile')"
            /><WinButton label="我的邀请码" icon="mail" @click="router.push('/account/invitations')" />
          </div>
        </div>
      </section>
      <section class="surface-card dashboard-posts">
        <div class="section-toolbar">
          <h2>
            我的发帖 <span class="count">{{ filtered.length }}</span>
          </h2>
          <SelectorSwitch
            v-model="filter"
            aria-label="我的发帖筛选"
            :options="[
              { value: 'all', label: '全部' },
              { value: 'pending', label: '待审核' },
              { value: 'rejected', label: '未通过' },
              { value: 'hidden', label: '隐藏' },
            ]"
          />
        </div>
        <SelectorPage :selected="filter">
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
        </SelectorPage>
      </section>
      <AccountProfileEditor ref="profileEditor" @updated="reload" />
    </div>
  </div>
</template>
