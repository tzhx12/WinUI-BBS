<script setup lang="ts">
import { computed } from 'vue'
import type { EditorData } from '../types'
import { inlineHtml as html, inlineRemoteEmojiBlocks, type ListItem } from '../content'
import RichList from './RichList.vue'

const props = defineProps<{ data: EditorData | null | undefined }>()
const blocks = computed(() => inlineRemoteEmojiBlocks(props.data ?? { blocks: [] }).blocks)

function revealSpoiler(event: MouseEvent | KeyboardEvent) {
  if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return
  const target = event.target
  if (!(target instanceof Element)) return
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
          :class="{ 'deleted-image': (block.data.file as { url: string }).url === '/deleted-image.png' }"
          loading="lazy"
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
