<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Button, Flyout } from 'winuionweb'
import type EditorJS from '@editorjs/editorjs'
import { api } from '../api'
import { contentSize, readDraft, writeDraft } from '../drafts'
import { useSite } from '../site'
import type { EditorData } from '../types'
import IconGlyph from './IconGlyph.vue'
import EmojiPicker from './EmojiPicker.vue'
import WinButton from './ui/WinButton.vue'
import { editorZh } from '../editorZh'
import { inlineRemoteEmojiBlocks } from '../content'

interface Emoji {
  id: string
  url: string
  name: string
  remote: boolean
}

interface EmojiPack {
  id: string
  name: string
  emojis: Emoji[]
}

class EmojiBlockTool {
  private data: { url: string; name: string }
  constructor({ data }: { data: { url: string; name: string } }) {
    this.data = data
  }
  render() {
    const root = document.createElement('div')
    root.className = 'editor-emoji-block'
    const image = document.createElement('img')
    image.src = this.data.url
    image.alt = this.data.name
    root.append(image)
    return root
  }
  save() {
    return this.data
  }
}

class EmojiInlineTool {
  static isInline = true
  static title = '表情'
  static sanitize = { img: { src: true, alt: true, title: true, 'data-remote-emoji': true } }
  render() {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ce-inline-tool'
    button.textContent = '表情'
    button.setAttribute('aria-label', '插入表情')
    return button
  }
  surround(range: Range | null) {
    if (range) savedEmojiRange = range.cloneRange()
    emojiTrigger.value?.closest('button')?.click()
  }
  checkState() {
    return false
  }
}

class SpoilerInlineTool {
  static isInline = true
  static title = '剧透'
  static sanitize = { span: { class: 'forum-spoiler', 'data-spoiler': true } }
  private button?: HTMLButtonElement

  render() {
    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'ce-inline-tool'
    this.button.textContent = '剧透'
    this.button.setAttribute('aria-label', '遮蔽所选文字')
    return this.button
  }

  surround(range: Range | null) {
    if (!range) return
    const selection = window.getSelection()
    const anchor = selection?.anchorNode
    const existing =
      anchor instanceof Element
        ? anchor.closest('[data-spoiler]')
        : anchor?.parentElement?.closest('[data-spoiler]')
    if (existing) {
      const parent = existing.parentNode
      while (existing.firstChild) parent?.insertBefore(existing.firstChild, existing)
      existing.remove()
      return
    }

    const spoiler = document.createElement('span')
    spoiler.className = 'forum-spoiler'
    spoiler.dataset.spoiler = 'true'
    spoiler.append(range.extractContents())
    range.insertNode(spoiler)
  }

  checkState(selection: Selection) {
    const anchor = selection.anchorNode
    const active =
      anchor instanceof Element
        ? anchor.closest('[data-spoiler]')
        : anchor?.parentElement?.closest('[data-spoiler]')
    this.button?.classList.toggle('ce-inline-tool--active', Boolean(active))
    return Boolean(active)
  }
}

const props = defineProps<{
  token: string
  initialData?: EditorData | null
  draftKey: string
  metadata?: Record<string, unknown>
  kind?: 'post' | 'reply'
}>()
const emit = defineEmits<{ restored: [metadata: Record<string, unknown>] }>()
const site = useSite()
const size = ref({ characters: 0, images: 0 })
const draftStatus = ref('草稿仅保存在此浏览器')
const assets = new Map<string, { file: Blob; name: string; url: string }>()
let discarded = false
let ready = false
let timer: ReturnType<typeof setTimeout> | undefined
let pendingWrite = Promise.resolve()
const limits = computed(() => ({
  characters:
    props.kind === 'reply'
      ? site.settings.contentLimits.replyCharacters
      : site.settings.contentLimits.postCharacters,
  images:
    props.kind === 'reply' ? site.settings.contentLimits.replyImages : site.settings.contentLimits.postImages,
}))
const holder = ref<HTMLElement | null>(null)
const emojiTrigger = ref<HTMLElement | null>(null)
let savedEmojiRange: Range | null = null
const editor = shallowRef<EditorJS | null>(null)
const emojiPacks = ref<EmojiPack[]>([])
const emojiFlyoutControl = ref<InstanceType<typeof Flyout> | null>(null)
const emojiPickerControl = ref<InstanceType<typeof EmojiPicker> | null>(null)
const emojiFlyout = computed(() =>
  h(
    Flyout,
    {
      ref: emojiFlyoutControl,
      Placement: 'Top',
      onOpened: () => emojiPickerControl.value?.attachWheel(),
      onClosed: () => {
        void nextTick(restoreEmojiSelection)
      },
    },
    {
      default: () =>
        h(EmojiPicker, {
          ref: emojiPickerControl,
          packs: emojiPacks.value,
          error: emojiError.value,
          onSelect: insertEmoji,
        }),
    },
  ),
)
const uploadBusy = ref(false)
const uploadInput = ref<HTMLInputElement | null>(null)
const emojiError = ref('')
const editorError = ref('')
const uploadError = ref('')
let destroyed = false

onMounted(() => {
  void initializeEditor()
})

async function initializeEditor() {
  void api<EmojiPack[]>('/api/emoji-packs', { token: props.token })
    .then((packs) => {
      emojiPacks.value = packs
    })
    .catch(() => {
      emojiError.value = '表情包暂不可用'
    })
  try {
    const draft = await readDraft(props.draftKey)
    let initialData = props.initialData ?? { blocks: [] }
    if (draft) {
      for (const asset of draft.assets)
        assets.set(asset.id, { file: asset.file, name: asset.name, url: URL.createObjectURL(asset.file) })
      initialData = structuredClone(draft.body)
      for (const block of initialData.blocks)
        if (block.type === 'image') {
          const file = block.data.file as { url: string }
          if (assets.has(file.url)) file.url = assets.get(file.url)!.url
        }
      emit('restored', draft.metadata)
      draftStatus.value = '已恢复此浏览器中的草稿'
    }
    const [
      editorModule,
      headerModule,
      imageModule,
      codeModule,
      listModule,
      markerModule,
      quoteModule,
      delimiterModule,
    ] = await Promise.all([
      import('@editorjs/editorjs'),
      import('@editorjs/header'),
      import('@editorjs/image'),
      import('@editorjs/inline-code'),
      import('@editorjs/list'),
      import('@editorjs/marker'),
      import('@editorjs/quote'),
      import('@editorjs/delimiter'),
    ])
    if (destroyed) return
    const EditorJSClass = editorModule.default
    initialData = inlineRemoteEmojiBlocks(initialData)
    editor.value = new EditorJSClass({
      holder: holder.value!,
      data: initialData,
      onChange: scheduleDraft,
      placeholder: '写下值得讨论的内容…',
      i18n: editorZh,
      inlineToolbar: ['bold', 'italic', 'link', 'marker', 'inlineCode', 'spoiler', 'emojiInline'],
      tools: {
        header: {
          class: headerModule.default,
          inlineToolbar: true,
          config: { levels: [2, 3], defaultLevel: 2 },
        },
        list: { class: listModule.default, inlineToolbar: true },
        quote: { class: quoteModule.default, inlineToolbar: true },
        delimiter: delimiterModule.default,
        marker: markerModule.default,
        inlineCode: codeModule.default,
        spoiler: SpoilerInlineTool,
        emoji: EmojiBlockTool,
        emojiInline: EmojiInlineTool,
        image: {
          class: imageModule.default,
          config: {
            captionPlaceholder: '图片说明',
            uploader: {
              uploadByFile: async (file: File) => {
                return { success: 1, file: { url: cacheImage(file) } }
              },
            },
          },
        },
      },
    })
    await editor.value.isReady
    ready = true
    if (destroyed) editor.value?.destroy()
    else size.value = contentSize(await save())
  } catch (cause) {
    editorError.value = cause instanceof Error ? cause.message : '编辑器暂不可用'
  }
}

onBeforeUnmount(() => {
  destroyed = true
  clearTimeout(timer)
  void persistDraft().finally(() => {
    editor.value?.destroy?.()
    for (const asset of assets.values()) URL.revokeObjectURL(asset.url)
  })
})

watch(() => props.metadata, scheduleDraft, { deep: true })
function scheduleDraft() {
  if (!ready || discarded) return
  clearTimeout(timer)
  timer = setTimeout(() => {
    void persistDraft()
  }, 250)
}
function cacheImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type))
    throw new Error('仅支持 PNG、JPEG、WebP 和 GIF 图片')
  const id = `draft:${crypto.randomUUID()}`
  const url = URL.createObjectURL(file)
  assets.set(id, { file, name: file.name, url })
  return url
}
function serialize(body: EditorData) {
  const result = structuredClone(body)
  const used = new Set<string>()
  for (const block of result.blocks)
    if (block.type === 'image') {
      const file = block.data.file as { url: string }
      for (const [id, asset] of assets)
        if (file.url === asset.url) {
          file.url = id
          used.add(id)
        }
    }
  return {
    body: result,
    assets: [...used].map((id) => ({ id, file: assets.get(id)!.file, name: assets.get(id)!.name })),
  }
}
async function persistDraft() {
  if (!ready || discarded) return
  try {
    const body = await save()
    if (discarded) return
    size.value = contentSize(body)
    const value = { ...serialize(body), metadata: { ...props.metadata } }
    pendingWrite = pendingWrite.catch(() => {}).then(() => writeDraft(props.draftKey, value))
    await pendingWrite
    draftStatus.value = '草稿已保存在此浏览器'
  } catch (cause) {
    uploadError.value = (cause as Error).message
  }
}
async function submission(extra: Record<string, unknown> = {}) {
  const current = await save()
  size.value = contentSize(current)
  if (size.value.characters > limits.value.characters)
    throw new Error(`正文最多 ${limits.value.characters} 字`)
  if (size.value.images > limits.value.images)
    throw new Error(`正文最多 ${limits.value.images} 张图片（含表情）`)
  const value = serialize(current)
  const payload = { ...extra, body: value.body }
  if (!value.assets.length) return payload
  const form = new FormData()
  form.append('payload', JSON.stringify(payload))
  for (const asset of value.assets) form.append(asset.id, asset.file, asset.name)
  return form
}
async function clearDraft() {
  discarded = true
  clearTimeout(timer)
  await pendingWrite.catch(() => {})
  await writeDraft(props.draftKey)
}

async function save() {
  if (!editor.value) throw new Error('编辑器尚未就绪')
  await editor.value.isReady
  return (await editor.value.save()) as EditorData
}

function rememberSelection() {
  const selection = window.getSelection()
  if (selection?.rangeCount && holder.value?.contains(selection.getRangeAt(0).commonAncestorContainer))
    savedEmojiRange = selection.getRangeAt(0).cloneRange()
}
function protectInlineEmojiDeletion(event: KeyboardEvent) {
  if (event.isComposing || !['Backspace', 'Delete'].includes(event.key)) return
  const selection = window.getSelection()
  if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0)
  const start =
    range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const editable = start?.closest<HTMLElement>('[contenteditable="true"]')
  if (!editable || !holder.value?.contains(editable) || !editable.contains(range.endContainer)) return
  const affected = document.createRange()
  affected.selectNodeContents(editable)
  if (range.collapsed) {
    if (event.key === 'Backspace') affected.setEnd(range.startContainer, range.startOffset)
    else affected.setStart(range.endContainer, range.endOffset)
  }
  if (!affected.cloneContents().querySelector('img[data-remote-emoji]')) return
  // Editor.js checks textContent at block boundaries and treats an emoji-only run as empty.
  event.stopPropagation()
}
function preserveEmojiParagraph(event: KeyboardEvent) {
  const editable = (event.target as HTMLElement).closest('[contenteditable="true"]')
  // The built-in paragraph tool clears innerHTML on keyup when textContent is empty.
  if (
    ['Backspace', 'Delete'].includes(event.key) &&
    editable?.querySelector('img[data-remote-emoji]') &&
    !editable.textContent
  )
    event.stopPropagation()
  rememberSelection()
}
function restoreEmojiSelection() {
  if (!savedEmojiRange || !holder.value?.contains(savedEmojiRange.commonAncestorContainer)) return
  const node = savedEmojiRange.startContainer
  const element = node instanceof HTMLElement ? node : node.parentElement
  element?.closest<HTMLElement>('[contenteditable="true"]')?.focus()
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(savedEmojiRange)
}
function insertEmoji(emoji: Emoji) {
  if (!editor.value || !holder.value) return
  emojiFlyoutControl.value?.Hide()
  if (!emoji.remote) {
    savedEmojiRange = null
    editor.value.blocks.insert('emoji', { url: emoji.url, name: emoji.name })
    return
  }
  if (!savedEmojiRange || !holder.value.contains(savedEmojiRange.commonAncestorContainer)) {
    let index = editor.value.blocks.getCurrentBlockIndex()
    let editable = editor.value.blocks
      .getBlockByIndex(index)
      ?.holder.querySelector<HTMLElement>('[contenteditable="true"]')
    if (!editable) {
      editor.value.blocks.insert('paragraph', { text: '' }, undefined, index + 1)
      index = editor.value.blocks.getCurrentBlockIndex()
      editable = editor.value.blocks
        .getBlockByIndex(index)
        ?.holder.querySelector<HTMLElement>('[contenteditable="true"]')
    }
    if (!editable) return
    savedEmojiRange = document.createRange()
    savedEmojiRange.selectNodeContents(editable)
    savedEmojiRange.collapse(false)
  }
  const image = document.createElement('img')
  image.src = emoji.url
  image.alt = emoji.name
  image.title = emoji.name
  image.dataset.remoteEmoji = emoji.id
  savedEmojiRange.deleteContents()
  savedEmojiRange.insertNode(image)
  savedEmojiRange.setStartAfter(image)
  savedEmojiRange.collapse(true)
  restoreEmojiSelection()
  image.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
  scheduleDraft()
}

async function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !editor.value) return
  uploadBusy.value = true
  uploadError.value = ''
  try {
    const url = cacheImage(file)
    editor.value.blocks.insert('image', { file: { url }, caption: file.name })
    scheduleDraft()
  } catch (cause) {
    uploadError.value = cause instanceof Error ? cause.message : '无法上传图片'
  } finally {
    uploadBusy.value = false
    input.value = ''
  }
}

defineExpose({ save, submission, clearDraft })
</script>

<template>
  <div class="editor-composer">
    <div
      ref="holder"
      class="editor-holder"
      @keydown.capture="protectInlineEmojiDeletion"
      @keyup.capture="preserveEmojiParagraph"
      @pointerup="rememberSelection"
    />
    <div class="editor-actions">
      <div class="editor-tools" @pointerdown.capture="rememberSelection" @keydown.capture="rememberSelection">
        <WinButton
          :label="uploadBusy ? '添加中' : '图片'"
          icon="image"
          subtle
          :disabled="uploadBusy"
          @click="uploadInput?.click()"
        />
        <Button :Flyout="emojiFlyout" Style="{StaticResource SubtleButtonStyle}" aria-label="插入表情包"
          ><span ref="emojiTrigger" class="button-content"
            ><IconGlyph name="emoji" :size="16" /><span>表情</span></span
          ></Button
        >
      </div>
      <input
        ref="uploadInput"
        class="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        @change="uploadImage"
      />
      <span v-if="editorError || uploadError" class="editor-error" role="alert">{{
        editorError || uploadError
      }}</span>
    </div>
    <p class="editor-draft-status" aria-live="polite">
      {{ size.characters }} / {{ limits.characters }} 字 · {{ size.images }} / {{ limits.images }} 张图片 ·
      {{ draftStatus }}
    </p>
  </div>
</template>
