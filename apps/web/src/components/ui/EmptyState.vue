<script setup lang="ts">
import IconGlyph from '../IconGlyph.vue'
import type { IconName } from '../iconNames'
withDefaults(defineProps<{ title: string; description?: string; icon?: IconName }>(), { icon: 'chat' })
</script>
<template>
  <div class="empty-state">
    <IconGlyph :name="icon" :size="36" />
    <h2>{{ title }}</h2>
    <p v-if="description">{{ description }}</p>
    <slot />
  </div>
</template>
