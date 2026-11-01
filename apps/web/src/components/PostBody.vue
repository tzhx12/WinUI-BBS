<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount } from 'vue'
import { previewImages } from 'hevue-img-preview/v3'
import type { EditorData } from '../types'
import { inlineHtml as html, inlineRemoteEmojiBlocks, type ListItem } from '../content'
import RichList from './RichList.vue'

const props = withDefaults(
  defineProps<{ data: EditorData | null | undefined; previewMode?: 'gallery' | 'single' }>(),
  { previewMode: 'gallery' },
)
const emit = defineEmits<{ unlock: [condition: string] }>()
const blocks = computed(() => inlineRemoteEmojiBlocks(props.data ?? { blocks: [] }).blocks)
const images = computed(() =>
  blocks.value.flatMap((block, index) => {
    const url = block.type === 'image' ? (block.data.file as { url?: string })?.url : undefined
    return url && url !== '/deleted-image.png' ? [{ url, index }] : []
  }),
)
let preview: ReturnType<typeof previewImages> | undefined
function openPreview(index: number, event: Event) {
  const selected = images.value.find((image) => image.index === index)
  if (!selected) return
  const trigger = event.currentTarget as HTMLElement
  const single = props.previewMode === 'single'
  preview = previewImages({
    imgList: single ? [selected.url] : images.value.map((image) => image.url),
    nowImgIndex: single ? 0 : images.value.indexOf(selected),
    thumbnail: !single && images.value.length > 1,
    arrowBtn: !single && images.value.length > 1,
    disableTransition: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    closeFn: () => {
      preview = undefined
      if (trigger.isConnected) trigger.focus({ preventScroll: true })
    },
  })
  void nextTick(() => {
    const overlay = document.querySelector<HTMLElement>('.hevue-imgpreview-wrap')!
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-label', '图片预览')
    overlay.tabIndex = -1
    overlay.focus({ preventScroll: true })
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        preview?.close()
      } else if (event.key === 'Tab') {
        const controls = [...overlay.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')].filter(
          (element) => element.getClientRects().length,
        )
        const edge = event.shiftKey ? controls[0] : controls.at(-1)
        if (!controls.length || document.activeElement === edge || document.activeElement === overlay) {
          event.preventDefault()
          ;(event.shiftKey ? controls.at(-1) : controls[0])?.focus()
        }
      }
    })
  })
}
onBeforeUnmount(() => preview?.close())

function revealSpoiler(event: MouseEvent | KeyboardEvent) {
  if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return
  const target = event.target
  if (!(target instanceof Element)) return
  const locked = target.closest<HTMLElement>('[data-lock-state="locked"]')
  if (locked) {
    event.preventDefault()
    emit('unlock', locked.dataset.contentLock!)
    return
  }
  const spoiler = target.closest<HTMLElement>('[data-spoiler]')
  if (!spoiler || (spoiler.classList.contains('is-revealed') && target.closest('a'))) return
  event.preventDefault()
  const revealed = spoiler.classList.toggle('is-revealed')
  spoiler.setAttribute('aria-expanded', String(revealed))
  spoiler.setAttribute('aria-label', revealed ? '隐藏剧透文字' : '显示剧透文字')
}
</script>

<template>
  <div class="post-body" @click="revealSpoiler" @keydown="revealSpoiler">
    <template v-for="(block, index) in blocks" :key="block.id ?? index">
      <p v-if="block.type === 'paragraph'" v-html="html(block.data.text)" />
      <component
        :is="Number(block.data.level) <= 2 ? 'h2' : 'h3'"
        v-else-if="block.type === 'header'"
        v-html="html(block.data.text)"
      />
      <blockquote v-else-if="block.type === 'quote'">
        <p v-html="html(block.data.text)" />
        <cite v-if="block.data.caption" v-html="html(block.data.caption)" />
      </blockquote>
      <RichList
        v-else-if="block.type === 'list'"
        :items="block.data.items as Array<ListItem | string>"
        :list-style="String(block.data.style)"
      />
      <figure v-else-if="block.type === 'image' && (block.data.file as { url?: string })?.url">
        <img
          :src="(block.data.file as { url: string }).url"
          :alt="
            (block.data.file as { url: string }).url === '/deleted-image.png'
              ? '作者已删除图片，阿卡林消失了'
              : String(block.data.caption ?? '')
          "
          :class="{
            'deleted-image': (block.data.file as { url: string }).url === '/deleted-image.png',
            'previewable-image': (block.data.file as { url: string }).url !== '/deleted-image.png',
          }"
          loading="lazy"
          :tabindex="(block.data.file as { url: string }).url !== '/deleted-image.png' ? 0 : undefined"
          :role="(block.data.file as { url: string }).url !== '/deleted-image.png' ? 'button' : undefined"
          :aria-label="
            (block.data.file as { url: string }).url !== '/deleted-image.png'
              ? `预览图片${block.data.caption ? `：${block.data.caption}` : ''}`
              : undefined
          "
          @click.stop="openPreview(index, $event)"
          @keydown.enter.stop.prevent="openPreview(index, $event)"
          @keydown.space.stop.prevent="openPreview(index, $event)"
        />
        <figcaption v-if="block.data.caption" v-html="html(block.data.caption)" />
      </figure>
      <figure v-else-if="block.type === 'emoji'" class="post-emoji">
        <img :src="String(block.data.url)" :alt="String(block.data.name)" loading="lazy" />
      </figure>
      <pre v-else-if="block.type === 'code'"><code>{{ block.data.code }}</code></pre>
      <hr v-else-if="block.type === 'delimiter'" />
      <p
        v-else-if="block.type === 'spoiler'"
        class="block-spoiler"
        @click.stop="($event.currentTarget as HTMLElement).classList.toggle('is-revealed')"
      >
        {{ block.data.text }}
      </p>
    </template>
  </div>
</template>
