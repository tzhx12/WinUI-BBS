<script setup lang="ts">
import { computed, ref } from 'vue'
import { Button, TextBox, ProgressBar } from 'winuionweb'
import { api, uploadForm } from '../api'
import { useSite } from '../site'
import { useResource } from '../composables/useResource'
import type { MediaAsset } from '../types'
import type { EmojiPack, MediaLimits, RemoteEmojiSettings } from '../types/admin'
import { formatBytes } from '../utils'
import PageHeader from '../components/ui/PageHeader.vue'
import ResourceState from '../components/ui/ResourceState.vue'
import WinButton from '../components/ui/WinButton.vue'
import WinDialog from '../components/ui/WinDialog.vue'
import WinSelect from '../components/ui/WinSelect.vue'
import RemoteEmojiBrowser from '../components/RemoteEmojiBrowser.vue'
import EmptyState from '../components/ui/EmptyState.vue'
defineOptions({ inheritAttrs: false })
const site = useSite()
interface Usage {
  limits: MediaLimits
  usedBytes: number
  uploadedPacks: number
  remoteEmoji: RemoteEmojiSettings
}
const { data, loading, error, saving, reload, run } = useResource(
  async () => {
    const [images, packs, usage] = await Promise.all([
      api<MediaAsset[]>('/api/me/media', { token: site.token.value }),
      api<EmojiPack[]>('/api/me/emoji-packs', { token: site.token.value }),
      api<Usage>('/api/me/media-usage', { token: site.token.value }),
    ])
    return { images, packs, usage }
  },
  { images: [] as MediaAsset[], packs: [] as EmojiPack[], usage: null as Usage | null },
)
const tab = ref('images'),
  uploadOpen = ref(false),
  packOpen = ref(false),
  packName = ref(''),
  packTarget = ref<string | number>(''),
  target = ref<string | number>('library'),
  input = ref<HTMLInputElement | null>(null),
  fileNames = ref('')
const asset = ref<MediaAsset | null>(null),
  assetOpen = ref(false),
  alt = ref('')
const previewOpen = ref(false),
  previewName = ref(''),
  previewImages = ref<MediaAsset[]>([])
async function previewPack(pack: EmojiPack) {
  if (
    await run(async () => {
      previewImages.value = await api<MediaAsset[]>(`/api/me/emoji-packs/${pack.id}/images`, {
        token: site.token.value,
      })
    })
  ) {
    previewName.value = pack.name
    previewOpen.value = true
  }
}
const uploadPacks = computed(() =>
  data.value.packs.filter((pack) => !pack.remote_source && !pack.is_community),
)
const personalPacks = computed(() => data.value.packs.filter((pack) => !pack.is_community))
async function movePack(pack: EmojiPack, direction: number) {
  const ids = personalPacks.value.map((item) => item.id)
  const index = ids.indexOf(pack.id)
  const next = index + direction
  if (next < 0 || next >= ids.length) return
  ;[ids[index], ids[next]] = [ids[next]!, ids[index]!]
  if (
    await run(
      () =>
        api('/api/me/emoji-pack-order', {
          method: 'PUT',
          token: site.token.value,
          body: { packIds: ids },
        }),
      '表情包顺序已保存',
    )
  )
    await reload()
}
function showUpload() {
  target.value = site.settings.contentLimits.directLibraryUploads ? 'library' : 'emoji'
  error.value = ''
  fileNames.value = ''
  uploadOpen.value = true
}
function selectFiles(event: Event) {
  fileNames.value = Array.from((event.target as HTMLInputElement).files || [])
    .map((file) => file.name)
    .join('、')
}
async function upload() {
  const files = Array.from(input.value?.files || [])
  if (!files.length) {
    error.value = '请选择图片'
    return
  }
  if (
    await run(async () => {
      for (const file of files)
        await api(
          `/api/me/media?collection=${target.value}${target.value === 'emoji' ? `&packId=${packTarget.value}` : ''}`,
          { method: 'POST', token: site.token.value, body: uploadForm(file) },
        )
    }, '图片已上传')
  ) {
    uploadOpen.value = false
    await reload()
  }
}
async function newPack() {
  if (
    await run(
      () =>
        api('/api/me/emoji-packs', {
          method: 'POST',
          token: site.token.value,
          body: { name: packName.value },
        }),
      '表情包已创建',
    )
  ) {
    packOpen.value = false
    packName.value = ''
    await reload()
  }
}
function show(image: MediaAsset) {
  asset.value = image
  alt.value = image.alt_text
  error.value = ''
  assetOpen.value = true
}
async function saveAsset() {
  if (
    await run(
      () =>
        api(`/api/me/media/${asset.value!.id}`, {
          method: 'PATCH',
          token: site.token.value,
          body: { altText: alt.value },
        }),
      '图片说明已保存',
    )
  ) {
    assetOpen.value = false
    await reload()
  }
}
async function removeImage(image: MediaAsset) {
  assetOpen.value = false
  if (await site.confirm('删除图片？', '正文中使用此图的位置会显示占位图，原图片地址将失效。', '删除'))
    if (
      await run(
        () => api(`/api/me/media/${image.id}`, { method: 'DELETE', token: site.token.value }),
        '图片已删除',
      )
    )
      await reload()
}
async function removePack(pack: EmojiPack) {
  if (
    await site.confirm(
      `移除“${pack.name}”？`,
      pack.remote_source ? '从个人表情包中移除。' : '此表情包和其中的图片将被删除。',
      '移除',
    )
  )
    if (
      await run(
        () => api(`/api/me/emoji-packs/${pack.id}`, { method: 'DELETE', token: site.token.value }),
        '表情包已移除',
      )
    )
      await reload()
}
async function copy(image: MediaAsset) {
  await navigator.clipboard.writeText(new URL(image.url, site.settings.url || window.location.origin).href)
  site.notify('图片链接已复制')
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="我的图片"
        ><WinButton
          v-if="!site.user.value?.isBanned"
          label="新建表情包"
          icon="emoji"
          @click="packOpen = true" /><WinButton
          v-if="!site.user.value?.isBanned"
          :label="site.settings.contentLimits.directLibraryUploads ? '上传图片' : '上传表情'"
          icon="upload"
          accent
          @click="showUpload"
      /></PageHeader>
      <ResourceState :loading="loading" :error="uploadOpen || packOpen || assetOpen ? '' : error" />
      <p v-if="!site.settings.contentLimits.directLibraryUploads" class="secondary-text">
        正文图片在发帖或回复时添加，成功发布后会出现在这里。
      </p>
      <section v-if="data.usage" class="surface-card storage-summary">
        <div class="section-toolbar">
          <h2>图床容量</h2>
          <span
            >{{ formatBytes(data.usage.usedBytes) }} / {{ formatBytes(data.usage.limits.storageBytes) }}</span
          >
        </div>
        <ProgressBar :Value="data.usage.usedBytes" :Maximum="data.usage.limits.storageBytes" />
        <p class="secondary-text">
          单图 {{ formatBytes(data.usage.limits.imageBytes) }} · 表情包 {{ data.usage.uploadedPacks }} /
          {{ data.usage.limits.emojiPackCount }} 组 · 个人上传每组
          {{ data.usage.limits.emojiImagesPerPack }} 张 · 单张表情
          {{ formatBytes(data.usage.limits.emojiImageBytes) }}
        </p>
      </section>
      <div class="section-toolbar">
        <div class="row-actions">
          <WinButton label="个人上传" :accent="tab === 'images'" subtle @click="tab = 'images'" /><WinButton
            label="我的表情包"
            :accent="tab === 'packs'"
            subtle
            @click="tab = 'packs'"
          /><WinButton
            v-if="data.usage?.remoteEmoji.enabled && !site.user.value?.isBanned"
            label="远端表情包"
            :accent="tab === 'remote'"
            subtle
            @click="tab = 'remote'"
          />
        </div>
      </div>
      <template v-if="tab === 'images'"
        ><EmptyState v-if="!loading && !data.images.length" title="还没有上传图片" icon="image" />
        <div class="media-grid">
          <article v-for="image in data.images" :key="image.id" class="media-card">
            <button
              class="media-preview"
              type="button"
              :aria-label="`查看 ${image.original_name}`"
              @click="show(image)"
            >
              <img :src="image.url" :alt="image.alt_text" loading="lazy" />
            </button>
            <div class="media-card-info">
              <strong>{{ image.original_name }}</strong
              ><small
                >{{ formatBytes(Number(image.byte_size))
                }}<template v-if="image.pack_name"> · {{ image.pack_name }}</template></small
              >
              <div class="row-actions">
                <WinButton label="复制链接" icon="copy" subtle @click="copy(image)" /><WinButton
                  v-if="!site.user.value?.isBanned"
                  label="删除"
                  icon="delete"
                  subtle
                  @click="removeImage(image)"
                />
              </div>
            </div>
          </article></div
      ></template>
      <template v-else-if="tab === 'packs'"
        ><EmptyState v-if="!data.packs.length" title="还没有个人表情包" icon="emoji" />
        <section v-for="pack in data.packs" :key="pack.id" class="surface-card personal-emoji-pack">
          <div class="setting-row">
            <div class="pack-summary">
              <button
                class="pack-cover"
                type="button"
                :aria-label="`预览 ${pack.name}`"
                @click="previewPack(pack)"
              >
                <img
                  v-for="(url, index) in pack.preview_urls || []"
                  :key="url"
                  :src="url"
                  :alt="`${pack.name} 预览 ${index + 1}`"
                  loading="lazy"
                />
                <span v-if="!pack.preview_urls?.length" class="secondary-text">暂无表情</span>
              </button>
              <div>
                <h2>{{ pack.name }}</h2>
                <small
                  >{{ pack.emoji_count }} 张 ·
                  {{
                    pack.is_community
                      ? '社区表情 · 固定置顶'
                      : pack.remote_source
                        ? pack.variant === 'animated'
                          ? '远端动态'
                          : '远端静态'
                        : '个人上传'
                  }}</small
                >
              </div>
            </div>
            <div class="row-actions">
              <template v-if="!pack.is_community && !site.user.value?.isBanned">
                <WinButton
                  label="上移"
                  subtle
                  :disabled="saving || personalPacks[0]?.id === pack.id"
                  @click="movePack(pack, -1)"
                />
                <WinButton
                  label="下移"
                  subtle
                  :disabled="saving || personalPacks[personalPacks.length - 1]?.id === pack.id"
                  @click="movePack(pack, 1)"
                />
              </template>
              <WinButton label="查看表情" icon="emoji" @click="previewPack(pack)" /><WinButton
                v-if="!pack.is_community && !site.user.value?.isBanned"
                label="移除"
                icon="delete"
                subtle
                :disabled="saving"
                @click="removePack(pack)"
              />
            </div>
          </div></section
      ></template>
      <RemoteEmojiBrowser v-else-if="tab === 'remote' && data.usage?.remoteEmoji.enabled" @added="reload" />
      <WinDialog
        v-model:open="uploadOpen"
        title="上传图片"
        primary="上传"
        :busy="saving"
        :error="error"
        @primary="upload"
        ><WinSelect
          v-model="target"
          label="上传到"
          :options="[
            ...(site.settings.contentLimits.directLibraryUploads
              ? [{ value: 'library', label: '图床' }]
              : []),
            { value: 'emoji', label: '表情包' },
          ]"
        /><WinSelect
          v-if="target === 'emoji'"
          v-model="packTarget"
          label="表情包"
          :options="uploadPacks.map((pack) => ({ value: pack.id, label: pack.name }))"
        /><WinButton label="选择图片" icon="image" @click="input?.click()" /><input
          ref="input"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif"
          class="visually-hidden"
          @change="selectFiles"
        />
        <p v-if="fileNames" class="file-selection">{{ fileNames }}</p></WinDialog
      >
      <WinDialog
        v-model:open="packOpen"
        title="新建表情包"
        primary="创建"
        :busy="saving"
        :error="error"
        @primary="newPack"
        ><TextBox v-model:Text="packName" Header="名称" aria-label="表情包名称" :MaxLength="64"
      /></WinDialog>
      <WinDialog
        v-model:open="assetOpen"
        title="图片详情"
        :primary="site.user.value?.isBanned ? '' : '保存说明'"
        :busy="saving"
        :error="error"
        @primary="saveAsset"
        ><template v-if="asset"
          ><img class="asset-detail-preview" :src="asset.url" :alt="asset.alt_text" /><TextBox
            v-model:Text="alt"
            :IsReadOnly="site.user.value?.isBanned"
            Header="图片说明"
            aria-label="图片说明"
            :MaxLength="160" /><WinButton label="复制链接" icon="copy" @click="copy(asset)" /></template
      ></WinDialog>
      <WinDialog v-model:open="previewOpen" :title="previewName" close="完成"
        ><div class="emoji-preview-grid">
          <Button
            v-for="image in previewImages"
            :key="image.id"
            class="emoji-copy"
            Style="{StaticResource SubtleButtonStyle}"
            :title="`复制 ${image.alt_text}`"
            :aria-label="`复制 ${image.alt_text}`"
            @Click="copy(image)"
          >
            <img :src="image.url" :alt="image.alt_text" loading="lazy" />
          </Button></div
      ></WinDialog>
    </div>
  </div>
</template>
