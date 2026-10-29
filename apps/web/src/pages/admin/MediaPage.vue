<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { NumberBox, TextBox } from 'winuionweb'
import { api, uploadForm } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import type { MediaAsset } from '../../types'
import type { EmojiPack } from '../../types/admin'
import { formatBytes, formatDate } from '../../utils'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import EmptyState from '../../components/ui/EmptyState.vue'
import WinButton from '../../components/ui/WinButton.vue'
import WinDialog from '../../components/ui/WinDialog.vue'
import WinSelect from '../../components/ui/WinSelect.vue'
import MediaSettingsPanel from '../../components/MediaSettingsPanel.vue'
defineOptions({ inheritAttrs: false })
const site = useSite(),
  collection = ref('all'),
  packFilter = ref('all')
const view = ref('library')
interface MediaPage {
  items: MediaAsset[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
const page = ref(1),
  search = ref(''),
  searchQuery = ref(''),
  communityTarget = ref<string | number>('')
const mediaUrl = computed(() => {
  const params = new URLSearchParams({ page: String(page.value), q: searchQuery.value })
  if (collection.value !== 'all') params.set('collection', collection.value)
  if (packFilter.value !== 'all') params.set('packId', packFilter.value)
  return `/api/admin/media/search?${params}`
})
const { data, loading, error, saving, reload, run } = useResource(
  async () => {
    const [media, packs] = await Promise.all([
      api<MediaPage>(mediaUrl.value, { token: site.token.value }),
      api<EmojiPack[]>('/api/admin/emoji-packs', { token: site.token.value }),
    ])
    return { media, packs }
  },
  {
    media: { items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 } as MediaPage,
    packs: [] as EmojiPack[],
  },
)
watch(collection, () => {
  packFilter.value = 'all'
})
watch([collection, packFilter, searchQuery], () => {
  page.value = 1
})
watch(mediaUrl, () => {
  void reload()
})
watch(
  () => data.value.packs,
  (packs) => {
    communityTarget.value = packs.find((p) => p.is_community)?.id || ''
  },
)
const visibleMedia = computed(() => data.value.media.items)
async function saveCommunity() {
  if (
    await run(
      () =>
        api('/api/admin/community-emoji-pack', {
          method: 'PUT',
          token: site.token.value,
          body: { packId: communityTarget.value || null },
        }),
      '社区表情包已更新',
    )
  )
    await reload()
}
function findImages() {
  if (searchQuery.value === search.value.trim()) {
    page.value = 1
    void reload()
  } else searchQuery.value = search.value.trim()
}
const uploadOpen = ref(false),
  uploadInput = ref<HTMLInputElement | null>(null),
  fileNames = ref('')
const uploadCollection = ref<string | number>('library'),
  uploadPack = ref<string | number>('')
const assetOpen = ref(false),
  selectedAsset = ref<MediaAsset | null>(null),
  altText = ref('')
const packOpen = ref(false),
  editingPack = ref<EmojiPack | null>(null),
  packForm = reactive({ name: '', sortOrder: 0 })
function showUpload() {
  error.value = ''
  fileNames.value = ''
  uploadCollection.value = collection.value === 'emoji' ? 'emoji' : 'library'
  uploadPack.value = data.value.packs.find((p) => !p.remote_source)?.id || ''
  uploadOpen.value = true
}
function selectFiles(event: Event) {
  fileNames.value = Array.from((event.target as HTMLInputElement).files || [])
    .map((file) => file.name)
    .join('、')
}
async function upload() {
  const files = Array.from(uploadInput.value?.files || [])
  if (!files.length) {
    error.value = '请选择图片'
    return
  }
  if (
    await run(async () => {
      const query =
        uploadCollection.value === 'emoji'
          ? `?collection=emoji&packId=${uploadPack.value}`
          : '?collection=library'
      for (const file of files)
        await api(`/api/admin/media${query}`, {
          method: 'POST',
          token: site.token.value,
          body: uploadForm(file),
        })
    }, '图片已上传')
  ) {
    uploadOpen.value = false
    if (uploadInput.value) uploadInput.value.value = ''
    await reload()
  }
}
function showAsset(asset: MediaAsset) {
  selectedAsset.value = asset
  altText.value = asset.alt_text
  error.value = ''
  assetOpen.value = true
}
async function saveAsset() {
  if (
    await run(
      () =>
        api(`/api/admin/media/${selectedAsset.value!.id}`, {
          method: 'PATCH',
          token: site.token.value,
          body: { altText: altText.value },
        }),
      '图片说明已保存',
    )
  ) {
    assetOpen.value = false
    await reload()
  }
}
async function removeAsset(asset: MediaAsset) {
  assetOpen.value = false
  if (
    !(await site.confirm(
      `删除“${asset.original_name}”？`,
      '正文中使用此图的位置会显示阿卡林占位图，原图片地址将失效。',
      '删除图片',
    ))
  )
    return
  if (
    await run(
      () => api(`/api/admin/media/${asset.id}`, { method: 'DELETE', token: site.token.value }),
      '图片已删除',
    )
  )
    await reload()
}
async function copy(asset: MediaAsset) {
  await navigator.clipboard.writeText(new URL(asset.url, site.settings.url || window.location.origin).href)
  site.notify('图片链接已复制')
}
function editPack(pack?: EmojiPack) {
  editingPack.value = pack || null
  Object.assign(packForm, { name: pack?.name || '', sortOrder: pack?.sort_order || 0 })
  error.value = ''
  packOpen.value = true
}
async function savePack() {
  if (
    await run(
      () =>
        api(`/api/admin/emoji-packs${editingPack.value ? `/${editingPack.value.id}` : ''}`, {
          method: editingPack.value ? 'PATCH' : 'POST',
          token: site.token.value,
          body: packForm,
        }),
      '表情包已保存',
    )
  ) {
    packOpen.value = false
    await reload()
  }
}
async function removePack(pack: EmojiPack) {
  if (!(await site.confirm(`删除“${pack.name}”？`, '图片文件会保留，但不再出现在此表情包中。', '删除表情包')))
    return
  if (
    await run(
      () => api(`/api/admin/emoji-packs/${pack.id}`, { method: 'DELETE', token: site.token.value }),
      '表情包已删除',
    )
  ) {
    packFilter.value = 'all'
    await reload()
  }
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="图床与表情" description="统一管理图片、表情包和站点图标资源。"
        ><WinButton label="新建表情包" icon="emoji" @click="editPack()" /><WinButton
          label="上传图片"
          icon="upload"
          accent
          @click="showUpload"
      /></PageHeader>
      <div class="section-toolbar">
        <div class="row-actions">
          <WinButton
            label="图片管理"
            :accent="view === 'library'"
            subtle
            @click="view = 'library'"
          /><WinButton
            label="上传与远端设置"
            :accent="view === 'settings'"
            subtle
            @click="view = 'settings'"
          />
        </div>
      </div>
      <section class="surface-card form-stack">
        <h2>社区表情包</h2>
        <p class="secondary-text">
          固定显示在选择器第一组。有发帖或回复权限即可在对应编辑器中使用，不占个人组数限额。
        </p>
        <div class="row-actions">
          <WinSelect
            v-model="communityTarget"
            label="共享分组"
            :options="[
              { value: '', label: '不设置社区表情包' },
              ...data.packs.filter((p) => p.created_by === null).map((p) => ({ value: p.id, label: p.name })),
            ]"
          />
          <WinButton label="保存社区分组" :disabled="saving" @click="saveCommunity" />
        </div>
      </section>
      <MediaSettingsPanel v-if="view === 'settings'" @added="reload" />
      <template v-else>
        <div class="section-toolbar">
          <div class="toolbar-filters">
            <WinSelect
              v-model="collection"
              label="资源类型"
              :options="[
                { value: 'all', label: '全部图片' },
                { value: 'library', label: '图床' },
                { value: 'emoji', label: '表情' },
                { value: 'site_icon', label: '站点图标' },
              ]"
            /><WinSelect
              v-if="collection === 'emoji'"
              v-model="packFilter"
              label="表情包"
              :options="[
                { value: 'all', label: '全部表情包' },
                ...data.packs.map((p) => ({ value: p.id, label: p.name })),
              ]"
            />
          </div>
          <form class="toolbar-search" @submit.prevent="findImages">
            <TextBox
              v-model:Text="search"
              PlaceholderText="文件名、图片说明或表情包名称"
              AutomationProperties.Name="搜索图片"
              :MaxLength="160"
            />
            <WinButton label="搜索图片" icon="search" :disabled="loading" @click="findImages" />
          </form>
          <span class="secondary-text">{{ data.media.total }} 张图片</span>
        </div>
        <ResourceState :loading="loading" :error="uploadOpen || assetOpen || packOpen ? '' : error" />
        <section v-if="collection === 'emoji' && data.packs.length" class="surface-card pack-management">
          <div v-for="pack in data.packs" :key="pack.id" class="setting-row">
            <div>
              <strong>{{ pack.name }}</strong
              ><small
                >{{ pack.emoji_count }} 个表情 ·
                {{ pack.is_community ? '社区表情 · 固定置顶' : `排序 ${pack.sort_order}` }}</small
              >
            </div>
            <div class="row-actions">
              <WinButton
                v-if="!pack.remote_source"
                label="编辑"
                icon="edit"
                subtle
                @click="editPack(pack)"
              /><WinButton
                v-if="!pack.remote_source"
                label="删除"
                icon="delete"
                subtle
                @click="removePack(pack)"
              />
            </div>
          </div>
        </section>
        <EmptyState v-if="!loading && !visibleMedia.length" title="这里还没有图片" icon="image"
          ><WinButton label="上传图片" icon="upload" @click="showUpload"
        /></EmptyState>
        <div v-else class="media-grid">
          <article v-for="asset in visibleMedia" :key="asset.id" class="media-card">
            <button
              type="button"
              class="media-preview"
              :aria-label="`查看 ${asset.original_name}`"
              @click="showAsset(asset)"
            >
              <img :src="asset.url" :alt="asset.alt_text || asset.original_name" loading="lazy" />
            </button>
            <div class="media-card-info">
              <strong :title="asset.original_name">{{ asset.original_name }}</strong
              ><small
                >{{ formatBytes(asset.byte_size)
                }}<template v-if="asset.pack_name"> · {{ asset.pack_name }}</template></small
              >
              <div class="row-actions">
                <WinButton label="复制链接" icon="copy" subtle @click="copy(asset)" /><WinButton
                  label="编辑"
                  icon="edit"
                  subtle
                  @click="showAsset(asset)"
                />
              </div>
            </div>
          </article>
        </div>
        <nav v-if="data.media.totalPages > 1" class="reply-pagination" aria-label="图片翻页">
          <WinButton
            label="上一页"
            :disabled="loading || data.media.page <= 1"
            @click="page = data.media.page - 1"
          />
          <span
            >第 {{ data.media.page }} / {{ data.media.totalPages }} 页 · 每页
            {{ data.media.pageSize }} 张</span
          >
          <WinButton
            label="下一页"
            :disabled="loading || data.media.page >= data.media.totalPages"
            @click="page = data.media.page + 1"
          />
        </nav>
      </template>
      <WinDialog
        v-model:open="uploadOpen"
        title="上传图片"
        primary="上传"
        :busy="saving"
        :error="error"
        @primary="upload"
        ><WinSelect
          v-model="uploadCollection"
          label="上传到"
          :options="[
            { value: 'library', label: '图床' },
            { value: 'emoji', label: '表情包' },
          ]"
        /><WinSelect
          v-if="uploadCollection === 'emoji'"
          v-model="uploadPack"
          label="表情包"
          :options="data.packs.filter((p) => !p.remote_source).map((p) => ({ value: p.id, label: p.name }))"
        /><WinButton label="选择图片" icon="image" @click="uploadInput?.click()" /><input
          ref="uploadInput"
          type="file"
          class="visually-hidden"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          @change="selectFiles"
        />
        <p v-if="fileNames" class="file-selection">{{ fileNames }}</p>
        <small class="secondary-text">PNG、JPEG、WebP、GIF</small></WinDialog
      >
      <WinDialog
        v-model:open="assetOpen"
        title="图片详情"
        primary="保存说明"
        :busy="saving"
        :error="error"
        @primary="saveAsset"
        ><template v-if="selectedAsset"
          ><img
            class="asset-detail-preview"
            :src="selectedAsset.url"
            :alt="selectedAsset.alt_text" /><strong>{{ selectedAsset.original_name }}</strong
          ><small class="secondary-text"
            >{{ formatBytes(selectedAsset.byte_size) }} · {{ formatDate(selectedAsset.created_at) }}</small
          ><TextBox
            v-model:Text="altText"
            Header="图片说明"
            aria-label="图片说明"
            :IsEnabled="!selectedAsset.remote_cached"
            :MaxLength="160" />
          <div class="row-actions">
            <WinButton label="复制链接" icon="copy" @click="copy(selectedAsset)" /><WinButton
              v-if="!selectedAsset.remote_cached"
              label="删除图片"
              icon="delete"
              @click="removeAsset(selectedAsset)"
            /></div></template
      ></WinDialog>
      <WinDialog
        v-model:open="packOpen"
        :title="editingPack ? '编辑表情包' : '新建表情包'"
        primary="保存"
        :busy="saving"
        :error="error"
        @primary="savePack"
        ><TextBox
          v-model:Text="packForm.name"
          Header="名称"
          aria-label="表情包名称"
          :MaxLength="64" /><NumberBox
          v-model:Value="packForm.sortOrder"
          Header="排序"
          SpinButtonPlacementMode="Inline"
          AutomationProperties.Name="表情包排序"
      /></WinDialog>
    </div>
  </div>
</template>
