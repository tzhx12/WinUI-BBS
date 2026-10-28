<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { Button, Flyout } from 'winuionweb'
import type EditorJS from '@editorjs/editorjs'
import { api, uploadForm } from '../api'
import type { EditorData } from '../types'
import IconGlyph from './IconGlyph.vue'
import EmojiPicker from './EmojiPicker.vue'
import WinButton from './ui/WinButton.vue'
import { editorZh } from '../editorZh'

interface Emoji {
  id: string
  url: string
  name: string
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

const props = defineProps<{ token: string; initialData?: EditorData | null }>()
const holder = ref<HTMLElement | null>(null)
const editor = shallowRef<EditorJS | null>(null)
const emojiPacks = ref<EmojiPack[]>([])
const emojiFlyoutControl = ref<InstanceType<typeof Flyout> | null>(null)
const emojiFlyout = computed(() =>
  h(
    Flyout,
    { ref: emojiFlyoutControl, Placement: 'Top' },
    {
      default: () =>
        h(EmojiPicker, { packs: emojiPacks.value, error: emojiError.value, onSelect: insertEmoji }),
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
    editor.value = new EditorJSClass({
      holder: holder.value!,
      data: props.initialData ?? { blocks: [] },
      placeholder: '写下值得讨论的内容…',
      i18n: editorZh,
      inlineToolbar: ['bold', 'italic', 'link', 'marker', 'inlineCode', 'spoiler'],
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
        image: {
          class: imageModule.default,
          config: {
            captionPlaceholder: '图片说明',
            uploader: {
              uploadByFile: async (file: File) => {
                const result = await api<{ url: string }>('/api/media', {
                  method: 'POST',
                  token: props.token,
                  body: uploadForm(file),
                })
                return { success: 1, file: { url: result.url } }
              },
            },
          },
        },
      },
    })
    await editor.value.isReady
    if (destroyed) editor.value?.destroy()
  } catch (cause) {
    editorError.value = cause instanceof Error ? cause.message : '编辑器暂不可用'
  }
}

onBeforeUnmount(() => {
  destroyed = true
  editor.value?.destroy?.()
})

async function save() {
  if (!editor.value) throw new Error('编辑器尚未就绪')
  await editor.value.isReady
  return (await editor.value.save()) as EditorData
}

function insertEmoji(emoji: Emoji) {
  editor.value?.blocks.insert('emoji', { url: emoji.url, name: emoji.name })
  emojiFlyoutControl.value?.Hide()
}

async function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !editor.value) return
  uploadBusy.value = true
  uploadError.value = ''
  try {
    const result = await api<{ url: string }>('/api/media', {
      method: 'POST',
      token: props.token,
      body: uploadForm(file),
    })
    editor.value.blocks.insert('image', { file: { url: result.url }, caption: file.name })
  } catch (cause) {
    uploadError.value = cause instanceof Error ? cause.message : '无法上传图片'
  } finally {
    uploadBusy.value = false
    input.value = ''
  }
}

defineExpose({ save })
</script>

<template>
  <div class="editor-composer">
    <div ref="holder" class="editor-holder" />
    <div class="editor-actions">
      <div class="editor-tools">
        <WinButton
          :label="uploadBusy ? '上传中' : '图片'"
          icon="image"
          subtle
          :disabled="uploadBusy"
          @click="uploadInput?.click()"
        />
        <Button :Flyout="emojiFlyout" Style="{StaticResource SubtleButtonStyle}" aria-label="插入表情包"
          ><span class="button-content"><IconGlyph name="emoji" :size="16" /><span>表情</span></span></Button
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
  </div>
</template>
