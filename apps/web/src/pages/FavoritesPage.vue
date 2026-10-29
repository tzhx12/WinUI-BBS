<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { TextBox, ToggleSwitch } from 'winuionweb'
import { api } from '../api'
import { useSite } from '../site'
import { useResource } from '../composables/useResource'
import type { PageParameter, PostSummary } from '../types'
import PageHeader from '../components/ui/PageHeader.vue'
import WinButton from '../components/ui/WinButton.vue'
import WinDialog from '../components/ui/WinDialog.vue'
import WinSelect from '../components/ui/WinSelect.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import ResourceState from '../components/ui/ResourceState.vue'
import PostListItem from '../components/PostListItem.vue'
defineOptions({ inheritAttrs: false })
interface Folder {
  id: string
  user_uid: string
  name: string
  is_public: boolean
  is_default: boolean
  post_count: number
}
const props = defineProps<{ Parameter: PageParameter }>()
const site = useSite(),
  router = useRouter()
const personal = props.Parameter.path.startsWith('/account/')
const folderId = props.Parameter.id
const { data, loading, error, saving, reload, run } = useResource(
  async () => {
    const folders =
      personal && site.user.value
        ? await api<Folder[]>('/api/me/favorite-folders', { token: site.token.value })
        : []
    const detail = folderId
      ? await api<{ folder: Folder; posts: PostSummary[] }>(`/api/favorite-folders/${folderId}`, {
          token: site.token.value,
        })
      : null
    return { folders, detail }
  },
  { folders: [] as Folder[], detail: null as { folder: Folder; posts: PostSummary[] } | null },
)
const canEdit = computed(
  () =>
    personal &&
    !!site.user.value &&
    !site.user.value.isBanned &&
    (!folderId || data.value.detail?.folder.user_uid === site.user.value.uid),
)
const open = ref(false),
  name = ref(''),
  isPublic = ref(false),
  isDefault = ref(false),
  editing = ref<Folder | null>(null)
const moving = ref<PostSummary | null>(null),
  moveOpen = ref(false),
  target = ref('')
function edit(folder: Folder | null) {
  editing.value = folder
  name.value = folder?.name || ''
  isPublic.value = folder?.is_public || false
  isDefault.value = folder?.is_default ?? !data.value.folders.some((f) => f.is_default)
  error.value = ''
  open.value = true
}
async function save() {
  if (
    await run(
      () =>
        api(`/api/me/favorite-folders${editing.value ? `/${editing.value.id}` : ''}`, {
          method: editing.value ? 'PATCH' : 'POST',
          token: site.token.value,
          body: { name: name.value, isPublic: isPublic.value, isDefault: isDefault.value },
        }),
      '收藏夹已保存',
    )
  ) {
    open.value = false
    await reload()
  }
}
async function makeDefault(folder: Folder) {
  if (
    await run(
      () =>
        api(`/api/me/favorite-folders/${folder.id}`, {
          method: 'PATCH',
          token: site.token.value,
          body: { name: folder.name, isPublic: folder.is_public, isDefault: true },
        }),
      '默认收藏夹已设置',
    )
  )
    await reload()
}
async function remove(folder: Folder) {
  if (await site.confirm(`删除“${folder.name}”？`, '此收藏夹中的收藏记录将被移除，帖子仍会保留。', '删除'))
    if (
      await run(
        () => api(`/api/me/favorite-folders/${folder.id}`, { method: 'DELETE', token: site.token.value }),
        '收藏夹已删除',
      )
    ) {
      if (folderId) await router.replace('/account/favorites')
      else await reload()
    }
}
async function removePost(post: PostSummary) {
  if (
    await run(
      () =>
        api(`/api/me/favorite-folders/${folderId}/posts/${post.id}`, {
          method: 'DELETE',
          token: site.token.value,
        }),
      '已取消收藏',
    )
  )
    await reload()
}
function showMove(post: PostSummary) {
  moving.value = post
  target.value = data.value.folders.find((f) => f.id !== folderId)?.id || ''
  moveOpen.value = true
}
async function move() {
  if (
    await run(
      () =>
        api(`/api/me/favorite-folders/${folderId}/posts/${moving.value!.id}`, {
          method: 'PATCH',
          token: site.token.value,
          body: { targetFolderId: target.value },
        }),
      '收藏已移动',
    )
  ) {
    moveOpen.value = false
    await reload()
  }
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader :title="data.detail?.folder.name || '我的收藏'">
        <WinButton
          label="返回"
          icon="back"
          @click="
            router.push(
              personal
                ? folderId
                  ? '/account/favorites'
                  : '/account'
                : `/users/${data.detail?.folder.user_uid}`,
            )
          "
        />
        <WinButton v-if="canEdit && !folderId" label="新建收藏夹" icon="add" accent @click="edit(null)" />
        <WinButton
          v-if="canEdit && data.detail"
          label="编辑收藏夹"
          icon="edit"
          @click="edit(data.detail.folder)"
        />
        <WinButton
          v-if="canEdit && data.detail"
          label="删除收藏夹"
          icon="delete"
          @click="remove(data.detail.folder)"
        />
      </PageHeader>
      <ResourceState :loading="loading" :error="open || moveOpen ? '' : error" />
      <EmptyState v-if="!loading && !folderId && !data.folders.length" title="暂无收藏夹" icon="favorite" />
      <template v-if="!folderId"
        ><section v-for="folder in data.folders" :key="folder.id" class="surface-card setting-row">
          <div>
            <h2>{{ folder.name }} <span v-if="folder.is_default" class="tag">默认收藏夹</span></h2>
            <p class="secondary-text">
              {{ folder.post_count }} 篇收藏 · {{ folder.is_public ? '公开' : '仅自己可见' }}
            </p>
          </div>
          <div class="row-actions">
            <WinButton
              v-if="canEdit && !folder.is_default"
              label="设为默认"
              :disabled="saving"
              @click="makeDefault(folder)"
            />
            <WinButton label="打开收藏夹" @click="router.push(`/account/favorites/${folder.id}`)" /><WinButton
              v-if="canEdit"
              label="编辑"
              icon="edit"
              @click="edit(folder)"
            /><WinButton v-if="canEdit" label="删除" icon="delete" @click="remove(folder)" />
          </div></section
      ></template>
      <template v-if="data.detail"
        ><p class="secondary-text">{{ data.detail.folder.is_public ? '公开收藏夹' : '仅自己可见' }}</p>
        <WinButton
          v-if="canEdit && !data.folders.find((f) => f.id === folderId)?.is_default"
          label="设为默认收藏夹"
          :disabled="saving"
          @click="makeDefault(data.detail.folder)"
        />
        <EmptyState
          v-if="!loading && !data.detail.posts.length"
          title="暂无可显示的收藏"
          description="在帖子中点击收藏，选择此收藏夹。"
          icon="favorite"
        />
        <section v-for="post in data.detail.posts" :key="post.id" class="surface-card favorite-post">
          <PostListItem :item="post" @click="router.push(`/post/${post.id}`)" />
          <div v-if="canEdit" class="row-actions">
            <WinButton
              label="移动到"
              :disabled="data.folders.length < 2 || saving"
              @click="showMove(post)"
            /><WinButton label="取消收藏" :disabled="saving" @click="removePost(post)" />
          </div>
        </section>
      </template>
      <WinDialog
        v-model:open="open"
        :title="editing ? '编辑收藏夹' : '新建收藏夹'"
        primary="保存"
        :busy="saving"
        :error="error"
        @primary="save"
        ><TextBox v-model:Text="name" Header="名称" :MaxLength="64" /><ToggleSwitch
          v-model:IsOn="isPublic"
          Header="在用户空间公开此收藏夹" /><ToggleSwitch v-model:IsOn="isDefault" Header="设为默认收藏夹"
      /></WinDialog>
      <WinDialog
        v-model:open="moveOpen"
        title="移动收藏"
        primary="移动"
        :busy="saving || !target"
        :error="error"
        @primary="move"
        ><WinSelect
          v-model="target"
          label="目标收藏夹"
          :options="
            data.folders.filter((f) => f.id !== folderId).map((f) => ({ value: f.id, label: f.name }))
          "
      /></WinDialog>
    </div>
  </div>
</template>
