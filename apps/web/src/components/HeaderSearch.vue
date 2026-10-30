<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { TextBox } from 'winuionweb'
import WinButton from './ui/WinButton.vue'
const text = ref('')
const router = useRouter()
const keyword = computed(() => text.value.trim())
function search() {
  if (!keyword.value) return
  void router.push({ path: '/search', query: { q: keyword.value } })
}
function enterSearch(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing || !(event.target instanceof HTMLInputElement)) return
  event.preventDefault()
  search()
}
</script>
<template>
  <form class="header-search" role="search" @submit.prevent="search" @keydown.capture="enterSearch">
    <TextBox
      v-model:Text="text"
      PlaceholderText="搜索帖子"
      aria-label="搜索帖子"
      :MaxLength="120"
    /><WinButton icon="search" label="搜索" subtle :disabled="!keyword" @click="search" />
  </form>
</template>
