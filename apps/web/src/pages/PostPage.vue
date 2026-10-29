<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { InfoBar, ProgressRing, ToggleButton } from 'winuionweb'
import { api } from '../api'
import { useResource } from '../composables/useResource'
import { useSite } from '../site'
import type { EditorData, PageParameter, PostSummary } from '../types'
import { formatDate, formatDateTime } from '../utils'
import EditorComposer from '../components/EditorComposer.vue'
import PostBody from '../components/PostBody.vue'
import IconGlyph from '../components/IconGlyph.vue'
import WinButton from '../components/ui/WinButton.vue'
import UserAvatar from '../components/UserAvatar.vue'
import FavoriteButton from '../components/FavoriteButton.vue'
defineOptions({ inheritAttrs: false })
interface Detail {
  post: PostSummary
  replies: Array<{
    id: string
    body: EditorData
    display_name: string
    author_uid: string
    avatar_url: string | null
    created_at: string
  }>
  likeCount: number
  liked: boolean
  totalReplyCount: number
  page: number
  pageSize: number
  totalPages: number
}
const props = defineProps<{ Parameter: PageParameter }>()
const site = useSite(),
  router = useRouter()
const isTrash = props.Parameter.path.startsWith('/account/trash/')
const page = ref(1)
const likeButton = ref<InstanceType<typeof ToggleButton> | null>(null)
const { data, loading, error, saving, reload, run } = useResource<Detail | null>(
  () =>
    api(`${isTrash ? '/api/me/trash' : '/api/posts'}/${props.Parameter.id}?page=${page.value}`, {
      token: site.token.value,
    }),
  null,
)
const replyEditor = ref<InstanceType<typeof EditorComposer> | null>(null)
const editorVersion = ref(0)
const isPublic = computed(() => ['published', 'hidden'].includes(data.value?.post.status || ''))
const canReply = computed(
  () => !isTrash && isPublic.value && site.user.value?.permissions?.includes('replies.create'),
)
watch(site.token, reload)
async function goPage(value: number) {
  page.value = value
  await reload()
}
async function like() {
  if (!site.user.value) {
    site.authOpen.value = true
    if (likeButton.value) likeButton.value.IsChecked = false
    return
  }
  if (
    await run(() => api(`/api/posts/${props.Parameter.id}/like`, { method: 'POST', token: site.token.value }))
  )
    await reload()
  await nextTick()
  if (likeButton.value) likeButton.value.IsChecked = data.value?.liked ?? false
}
async function restore() {
  if (
    await run(
      () => api(`/api/me/trash/${props.Parameter.id}/restore`, { method: 'POST', token: site.token.value }),
      '帖子已恢复',
    )
  ) {
    await site.loadCategories()
    await router.push('/account')
  }
}
async function reply() {
  if (
    await run(async () => {
      const body = await replyEditor.value!.save()
      if (!body.blocks.length) throw new Error('请输入回复内容')
      await api(`/api/posts/${props.Parameter.id}/replies`, {
        method: 'POST',
        token: site.token.value,
        body: await replyEditor.value!.submission(),
      })
      await replyEditor.value!.clearDraft()
      await site.refreshUser()
    }, '回复已发送')
  ) {
    editorVersion.value++
    page.value = Math.ceil(((data.value?.totalReplyCount || 0) + 1) / (data.value?.pageSize || 20))
    await reload()
  }
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content post-page">
      <div class="breadcrumb-row">
        <WinButton
          :label="isTrash ? '返回回收站' : '返回帖子列表'"
          icon="back"
          subtle
          @click="
            router.push(isTrash ? '/account/trash' : data ? `/category/${data.post.category_id}` : '/home')
          "
        /><span v-if="data">{{ data.post.category_name }}</span>
      </div>
      <InfoBar :IsOpen="true" v-if="error" :Message="error" Severity="Error" :IsClosable="false" />
      <div v-if="loading && !data" class="loading-state"><ProgressRing :IsActive="true" /></div>
      <template v-if="data"
        ><article class="post-detail">
          <div v-if="isTrash" class="section-toolbar">
            <p class="secondary-text">
              此帖仅自己可见，{{ formatDateTime(data.post.purge_after!) }} 到期清理。
            </p>
            <WinButton
              v-if="!site.user.value?.isBanned"
              label="恢复帖子"
              icon="refresh"
              :disabled="saving"
              @click="restore"
            />
          </div>
          <div class="post-labels">
            <span v-if="data.post.status === 'pending'" class="status-tag warning">待审核，仅自己可见</span>
            <span v-else-if="data.post.status === 'rejected'" class="status-tag warning"
              >审核未通过，仅自己可见</span
            >
            <span v-else-if="data.post.status === 'hidden'" class="tag">已从社区列表隐藏</span>
            <span v-if="data.post.is_pinned" class="tag"><IconGlyph name="pin" :size="13" />置顶</span
            ><span v-if="data.post.minimum_reader_level" class="tag"
              >Lv.{{ data.post.minimum_reader_level }}+ 可读</span
            >
          </div>
          <h1>{{ data.post.title }}</h1>
          <div class="post-author">
            <UserAvatar
              :uid="data.post.author_uid"
              :name="data.post.display_name"
              :url="data.post.avatar_url"
            />
            <div>
              <strong>{{ data.post.display_name }}</strong
              ><small>UID {{ data.post.author_uid }} · {{ formatDate(data.post.created_at) }}</small>
            </div>
          </div>
          <PostBody :data="data.post.body" />
          <p v-if="data.post.status === 'rejected' && data.post.review_reason" class="notification-body">
            审核原因：{{ data.post.review_reason }}
          </p>
          <div class="post-actions">
            <ToggleButton
              ref="likeButton"
              v-if="!isTrash && isPublic"
              :IsChecked="data.liked"
              :IsEnabled="!saving && !site.user.value?.isBanned"
              :aria-label="`${data.likeCount} 喜欢`"
              :Click="like"
              ><span class="button-content"
                ><IconGlyph name="like" :size="16" /><span>{{ data.likeCount }} 喜欢</span></span
              ></ToggleButton
            ><FavoriteButton
              v-if="!isTrash && isPublic"
              :post-id="props.Parameter.id!"
              :disabled="site.user.value?.isBanned"
            /><span><IconGlyph name="eye" :size="16" />{{ data.post.view_count }} 次浏览</span
            ><span><IconGlyph name="chat" :size="16" />{{ data.totalReplyCount }} 条回复</span>
          </div>
        </article>
        <section class="replies-section">
          <h2>
            回复 <span class="count">{{ data.totalReplyCount }}</span>
          </h2>
          <p v-if="!data.replies.length" class="secondary-text">
            {{ isTrash ? '还没有回复。' : '还没有回复，分享你的看法。' }}
          </p>
          <article v-for="entry in data.replies" :key="entry.id" class="reply-item">
            <UserAvatar
              :uid="entry.author_uid"
              :name="entry.display_name"
              :url="entry.avatar_url"
              :size="32"
            />
            <div class="reply-content">
              <header>
                <strong>{{ entry.display_name }}</strong
                ><span>UID {{ entry.author_uid }}</span
                ><time>{{ formatDate(entry.created_at) }}</time>
              </header>
              <PostBody :data="entry.body" />
            </div>
          </article>
          <nav v-if="data.totalPages > 1" class="reply-pagination" aria-label="回复翻页">
            <WinButton
              label="上一页"
              :disabled="loading || data.page <= 1"
              @click="goPage(data.page - 1)"
            /><span>第 {{ data.page }} / {{ data.totalPages }} 页 · 每页 {{ data.pageSize }} 条</span
            ><WinButton
              label="下一页"
              :disabled="loading || data.page >= data.totalPages"
              @click="goPage(data.page + 1)"
            />
          </nav>
          <div v-if="canReply" class="reply-compose">
            <h3>参与讨论</h3>
            <div class="editor-surface">
              <EditorComposer
                :key="`${site.user.value!.uid}:${editorVersion}`"
                ref="replyEditor"
                :token="site.token.value!"
                kind="reply"
                :draft-key="`reply:${site.user.value!.uid}:${props.Parameter.id}`"
              />
            </div>
            <div class="form-actions">
              <WinButton label="发送回复" accent :disabled="saving" @click="reply" />
            </div>
          </div>
          <WinButton
            v-else-if="!isTrash && isPublic && !site.user.value"
            label="登录后回复"
            accent
            @click="site.authOpen.value = true"
          />
          <p v-else-if="!isTrash && isPublic" class="secondary-text">
            {{ site.user.value?.isBanned ? '账号封禁期间仅可浏览。' : '当前用户组没有回复权限。' }}
          </p>
        </section></template
      >
    </div>
  </div>
</template>
