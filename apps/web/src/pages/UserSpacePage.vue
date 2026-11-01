<script setup lang="ts">
import { postPath } from '../utils'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useSite } from '../site'
import { useResource } from '../composables/useResource'
import type { PageParameter, PostSummary, User } from '../types'
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
const { data, loading, error, reload } = useResource(
  () =>
    api<{
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
      }
      posts: PostSummary[]
      folders: Array<{ id: string; name: string; post_count: number }>
    }>(`/api/users/${props.Parameter.id}`, { token: site.token.value }),
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
watch(site.token, reload)
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
              <PostListItem :item="post" @click="router.push(postPath(post))" /></section
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
