<script setup lang="ts">
defineProps<{ selected: string }>()
</script>

<template>
  <div class="selector-page-viewport">
    <Transition name="selector-page" mode="out-in">
      <div :key="selected" class="selector-page"><slot /></div>
    </Transition>
  </div>
</template>

<style scoped>
.selector-page-viewport {
  min-width: 0;
  overflow-x: clip;
}
.selector-page {
  min-width: 0;
}
.selector-page-enter-active {
  transition:
    transform 300ms cubic-bezier(0.1, 0.9, 0.2, 1),
    opacity 180ms linear;
}
.selector-page-enter-from {
  transform: translateX(32px);
  opacity: 0;
}
.selector-page-enter-to {
  transform: translateX(0);
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .selector-page-enter-active {
    transition: none;
  }
  .selector-page-enter-from {
    transform: none;
    opacity: 1;
  }
}
</style>
