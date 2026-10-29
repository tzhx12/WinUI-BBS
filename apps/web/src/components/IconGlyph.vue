<script setup lang="ts">
import { FontIcon } from 'winuionweb'
import type { IconName } from './iconNames'

const props = defineProps<{ name: IconName; size?: number | string }>()

const glyphs: Record<IconName, string> = {
  home: String.fromCharCode(0xe80f),
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
  <FontIcon
    class="icon-glyph"
    :Glyph="glyphs[props.name]"
    FontFamily="Segoe Fluent Icons"
    :FontSize="Number(props.size ?? 18)"
    aria-hidden="true"
  />
</template>
