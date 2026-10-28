<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { TextBox } from 'winuionweb'
import WinButton from './ui/WinButton.vue'
const text = ref('')
const router = useRouter()
function search() {
  void router.push({ path: '/search', query: { q: text.value.trim() } })
}
</script>
<template>
  <form class="header-search" role="search" @submit.prevent="search">
    <TextBox v-model:Text="text" PlaceholderText="搜索帖子" aria-label="搜索帖子" /><WinButton
      icon="search"
      label="搜索"
      subtle
      @click="search"
    />
  </form>
</template>
