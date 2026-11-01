<script setup lang="ts">
import { ref, watch } from 'vue'
import { NumberBox } from 'winuionweb'
import WinButton from './ui/WinButton.vue'
const props = defineProps<{ page: number; totalPages: number; loading: boolean }>()
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
  emit('change', Number(event.target.value))
}
</script>
<template>
  <nav class="feed-pagination" aria-label="帖子翻页">
    <div class="feed-page-controls">
      <WinButton label="上一页" :disabled="loading || page <= 1" @click="emit('change', page - 1)" />
      <span aria-live="polite">第 {{ page }} / {{ totalPages }} 页 · 每页 25 篇</span>
      <WinButton label="下一页" :disabled="loading || page >= totalPages" @click="emit('change', page + 1)" />
    </div>
    <div class="feed-page-jump" @keydown.enter.capture="jumpByKeyboard">
      <span>跳至</span>
      <NumberBox
        v-model:Value="jump"
        :Minimum="1"
        :Maximum="totalPages"
        :SmallChange="1"
        SpinButtonPlacementMode="Hidden"
        AutomationProperties.Name="帖子页码"
      />
      <WinButton
        label="跳转"
        :disabled="loading || !Number.isInteger(jump) || jump < 1 || jump > totalPages"
        @click="emit('change', jump)"
      />
    </div>
  </nav>
</template>
