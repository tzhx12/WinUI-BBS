<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button, PipsPager } from 'winuionweb'
const props = defineProps<{
  packs: Array<{
    id: string
    name: string
    emojis: Array<{ id: string; url: string; name: string; remote: boolean }>
  }>
  error: string
}>()
defineEmits<{ select: [emoji: { id: string; url: string; name: string; remote: boolean }] }>()
const selected = ref(0)
const hoveredName = ref('')
const grid = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
let wheelHost: Element | null = null
const groups = computed(() => props.packs.filter((pack) => pack.emojis.length))
const current = computed(() => groups.value[selected.value])
let lastEvent = 0
let lastSwitch = 0
let lastDirection = 0
let edgeDistance = 0
let wheelLocked = false
function switchGroup(event: WheelEvent) {
  if (!event.deltaY || event.ctrlKey) return
  event.preventDefault()
  event.stopPropagation()
  const now = performance.now()
  const elapsed = now - lastEvent
  lastEvent = now
  // A continuing wheel gesture must not carry momentum into another group.
  if (wheelLocked) {
    if (elapsed < 180 || now - lastSwitch < 350) return
    wheelLocked = false
  }
  const viewport = grid.value
  if (!viewport) return
  const delta =
    event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1)
  const direction = Math.sign(delta)
  if (direction !== lastDirection || elapsed > 600) edgeDistance = 0
  lastDirection = direction
  const bottom = viewport.scrollHeight - viewport.clientHeight
  const atEdge = direction > 0 ? viewport.scrollTop >= bottom - 1 : viewport.scrollTop <= 1
  if (!atEdge) {
    viewport.scrollTop += delta
    edgeDistance = 0
    return
  }
  if (current.value!.emojis.length > 20) {
    edgeDistance += Math.min(Math.abs(delta), 120)
    if (edgeDistance < 240) return
  }
  const next = Math.max(0, Math.min(groups.value.length - 1, selected.value + direction))
  if (next === selected.value) return
  selected.value = next
  edgeDistance = 0
  lastSwitch = now
  wheelLocked = true
  void nextTick(() => {
    if (grid.value) grid.value.scrollTop = direction < 0 ? grid.value.scrollHeight : 0
  })
}
function showName(event: Event) {
  const button = (event.target as HTMLElement).closest('button')
  hoveredName.value = button?.getAttribute('aria-label') || ''
}
function attachWheel() {
  wheelHost?.removeEventListener('wheel', handleWheel, true)
  wheelHost = panel.value?.closest('.flyout-presenter') || panel.value
  wheelHost?.addEventListener('wheel', handleWheel, { passive: false, capture: true })
  edgeDistance = 0
  wheelLocked = false
}
const handleWheel = (event: Event) => switchGroup(event as WheelEvent)
onMounted(attachWheel)
onBeforeUnmount(() => wheelHost?.removeEventListener('wheel', handleWheel, true))
defineExpose({ attachWheel })
watch(groups, (packs) => {
  selected.value = Math.min(selected.value, Math.max(0, packs.length - 1))
})
watch(selected, () => {
  hoveredName.value = ''
  edgeDistance = 0
  if (grid.value) grid.value.scrollTop = 0
})
</script>
<template>
  <div ref="panel" class="emoji-picker">
    <template v-if="current">
      <div class="emoji-picker-heading">
        <strong>{{ current.name }}</strong
        ><small>{{ selected + 1 }} / {{ groups.length }}</small>
      </div>
      <div
        ref="grid"
        class="emoji-pack-items"
        :aria-label="current.name"
        @pointerover="showName"
        @pointerleave="hoveredName = ''"
        @focusin="showName"
        @focusout="hoveredName = ''"
      >
        <Button
          v-for="emoji in current.emojis"
          :key="emoji.id"
          :aria-label="emoji.name"
          :title="emoji.name"
          Style="{StaticResource SubtleButtonStyle}"
          @Click="$emit('select', emoji)"
          ><img :src="emoji.url" :alt="emoji.name" loading="lazy"
        /></Button>
      </div>
      <div class="emoji-hover-name" aria-live="polite">{{ hoveredName || '\u00a0' }}</div>
      <div v-if="groups.length > 1" class="emoji-group-pager" aria-label="表情包分组">
        <PipsPager
          v-model:SelectedPageIndex="selected"
          :NumberOfPages="groups.length"
          :MaxVisiblePips="7"
          PreviousButtonVisibility="Visible"
          NextButtonVisibility="Visible"
        />
      </div>
    </template>
    <p v-if="error" class="emoji-empty">{{ error }}</p>
    <p v-else-if="!groups.length" class="emoji-empty">暂无表情</p>
  </div>
</template>
