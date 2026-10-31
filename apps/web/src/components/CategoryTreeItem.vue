<script setup lang="ts">
import type { Category } from '../types'
import CategoryIcon from './CategoryIcon.vue'
defineProps<{ item: Category }>()
</script>
<template>
  <div class="category-tree-item">
    <CategoryIcon :category="item" :size="20" /><strong>{{
      item.name
    }}</strong
    ><span class="secondary-text">{{ item.post_count || 0 }} 帖</span
    ><span v-if="item.minimum_reader_level" class="tag">Lv.{{ item.minimum_reader_level }}+</span>
  </div>
</template>
