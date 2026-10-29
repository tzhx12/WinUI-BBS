<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { PersonPicture } from 'winuionweb'
import { api } from '../api'
import { useSite } from '../site'
import { useResource } from '../composables/useResource'
import type { PageParameter, PostSummary } from '../types'
import PageHeader from '../components/ui/PageHeader.vue'
import ResourceState from '../components/ui/ResourceState.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import WinButton from '../components/ui/WinButton.vue'
import PostListItem from '../components/PostListItem.vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ Parameter: PageParameter }>()
const router = useRouter(),
  site = useSite(),
  tab = ref('posts')
const { data, loading, error } = useResource(
  () =>
    api<{
      user: { uid: string; username: string; display_name: string; avatar_url: string | null }
      posts: PostSummary[]
      folders: Array<{ id: string; name: string; post_count: number }>
    }>(`/api/users/${props.Parameter.id}`, { token: site.token.value }),
  null,
)
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="用户空间"
        ><WinButton label="返回社区" icon="back" @click="router.push('/home')"
      /></PageHeader>
      <ResourceState :loading="loading" :error="error" />
      <template v-if="data"
        ><section class="surface-card profile-identity">
          <PersonPicture
            :DisplayName="data.user.display_name"
            :ProfilePicture="data.user.avatar_url || undefined"
            :Width="64"
            :Height="64"
          />
          <div>
            <h1>{{ data.user.display_name }}</h1>
            <p class="secondary-text">@{{ data.user.username }} · UID {{ data.user.uid }}</p>
          </div>
        </section>
        <div class="section-toolbar">
          <div class="row-actions">
            <WinButton label="已发布的帖子" :accent="tab === 'posts'" @click="tab = 'posts'" /><WinButton
              label="公开收藏夹"
              :accent="tab === 'folders'"
              @click="tab = 'folders'"
            />
          </div>
        </div>
        <template v-if="tab === 'posts'"
          ><EmptyState v-if="!data.posts.length" title="暂无可阅读的帖子" icon="chat" />
          <section v-for="post in data.posts" :key="post.id" class="surface-card favorite-post">
            <PostListItem :item="post" @click="router.push(`/post/${post.id}`)" /></section
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
      </template>
    </div>
  </div>
</template>
