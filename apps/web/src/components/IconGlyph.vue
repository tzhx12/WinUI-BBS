<script setup lang="ts">
import type { IconName } from './iconNames'

const props = defineProps<{ name: IconName; size?: number | string }>()

// Pair new codepoints in icons/fluent-system-icons.json and rebuild the bridge font.
const glyphs: Record<IconName, string> = {
  home: String.fromCharCode(0xe80f),
  fire: String.fromCharCode(0xecad),
  search: String.fromCharCode(0xe721),
  add: String.fromCharCode(0xe710),
  edit: String.fromCharCode(0xe70f),
  delete: String.fromCharCode(0xe74d),
  more: String.fromCharCode(0xe712),
  close: String.fromCharCode(0xe711),
  back: String.fromCharCode(0xe72b),
  people: String.fromCharCode(0xe716),
  person: String.fromCharCode(0xe77b),
  settings: String.fromCharCode(0xe713),
  category: String.fromCharCode(0xe8b7),
  chat: String.fromCharCode(0xe8bd),
  image: String.fromCharCode(0xe8b9),
  emoji: String.fromCharCode(0xe76e),
  calendar: String.fromCharCode(0xe787),
  like: String.fromCharCode(0xe8e1),
  favorite: '\ue734',
  pin: String.fromCharCode(0xe840),
  shield: String.fromCharCode(0xe72e),
  chart: String.fromCharCode(0xe9d2),
  clock: String.fromCharCode(0xe823),
  check: String.fromCharCode(0xe73e),
  arrow: String.fromCharCode(0xe72a),
  logout: String.fromCharCode(0xe8ac),
  eye: String.fromCharCode(0xe890),
  tag: String.fromCharCode(0xe8ec),
  folder: String.fromCharCode(0xe8b7),
  sparkle: String.fromCharCode(0xe734),
  mail: String.fromCharCode(0xe715),
  lock: String.fromCharCode(0xe72e),
  theme: '\ue708',
  brush: '\ue771',
  refresh: '\ue72c',
  upload: '\ue898',
  copy: '\ue8c8',
}
</script>

<template>
  <span class="icon-glyph" :style="{ fontSize: `${Number(props.size ?? 18)}px` }" aria-hidden="true">{{
    glyphs[props.name]
  }}</span>
</template>

<style scoped>
.icon-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 1em;
  height: 1em;
  line-height: 1;
  font-weight: normal;
  font-style: normal;
}
</style>
