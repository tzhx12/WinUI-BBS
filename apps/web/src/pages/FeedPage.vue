<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Button, FontIcon, InfoBar, ListView, ProgressRing } from 'winuionweb'
import { api } from '../api'
import { useResource } from '../composables/useResource'
import { useSite } from '../site'
import type { PageParameter, PostSummary } from '../types'
import { itemTemplate } from '../utils'
import PageHeader from '../components/ui/PageHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import WinButton from '../components/ui/WinButton.vue'
import WinSelect from '../components/ui/WinSelect.vue'
import IconGlyph from '../components/IconGlyph.vue'
import PostListItem from '../components/PostListItem.vue'
import MemberCard from '../components/MemberCard.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ Parameter: PageParameter }>()
const site = useSite()
const router = useRouter()
const category = computed(() => site.categories.value.find((item) => item.id === props.Parameter.id))
const isSearch = props.Parameter.path === '/search'
const searchTerm = (props.Parameter.query.q || '').trim()
const isPopular = props.Parameter.path === '/popular'
const sort = ref(isPopular ? 'popular' : 'latest')
const title = computed(() =>
  isSearch ? '搜索结果' : category.value?.name || (sort.value === 'popular' ? '热门讨论' : '社区首页'),
)
const roots = computed(() =>
  site.categories.value.filter((item) => item.parent_id === (category.value?.id || null)),
)
const {
  data: posts,
  loading,
  error,
  reload,
} = useResource(async () => {
  if (isSearch && !searchTerm) return []
  const params = new URLSearchParams({ sort: sort.value })
  if (props.Parameter.path !== '/home') params.set('followingFirst', 'false')
  if (props.Parameter.id) params.set('category', props.Parameter.id)
  if (isSearch) params.set('q', searchTerm)
  return api<PostSummary[]>(`/api/posts?${params}`, { token: site.token.value })
}, [])
watch([sort, site.token], reload)
const template = itemTemplate(PostListItem)
function openPost(_sender: unknown, args: { ClickedItem: PostSummary }) {
  void router.push(`/post/${args.ClickedItem.id}`)
}
function compose() {
  if (!site.user.value) site.authOpen.value = true
  else void router.push({ path: '/compose', query: { category: category.value?.id } })
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader
        :title="title"
        :description="
          isSearch
            ? searchTerm
              ? `“${searchTerm}” 的搜索结果`
              : '输入关键词查找社区帖子。'
            : category?.description || '浏览社区中的新话题，参与感兴趣的讨论。'
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
      <div v-if="roots.length && !isSearch && !isPopular" class="category-grid">
        <Button
          v-for="item in roots"
          :key="item.id"
          HorizontalContentAlignment="Stretch"
          class="category-tile"
          @Click="router.push(`/category/${item.id}`)"
        >
          <div class="category-tile-content">
            <span class="category-tile-icon"
              ><FontIcon :Glyph="item.icon_glyph" FontFamily="Segoe Fluent Icons" :FontSize="23"
            /></span>
            <div>
              <strong>{{ item.name }}</strong>
              <p v-if="item.description">{{ item.description }}</p>
              <small
                >{{ item.post_count || 0 }} 个帖子<span v-if="item.minimum_reader_level">
                  · Lv.{{ item.minimum_reader_level }}+</span
                ></small
              >
            </div>
            <IconGlyph name="arrow" :size="14" />
          </div>
        </Button>
      </div>
      <div class="feed-layout">
        <section class="feed-section">
          <div class="section-toolbar">
            <h2>
              {{ isSearch ? '匹配的帖子' : '帖子' }} <span class="count">{{ posts.length }}</span>
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
          <ListView
            v-else
            :ItemsSource="posts"
            :ItemTemplate="template"
            :IsItemClickEnabled="true"
            SelectionMode="None"
            :ItemContainerStyle="{ Padding: '0', HorizontalContentAlignment: 'Stretch' }"
            class="post-list"
            @ItemClick="openPost"
          />
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
              <span class="category-label"
                ><i :style="{ background: item.accent_color }" />{{ item.name }}</span
              ><span class="secondary-text">{{ item.post_count || 0 }}</span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  </div>
</template>
