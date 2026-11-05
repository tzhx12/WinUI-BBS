<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { InfoBar, NumberBox, ProgressRing } from 'winuionweb'
import { api } from '../api'
import { useResource } from '../composables/useResource'
import { useSite } from '../site'
import type { PageParameter, PostFeedPage, PostSummary } from '../types'
import { postPath } from '../utils'
import PageHeader from '../components/ui/PageHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import WinButton from '../components/ui/WinButton.vue'
import WinSelect from '../components/ui/WinSelect.vue'
import CommunityHero from '../components/CommunityHero.vue'
import CategoryIcon from '../components/CategoryIcon.vue'
import PostList from '../components/PostList.vue'
import MemberCard from '../components/MemberCard.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ Parameter: PageParameter }>()
const site = useSite()
const router = useRouter()
const category = computed(() =>
  site.categories.value.find((item) => item.slug === props.Parameter.categorySlug),
)
const isSearch = props.Parameter.path === '/search'
const searchTerm = (props.Parameter.query.q || '').trim()
const isPopular = props.Parameter.path === '/popular'
const fixedBackground = computed(() =>
  category.value ? category.value.header_background_url : isPopular ? site.settings.popularBackground : '',
)
const backgroundHeight = computed(() =>
  category.value ? category.value.header_background_height : site.settings.popularBackgroundHeight,
)
const sort = ref(
  props.Parameter.query.sort === 'popular' || (!props.Parameter.query.sort && isPopular)
    ? 'popular'
    : 'latest',
)
const requestedPage = Math.max(1, Number(props.Parameter.query.page) || 1)
const jump = ref(requestedPage)
const title = computed(() =>
  isSearch
    ? '搜索结果'
    : category.value
      ? category.value.name
      : isPopular
        ? site.settings.homeContent.popularTitle
        : site.settings.homeContent.homeTitle,
)
const roots = computed(() =>
  site.categories.value.filter((item) => item.parent_id === (category.value?.id || null)),
)
const { data, loading, error, reload } = useResource(
  async () => {
    if (isSearch && !searchTerm) return { posts: [], page: 1, pageSize: 20, total: 0, totalPages: 1 }
    const params = new URLSearchParams({ sort: sort.value })
    if (props.Parameter.path !== '/home') params.set('followingFirst', 'false')
    if (props.Parameter.categorySlug) {
      if (!category.value) throw new Error('板块不存在')
      params.set('category', category.value.id)
    }
    if (isSearch) {
      params.set('q', searchTerm)
      const posts = await api<PostSummary[]>(`/api/posts?${params}`, { token: site.token.value })
      return { posts, page: 1, pageSize: posts.length, total: posts.length, totalPages: 1 }
    }
    params.set('page', String(requestedPage))
    return api<PostFeedPage>(`/api/posts?${params}`, { token: site.token.value })
  },
  { posts: [], page: 1, pageSize: 20, total: 0, totalPages: 1 } as PostFeedPage,
)
const posts = computed(() => data.value.posts)
watch(site.token, reload)
watch(sort, () => {
  void router.push({
    path: props.Parameter.path,
    query: { ...props.Parameter.query, sort: sort.value, page: undefined },
  })
})
watch(data, (value) => {
  jump.value = value.page
})
function goPage(page: number) {
  if (loading.value || !Number.isInteger(page) || page < 1 || page > data.value.totalPages) return
  void router.push({
    path: props.Parameter.path,
    query: { ...props.Parameter.query, sort: sort.value, page: String(page) },
  })
}
function jumpByKeyboard(event: KeyboardEvent) {
  if (!(event.target instanceof HTMLInputElement)) return
  event.preventDefault()
  goPage(Number(event.target.value))
}
function openPost(post: PostSummary) {
  void router.push(postPath(post))
}
function compose() {
  if (!site.user.value) site.authOpen.value = true
  else void router.push({ path: '/compose', query: { category: category.value?.id } })
}
</script>
<template>
  <div
    class="page-scroll"
    :class="{ 'community-page': category || isPopular }"
    :style="category || isPopular ? { '--community-background-height': `${backgroundHeight}cqh` } : undefined"
  >
    <div v-if="fixedBackground" class="community-page-background" aria-hidden="true">
      <img :src="fixedBackground" alt="" />
    </div>
    <div class="page-content">
      <CommunityHero
        v-if="!isSearch && !isPopular"
        :title="title"
        :description="category ? category.description : site.settings.homeContent.homeDescription"
        :background="category ? undefined : site.settings.homeBackground"
        :categories="roots"
        :category="category"
        @compose="compose"
      />
      <PageHeader
        v-else
        :icon="isPopular ? 'fire' : undefined"
        :title="title"
        :description="
          isSearch
            ? searchTerm
              ? `“${searchTerm}” 的搜索结果`
              : '输入关键词查找社区帖子。'
            : site.settings.homeContent.popularDescription
        "
      >
        <WinButton
          v-if="!isPopular"
          label="发布帖子"
          icon="add"
          accent
          :disabled="site.user.value?.isBanned"
          @click="compose"
        />
      </PageHeader>
      <div class="feed-layout">
        <section class="feed-section">
          <div class="section-toolbar">
            <h2>
              {{ isSearch ? '匹配的帖子' : '帖子' }} <span class="count">{{ data.total }}</span>
            </h2>
            <WinSelect
              v-model="sort"
              label="排序"
              :options="[
                { value: 'latest', label: '最新发布' },
                { value: 'popular', label: '最多讨论' },
              ]"
            />
          </div>
          <InfoBar :IsOpen="true" v-if="error" :Message="error" Severity="Error" :IsClosable="false" />
          <div v-else-if="loading" class="loading-state">
            <ProgressRing :IsActive="true" :Width="28" :Height="28" /><span>正在加载帖子</span>
          </div>
          <EmptyState
            v-else-if="!posts.length"
            :title="isSearch ? (searchTerm ? '没有找到相关帖子' : '请输入搜索关键词') : '还没有帖子'"
            :description="
              isSearch
                ? searchTerm
                  ? '试试其他关键词。'
                  : '在标题栏输入想查找的帖子。'
                : isPopular
                  ? ''
                  : '发布第一个帖子，开始讨论。'
            "
            ><WinButton v-if="!isSearch && !isPopular" label="发布帖子" icon="add" @click="compose"
          /></EmptyState>
          <PostList v-else :posts="posts" @open="openPost" />
          <nav
            v-if="!isSearch && !error && data.totalPages > 1"
            class="feed-pagination"
            aria-label="帖子翻页"
          >
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
            </div>
          </nav>
        </section>
        <aside class="feed-aside">
          <MemberCard />
          <section class="surface-card">
            <h2>社区板块</h2>
            <div
              v-for="item in site.categories.value.filter((c) => !c.parent_id)"
              :key="item.id"
              class="compact-row"
            >
              <span class="category-label"><CategoryIcon :category="item" :size="16" />{{ item.name }}</span
              ><span class="secondary-text">{{ item.post_count || 0 }}</span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  </div>
</template>
