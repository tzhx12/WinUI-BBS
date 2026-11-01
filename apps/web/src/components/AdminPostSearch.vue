<script setup lang="ts">
import { TextBox } from 'winuionweb'
import WinButton from './ui/WinButton.vue'
defineProps<{ modelValue: string; loading: boolean }>()
defineEmits<{ 'update:modelValue': [value: string]; search: [] }>()
</script>
<template>
  <form
    class="toolbar-search admin-post-search"
    @submit.prevent="$emit('search')"
    @keydown.enter.prevent="$emit('search')"
  >
    <TextBox
      :Text="modelValue"
      PlaceholderText="标题、作者 UID / UUID、昵称或用户名"
      aria-label="搜索帖子"
      :MaxLength="200"
      @update:Text="$emit('update:modelValue', $event)"
    />
    <WinButton label="搜索" icon="search" :disabled="loading" @click="$emit('search')" />
  </form>
</template>
