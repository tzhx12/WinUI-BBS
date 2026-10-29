<script setup lang="ts">
import { computed, h, ref, resolveComponent, watch } from 'vue'
import { MenuFlyout, SplitButton } from 'winuionweb'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useSite } from '../site'
import IconGlyph from './IconGlyph.vue'
import FavoritePicker from './FavoritePicker.vue'

const props = defineProps<{ postId: string; disabled?: boolean }>()
const site = useSite(),
  router = useRouter()
interface Folder {
  id: string
  name: string
  is_default: boolean
  contains_post: boolean
}
const folders = ref<Folder[]>([]),
  loading = ref(false),
  busy = ref(false),
  pickerOpen = ref(false),
  error = ref('')
const split = ref<InstanceType<typeof SplitButton> | null>(null)
const menu = ref<InstanceType<typeof MenuFlyout> | null>(null)
const MenuItem = resolveComponent('MenuFlyoutItem')
const Separator = resolveComponent('MenuFlyoutSeparator')
const saved = computed(() => folders.value.some((folder) => folder.contains_post))
const defaultFolder = computed(() => folders.value.find((folder) => folder.is_default))
const title = computed(() =>
  saved.value
    ? '取消收藏（从所有收藏夹移除）'
    : defaultFolder.value
      ? `快速收藏到“${defaultFolder.value.name}”`
      : '选择收藏夹或设置默认收藏夹',
)

async function reload() {
  folders.value = []
  if (!site.token.value) return
  loading.value = true
  error.value = ''
  try {
    folders.value = await api(`/api/me/favorite-folders?postId=${props.postId}`, { token: site.token.value })
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    loading.value = false
  }
}
watch([site.token, () => props.postId], reload, { immediate: true })
async function save(folder: Folder, remove = false) {
  busy.value = true
  error.value = ''
  try {
    await api(`/api/me/favorite-folders/${folder.id}/posts/${props.postId}`, {
      method: remove ? 'DELETE' : 'POST',
      token: site.token.value,
    })
    folder.contains_post = !remove
    site.notify(remove ? `已从“${folder.name}”取消收藏` : `已收藏到“${folder.name}”`)
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}
function quickSave() {
  if (!site.user.value) {
    site.authOpen.value = true
    return
  }
  if (saved.value) {
    void cancelAll()
    return
  }
  if (!defaultFolder.value) {
    menu.value?.ShowAt(split.value!.Element!, { Placement: 'BottomEdgeAlignedLeft' })
    return
  }
  void save(defaultFolder.value)
}
async function cancelAll() {
  busy.value = true
  error.value = ''
  try {
    await api(`/api/me/favorites/${props.postId}`, { method: 'DELETE', token: site.token.value })
    folders.value.forEach((folder) => {
      folder.contains_post = false
    })
    site.notify('已取消收藏')
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}
const flyout = computed(() =>
  h(
    MenuFlyout,
    { ref: menu },
    {
      default: () => [
        ...(site.user.value
          ? folders.value.map((folder) =>
              h(MenuItem, {
                Text: `${folder.contains_post ? '取消收藏' : '收藏到'} · ${folder.name}${folder.is_default ? '（默认）' : ''}`,
                onClick: () => save(folder, folder.contains_post),
              }),
            )
          : [
              h(MenuItem, {
                Text: '登录后收藏',
                onClick: () => {
                  site.authOpen.value = true
                },
              }),
            ]),
        ...(site.user.value
          ? [
              ...(folders.value.length ? [h(Separator)] : []),
              h(MenuItem, {
                Text: '新建收藏夹…',
                onClick: () => {
                  pickerOpen.value = true
                },
              }),
              h(MenuItem, { Text: '设置默认收藏夹…', onClick: () => router.push('/account/favorites') }),
            ]
          : []),
      ],
    },
  ),
)
</script>
<template>
  <div class="favorite-control">
    <SplitButton
      ref="split"
      class="favorite-split"
      :class="{ 'is-saved': saved }"
      :Flyout="flyout"
      :IsEnabled="!disabled && !loading && !busy"
      :aria-pressed="saved"
      :title="title"
      :Click="quickSave"
    >
      <span class="button-content"
        ><IconGlyph name="favorite" :size="16" /><span>{{ saved ? '已收藏' : '收藏' }}</span></span
      >
    </SplitButton>
    <span v-if="error" class="editor-error" role="alert">{{ error }}</span>
    <FavoritePicker
      v-if="site.user.value && !site.user.value.isBanned"
      v-model:open="pickerOpen"
      :post-id="postId"
      @changed="reload"
    />
  </div>
</template>

<style>
.favorite-control {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.favorite-split.is-saved {
  --SplitButtonBackground: var(--SplitButtonBackgroundChecked);
  --SplitButtonBackgroundPointerOver: var(--SplitButtonBackgroundCheckedPointerOver);
  --SplitButtonBackgroundPressed: var(--SplitButtonBackgroundCheckedPressed);
  --SplitButtonForeground: var(--SplitButtonForegroundChecked);
  --SplitButtonForegroundSecondary: var(--SplitButtonForegroundChecked);
  --SplitButtonForegroundPointerOver: var(--SplitButtonForegroundCheckedPointerOver);
  --SplitButtonForegroundPressed: var(--SplitButtonForegroundCheckedPressed);
  --SplitButtonForegroundSecondaryPressed: var(--SplitButtonForegroundCheckedPressed);
  --SplitButtonBorderBrush: var(--SplitButtonBorderBrushChecked);
  --SplitButtonBorderBrushPressed: var(--SplitButtonBorderBrushCheckedPressed);
  --SplitButtonBorderBrushDivider: var(--SplitButtonBorderBrushCheckedDivider);
}
</style>
