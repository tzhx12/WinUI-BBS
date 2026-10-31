<script setup lang="ts">
import { FontIcon } from 'winuionweb'
import type { Category } from '../types'
withDefaults(defineProps<{ category: Pick<Category, 'icon_glyph' | 'icon_image_url'>; size?: number }>(), {
  size: 24,
})
</script>
<template>
  <img
    v-if="category.icon_image_url"
    class="category-custom-icon"
    :src="category.icon_image_url"
    alt=""
    :width="size"
    :height="size"
  />
  <FontIcon v-else :Glyph="category.icon_glyph" FontFamily="Segoe Fluent Icons" :FontSize="size" />
</template>
