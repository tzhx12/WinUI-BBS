<script setup lang="ts">
import { ref, watch } from 'vue'
import { TextBox, ToggleSwitch } from 'winuionweb'
import { api } from '../api'
import { useSite } from '../site'
import WinDialog from './ui/WinDialog.vue'
import WinButton from './ui/WinButton.vue'
const props = defineProps<{ open: boolean; postId: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const site = useSite()
const folders = ref<Array<{ id: string; name: string; is_public: boolean; contains_post: boolean }>>([])
const name = ref(''),
  isPublic = ref(false),
  busy = ref(false),
  error = ref('')
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    error.value = ''
    name.value = ''
    isPublic.value = false
    try {
      folders.value = await api(`/api/me/favorite-folders?postId=${props.postId}`, {
        token: site.token.value,
      })
    } catch (cause) {
      error.value = (cause as Error).message
    }
  },
)
async function toggle(folder: (typeof folders.value)[number]) {
  busy.value = true
  error.value = ''
  try {
    await api(`/api/me/favorite-folders/${folder.id}/posts/${props.postId}`, {
      method: folder.contains_post ? 'DELETE' : 'POST',
      token: site.token.value,
    })
    folder.contains_post = !folder.contains_post
    site.notify(folder.contains_post ? '已加入收藏夹' : '已取消收藏')
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}
async function create() {
  busy.value = true
  error.value = ''
  try {
    const folder = await api<(typeof folders.value)[number]>('/api/me/favorite-folders', {
      method: 'POST',
      token: site.token.value,
      body: { name: name.value, isPublic: isPublic.value },
    })
    folders.value.push({ ...folder, contains_post: false })
    name.value = ''
    await toggle(folders.value.at(-1)!)
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <WinDialog
    :open="open"
    title="收藏帖子"
    close="完成"
    :error="error"
    @update:open="emit('update:open', $event)"
  >
    <div v-for="folder in folders" :key="folder.id" class="setting-row">
      <div>
        <strong>{{ folder.name }}</strong>
        <p class="secondary-text">{{ folder.is_public ? '公开' : '仅自己可见' }}</p>
      </div>
      <WinButton
        :label="folder.contains_post ? '已收藏 · 取消' : '加入收藏'"
        :accent="folder.contains_post"
        :disabled="busy"
        @click="toggle(folder)"
      />
    </div>
    <p v-if="!folders.length" class="secondary-text">创建第一个收藏夹，收好值得重读的讨论。</p>
    <TextBox v-model:Text="name" Header="新收藏夹名称" :MaxLength="64" />
    <ToggleSwitch v-model:IsOn="isPublic" Header="在用户空间公开此收藏夹" />
    <WinButton label="创建并收藏" :disabled="busy || !name.trim()" @click="create" />
  </WinDialog>
</template>
