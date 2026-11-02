<script setup lang="ts">
import { postPath } from '../utils'
import { computed, ref, watch } from 'vue'
import { InfoBar, NumberBox } from 'winuionweb'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useSite } from '../site'
import { useResource } from '../composables/useResource'
import type { PageParameter, PostFeedPage, User } from '../types'
import PageHeader from '../components/ui/PageHeader.vue'
import ResourceState from '../components/ui/ResourceState.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import WinButton from '../components/ui/WinButton.vue'
import SelectorSwitch from '../components/ui/SelectorSwitch.vue'
import SelectorPage from '../components/ui/SelectorPage.vue'
import PostListItem from '../components/PostListItem.vue'
import FollowButton from '../components/FollowButton.vue'
import UserProfileDetails from '../components/UserProfileDetails.vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ Parameter: PageParameter }>()
const router = useRouter(),
  site = useSite(),
  tab = ref('posts')
const requestedPage = Math.max(1, Number(props.Parameter.query.page) || 1)
const jump = ref(requestedPage)
const { data, loading, error, reload } = useResource(
  () =>
    api<
      PostFeedPage & {
        user: {
          uuid: string
          experience: number
          level: number
          title: User['title']
          groups: User['groups']
          uid: string
          username: string
          display_name: string
          avatar_url: string | null
          following: boolean
          follower_count: number
          banned_until: string | null
        }
        folders: Array<{ id: string; name: string; post_count: number }>
      }
    >(`/api/users/${props.Parameter.id}?page=${requestedPage}`, { token: site.token.value }),
  null,
)
const profile = computed<User | null>(() =>
  data.value
    ? {
        uid: data.value.user.uid,
        uuid: data.value.user.uuid,
        username: data.value.user.username,
        displayName: data.value.user.display_name,
        avatarUrl: data.value.user.avatar_url,
        experience: data.value.user.experience,
        level: data.value.user.level,
        title: data.value.user.title,
        groups: data.value.user.groups,
        followerCount: data.value.user.follower_count,
      }
    : null,
)
const banMessage = computed(() => {
  if (!data.value?.user.banned_until) return ''
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(data.value.user.banned_until))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)!.value
  return `该用户已被封禁至${part('year')}-${part('month')}-${part('day')}-${part('hour')}:${part('minute')}`
})
watch(site.token, reload)
watch(data, (value) => {
  jump.value = value?.page ?? 1
})
function goPage(page: number) {
  if (loading.value || !data.value || !Number.isInteger(page) || page < 1 || page > data.value.totalPages)
    return
  void router.push({
    path: props.Parameter.path,
    query: { ...props.Parameter.query, page: String(page) },
  })
}
function jumpByKeyboard(event: KeyboardEvent) {
  if (!(event.target instanceof HTMLInputElement)) return
  event.preventDefault()
  goPage(Number(event.target.value))
}
async function followChanged(following: boolean) {
  if (data.value) data.value.user.following = following
  await reload()
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="用户空间"
        ><WinButton label="返回社区" icon="back" @click="router.push('/home')"
      /></PageHeader>
      <ResourceState :loading="loading" :error="error" />
      <template v-if="data">
        <InfoBar
          v-if="banMessage"
          :IsOpen="true"
          Severity="Error"
          :IsClosable="false"
          :Message="banMessage"
        />
        <UserProfileDetails v-if="profile" :user="profile"
          ><template #action
            ><FollowButton
              :uid="data.user.uid"
              :following="data.user.following"
              @changed="followChanged"
              @error="error = $event" /></template
        ></UserProfileDetails>
        <div class="section-toolbar">
          <SelectorSwitch
            v-model="tab"
            aria-label="用户空间内容类型"
            :options="[
              { value: 'posts', label: '已发布的帖子' },
              { value: 'folders', label: '公开收藏夹' },
            ]"
          />
        </div>
        <SelectorPage :selected="tab">
          <template v-if="tab === 'posts'"
            ><EmptyState v-if="!data.posts.length" title="暂无可阅读的帖子" icon="chat" />
            <section v-for="post in data.posts" :key="post.id" class="surface-card favorite-post">
              <PostListItem :item="post" @click="router.push(postPath(post))" />
            </section>
            <nav v-if="!error && data.totalPages > 1" class="feed-pagination" aria-label="帖子翻页">
              <div class="feed-page-controls">
                <WinButton
                  label="上一页"
                  :disabled="loading || data.page <= 1"
                  @click="goPage(data.page - 1)"
                />
                <span aria-live="polite"
                  >第 {{ data.page }} / {{ data.totalPages }} 页 · 每页 {{ data.pageSize }} 篇</span
                >
                <WinButton
                  label="下一页"
                  :disabled="loading || data.page >= data.totalPages"
                  @click="goPage(data.page + 1)"
                />
              </div>
              <div class="feed-page-jump" @keydown.enter.capture="jumpByKeyboard">
                <span>跳至</span>
                <NumberBox
                  v-model:Value="jump"
                  :Minimum="1"
                  :Maximum="data.totalPages"
                  :SmallChange="1"
                  SpinButtonPlacementMode="Hidden"
                  AutomationProperties.Name="帖子页码"
                />
                <WinButton
                  label="跳转"
                  :disabled="loading || !Number.isInteger(jump) || jump < 1 || jump > data.totalPages"
                  @click="goPage(jump)"
                />
              </div></nav
          ></template>
          <template v-else
            ><EmptyState v-if="!data.folders.length" title="暂无公开收藏夹" icon="favorite" />
            <section v-for="folder in data.folders" :key="folder.id" class="surface-card setting-row">
              <div>
                <h2>{{ folder.name }}</h2>
                <p class="secondary-text">{{ folder.post_count }} 篇可阅读的收藏</p>
              </div>
              <WinButton label="打开收藏夹" @click="router.push(`/favorites/${folder.id}`)" /></section
          ></template>
        </SelectorPage>
      </template>
    </div>
  </div>
</template>
