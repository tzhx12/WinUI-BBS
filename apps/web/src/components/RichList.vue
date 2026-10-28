<script setup lang="ts">
import { inlineHtml, type ListItem } from '../content'
import IconGlyph from './IconGlyph.vue'
defineProps<{ items: Array<ListItem | string>; listStyle: string }>()
</script>
<template>
  <component
    :is="listStyle === 'ordered' ? 'ol' : 'ul'"
    :class="{ 'rich-checklist': listStyle === 'checklist' }"
  >
    <li v-for="(item, index) in items" :key="index">
      <span
        v-if="listStyle === 'checklist'"
        class="checklist-mark"
        :aria-label="typeof item !== 'string' && item.meta?.checked ? '已完成' : '未完成'"
        ><IconGlyph v-if="typeof item !== 'string' && item.meta?.checked" name="check" :size="12"
      /></span>
      <span v-html="inlineHtml(typeof item === 'string' ? item : item.content || item.text)" />
      <RichList
        v-if="typeof item !== 'string' && item.items?.length"
        :items="item.items"
        :list-style="listStyle"
      />
    </li>
  </component>
</template>
