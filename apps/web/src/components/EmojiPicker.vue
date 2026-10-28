<script setup lang="ts">
import { Button } from 'winuionweb'
defineProps<{
  packs: Array<{ id: string; name: string; emojis: Array<{ id: string; url: string; name: string }> }>
  error: string
}>()
defineEmits<{ select: [emoji: { id: string; url: string; name: string }] }>()
</script>
<template>
  <div class="emoji-picker">
    <section v-for="pack in packs" :key="pack.id">
      <span class="emoji-pack-name">{{ pack.name }}</span>
      <div class="emoji-pack-items">
        <Button
          v-for="emoji in pack.emojis"
          :key="emoji.id"
          :aria-label="emoji.name"
          :title="emoji.name"
          Style="{StaticResource SubtleButtonStyle}"
          @Click="$emit('select', emoji)"
          ><img :src="emoji.url" :alt="emoji.name"
        /></Button>
      </div>
    </section>
    <p v-if="error" class="emoji-empty">{{ error }}</p>
    <p v-else-if="!packs.some((pack) => pack.emojis.length)" class="emoji-empty">暂无表情</p>
  </div>
</template>
