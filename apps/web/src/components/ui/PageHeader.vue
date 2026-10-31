<script setup lang="ts">
import IconGlyph from '../IconGlyph.vue'
import type { IconName } from '../iconNames'
defineProps<{ title: string; description?: string; eyebrow?: string; icon?: IconName }>()
</script>
<template>
  <header class="page-heading">
    <div>
      <span v-if="eyebrow" class="page-eyebrow">{{ eyebrow }}</span>
      <h1 :class="{ 'page-title-with-icon': icon }">
        <IconGlyph v-if="icon" :name="icon" :size="30" />{{ title }}
      </h1>
      <p v-if="description">{{ description }}</p>
    </div>
    <div class="page-heading-actions"><slot /></div>
  </header>
</template>
