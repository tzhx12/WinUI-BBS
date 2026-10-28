<script setup lang="ts">
import type { Category } from '../types'
import { FontIcon } from 'winuionweb'
defineProps<{ item: Category }>()
</script>
<template>
  <div class="category-tree-item">
    <FontIcon :Glyph="item.icon_glyph" FontFamily="Segoe Fluent Icons" :FontSize="20" /><strong>{{
      item.name
    }}</strong
    ><span class="secondary-text">{{ item.post_count || 0 }} 帖</span
    ><span v-if="item.minimum_reader_level" class="tag">Lv.{{ item.minimum_reader_level }}+</span>
  </div>
</template>
