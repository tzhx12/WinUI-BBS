<script setup lang="ts">
import { InfoBar, ProgressRing } from 'winuionweb'
defineProps<{ error?: string; loading?: boolean }>()
</script>
<template>
  <InfoBar :IsOpen="true" v-if="error" :Message="error" Severity="Error" :IsClosable="false" />
  <div v-else-if="loading" class="loading-state">
    <ProgressRing :IsActive="true" :Width="28" :Height="28" /><span>正在加载</span>
  </div>
</template>
