<script setup lang="ts">
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useSite } from '../site'
import { useResource } from '../composables/useResource'
import UserAvatar from '../components/UserAvatar.vue'
import FollowButton from '../components/FollowButton.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import ResourceState from '../components/ui/ResourceState.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import WinButton from '../components/ui/WinButton.vue'

defineOptions({ inheritAttrs: false })
interface FollowedUser {
  uid: string
  username: string
  display_name: string
  avatar_url: string | null
}
const site = useSite(),
  router = useRouter()
const { data, loading, error, reload } = useResource(
  () =>
    site.user.value
      ? api<FollowedUser[]>('/api/me/following', { token: site.token.value })
      : Promise.resolve([]),
  [],
)
watch(site.token, reload)
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="我的关注" description="关注的作者和他们的社区空间。">
        <WinButton label="返回用户后台" icon="back" @click="router.push('/account')" />
      </PageHeader>
      <EmptyState v-if="!site.user.value" title="登录后查看我的关注" icon="person">
        <WinButton label="登录" accent @click="site.authOpen.value = true" />
      </EmptyState>
      <template v-else>
        <ResourceState :loading="loading" :error="error" />
        <EmptyState
          v-if="!loading && !error && !data.length"
          title="还没有关注的用户"
          description="在帖子作者旁点击关注，即可在这里找到他们。"
          icon="person"
        />
        <section v-else-if="data.length" class="following-list" aria-label="关注的用户">
          <article v-for="user in data" :key="user.uid" class="surface-card following-user">
            <UserAvatar :uid="user.uid" :name="user.display_name" :url="user.avatar_url" />
            <div class="following-identity">
              <RouterLink :to="`/users/${user.uid}`">{{ user.display_name }}</RouterLink>
              <p class="secondary-text">
                <span>@{{ user.username }}</span
                ><span>UID {{ user.uid }}</span>
              </p>
            </div>
            <FollowButton :uid="user.uid" :following="true" @changed="reload" @error="error = $event" />
          </article>
        </section>
      </template>
    </div>
  </div>
</template>
