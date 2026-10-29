<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Button, PersonPicture } from 'winuionweb'
withDefaults(defineProps<{ uid: string; name: string; url?: string | null; size?: number }>(), { size: 40 })
const router = useRouter()
</script>
<template>
  <div class="user-avatar-link" @click.stop @pointerdown.stop>
    <Button
      Style="{StaticResource SubtleButtonStyle}"
      :aria-label="`查看 ${name} 的用户空间`"
      @Click="router.push(`/users/${uid}`)"
      ><PersonPicture :DisplayName="name" :ProfilePicture="url || undefined" :Width="size" :Height="size"
    /></Button>
  </div>
</template>
