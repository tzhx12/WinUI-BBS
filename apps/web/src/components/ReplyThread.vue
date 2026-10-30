<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NumberBox } from 'winuionweb'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useSite } from '../site'
import type { ChildReplyPage, ReplyEntry, ReplyThread as Thread } from '../types'
import { formatDateTime } from '../utils'
import UserAvatar from './UserAvatar.vue'
import PostBody from './PostBody.vue'
import EditorComposer from './EditorComposer.vue'
import WinButton from './ui/WinButton.vue'
import ReplyDeleteButton from './ReplyDeleteButton.vue'
const props = defineProps<{
  postId: string
  entry: Thread
  trash?: boolean
  canReply: boolean
  readOnly?: boolean
}>()
const emit = defineEmits<{ changed: [delta: number]; removed: [] }>()
const site = useSite(),
  router = useRouter()
const children = ref<ChildReplyPage>(props.entry.children)
const jump = ref(children.value.page),
  loading = ref(false),
  error = ref(''),
  busy = ref(false),
  composerOpen = ref(false),
  version = ref(0)
const editor = ref<InstanceType<typeof EditorComposer> | null>(null)
const target = ref<ReplyEntry | null>(null)
const metadata = computed(() => ({ replyToId: target.value?.id, replyToName: target.value?.display_name }))
watch(
  () => props.entry.children,
  (value) => {
    children.value = value
    jump.value = value.page
  },
)
const endpoint = computed(
  () => `${props.trash ? '/api/me/trash' : '/api/posts'}/${props.postId}/replies/${props.entry.id}/children`,
)
async function loadPage(page: number) {
  loading.value = true
  error.value = ''
  try {
    children.value = await api(`${endpoint.value}?page=${page}`, { token: site.token.value })
    jump.value = children.value.page
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    loading.value = false
  }
}
function respond(entry: ReplyEntry) {
  if (!site.user.value) {
    site.authOpen.value = true
    return
  }
  target.value = entry
  composerOpen.value = true
  error.value = ''
}
async function send() {
  busy.value = true
  error.value = ''
  try {
    await api(`/api/posts/${props.postId}/replies`, {
      method: 'POST',
      token: site.token.value,
      body: await editor.value!.submission({
        parentReplyId: props.entry.id,
        ...(target.value?.id ? { replyToId: target.value.id } : {}),
      }),
    })
    await editor.value!.clearDraft()
    composerOpen.value = false
    version.value++
    emit('changed', 1)
    await loadPage(Math.ceil((children.value.total + 1) / 5))
    await site.refreshUser()
    site.notify('回复已发送')
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}
async function childDeleted(result: { removedCount: number }) {
  emit('changed', -result.removedCount)
  if (props.entry.deleted_at && children.value.total <= 1) {
    emit('removed')
    return
  }
  await loadPage(children.value.page)
}
</script>
<template>
  <article class="reply-item reply-thread" :data-reply-id="entry.id">
    <UserAvatar
      v-if="entry.author_uid"
      :uid="entry.author_uid"
      :name="entry.display_name!"
      :url="entry.avatar_url"
      :size="36"
    />
    <div v-else class="deleted-reply-avatar" aria-hidden="true" />
    <div class="reply-content">
      <template v-if="!entry.deleted_at"
        ><header>
          <strong>{{ entry.display_name }}</strong
          ><span>UID {{ entry.author_uid }}</span>
        </header>
        <PostBody :data="entry.body"
      /></template>
      <p v-else class="deleted-reply-text">
        {{ entry.deletion_source === 'admin' ? '该回复已被管理员删除' : '原回复已删除' }}
      </p>
      <footer class="reply-footer">
        <span v-if="!entry.deleted_at" class="reply-floor">第{{ entry.floor_number }}楼</span
        ><time v-if="!entry.deleted_at" :datetime="entry.created_at">{{
          formatDateTime(entry.created_at)
        }}</time
        ><WinButton
          v-if="!readOnly && !entry.deleted_at && (canReply || !site.user.value)"
          label="回复"
          subtle
          @click="respond(entry)"
        />
        <div class="reply-delete">
          <ReplyDeleteButton
            :post-id="postId"
            :entry="entry"
            :read-only="readOnly"
            @deleted="emit('removed')"
          />
        </div>
      </footer>
      <section
        v-if="children.total"
        class="nested-replies"
        :aria-label="`第${entry.floor_number}楼的楼中楼`"
        :aria-busy="loading"
      >
        <article
          v-for="child in children.replies"
          :key="child.id"
          class="nested-reply"
          :data-reply-id="child.id"
        >
          <UserAvatar
            :uid="child.author_uid!"
            :name="child.display_name!"
            :url="child.avatar_url"
            :size="26"
          />
          <div class="nested-reply-content">
            <header>
              <strong>{{ child.display_name }}</strong
              ><span v-if="child.reply_to_uid" class="reply-target"
                >回复
                <a
                  :href="`#/users/${child.reply_to_uid}`"
                  @click.prevent="router.push(`/users/${child.reply_to_uid}`)"
                  >@{{ child.reply_to_name }}</a
                ></span
              >
            </header>
            <PostBody :data="child.body" />
            <footer class="reply-footer">
              <span class="reply-floor">第{{ child.floor_number }}楼-{{ child.child_number }}层</span
              ><time :datetime="child.created_at">{{ formatDateTime(child.created_at) }}</time
              ><WinButton
                v-if="!readOnly && (canReply || !site.user.value)"
                label="回复"
                subtle
                @click="respond(child)"
              />
              <div class="reply-delete">
                <ReplyDeleteButton
                  :post-id="postId"
                  :entry="child"
                  :read-only="readOnly"
                  @deleted="childDeleted"
                />
              </div>
            </footer>
          </div>
        </article>
        <nav
          v-if="children.totalPages > 1"
          class="nested-pagination"
          :aria-label="`第${entry.floor_number}楼的楼中楼翻页`"
        >
          <span>共 {{ children.total }} 条</span
          ><WinButton
            label="上一页"
            subtle
            :disabled="loading || children.page <= 1"
            @click="loadPage(children.page - 1)"
          /><span>第 {{ children.page }} / {{ children.totalPages }} 页</span
          ><WinButton
            label="下一页"
            subtle
            :disabled="loading || children.page >= children.totalPages"
            @click="loadPage(children.page + 1)"
          /><NumberBox
            v-model:Value="jump"
            :Minimum="1"
            :Maximum="children.totalPages"
            :SmallChange="1"
            :SpinButtonPlacementMode="'Hidden'"
            :AutomationProperties.Name="`第${entry.floor_number}楼跳转页码`"
          /><WinButton
            label="跳转"
            :disabled="loading || !Number.isInteger(jump) || jump < 1 || jump > children.totalPages"
            @click="loadPage(jump)"
          />
        </nav>
      </section>
      <div v-if="composerOpen && canReply" class="nested-compose">
        <div class="section-toolbar">
          <h3>回复 {{ target?.display_name || '此楼' }}</h3>
          <WinButton label="收起" subtle @click="composerOpen = false" />
        </div>
        <div class="editor-surface">
          <EditorComposer
            :key="version"
            ref="editor"
            :token="site.token.value!"
            kind="reply"
            :draft-key="`nested:${site.user.value!.uid}:${entry.id}`"
            :metadata="metadata"
          />
        </div>
        <div class="form-actions">
          <WinButton label="发送回复" accent :disabled="busy" @click="send" />
        </div>
      </div>
      <p v-if="error" class="editor-error" role="alert">{{ error }}</p>
    </div>
  </article>
</template>
