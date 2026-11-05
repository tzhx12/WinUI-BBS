<script setup lang="ts">
import { ref, watch } from 'vue'
import { NumberBox } from 'winuionweb'
import WinButton from './ui/WinButton.vue'
const props = withDefaults(
  defineProps<{
    page: number
    totalPages: number
    loading: boolean
    pageSize?: number
    itemUnit?: string
    label?: string
  }>(),
  { pageSize: 25, itemUnit: '篇', label: '帖子' },
)
const emit = defineEmits<{ change: [page: number] }>()
const jump = ref(props.page)
watch(
  () => props.page,
  (value) => {
    jump.value = value
  },
)
function jumpByKeyboard(event: KeyboardEvent) {
  if (!(event.target instanceof HTMLInputElement)) return
  event.preventDefault()
  change(Number(event.target.value))
}
function change(page: number) {
  if (!props.loading && Number.isInteger(page) && page >= 1 && page <= props.totalPages) emit('change', page)
}
</script>
<template>
  <nav class="feed-pagination" :aria-label="`${label}翻页`">
    <div class="feed-page-controls">
      <WinButton label="上一页" :disabled="loading || page <= 1" @click="change(page - 1)" />
      <span aria-live="polite">第 {{ page }} / {{ totalPages }} 页 · 每页 {{ pageSize }} {{ itemUnit }}</span>
      <WinButton label="下一页" :disabled="loading || page >= totalPages" @click="change(page + 1)" />
    </div>
    <div class="feed-page-jump" @keydown.enter.capture="jumpByKeyboard">
      <span>跳至</span>
      <NumberBox
        v-model:Value="jump"
        :Minimum="1"
        :Maximum="totalPages"
        :SmallChange="1"
        SpinButtonPlacementMode="Hidden"
        v-bind="{ 'AutomationProperties.Name': `${label}页码` }"
      />
      <WinButton
        label="跳转"
        :disabled="loading || !Number.isInteger(jump) || jump < 1 || jump > totalPages"
        @click="change(jump)"
      />
    </div>
  </nav>
</template>
