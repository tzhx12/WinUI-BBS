<script setup lang="ts">
import type { PostSummary } from '../types'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PostListItem from './PostListItem.vue'

const props = defineProps<{ posts: PostSummary[]; canDelete?: boolean }>()
const emit = defineEmits<{ open: [post: PostSummary]; delete: [post: PostSummary] }>()
const visibleCount = ref(1)
const visiblePosts = computed(() => props.posts.slice(0, visibleCount.value))
let renderFrame = 0
function revealNext() {
  if (visibleCount.value >= props.posts.length) return
  renderFrame = requestAnimationFrame(() => {
    visibleCount.value++
    revealNext()
  })
}
watch(
  () => props.posts,
  () => {
    cancelAnimationFrame(renderFrame)
    visibleCount.value = 1
    revealNext()
  },
)
onMounted(revealNext)
onBeforeUnmount(() => cancelAnimationFrame(renderFrame))
function openByKeyboard(event: KeyboardEvent, post: PostSummary) {
  if (event.target !== event.currentTarget) return
  event.preventDefault()
  emit('open', post)
}
</script>

<template>
  <div class="post-list" role="list" :aria-busy="visibleCount < posts.length">
    <div v-for="post in visiblePosts" :key="post.id" role="listitem">
      <div
        class="post-list-link"
        role="link"
        tabindex="0"
        :aria-label="post.title"
        @click="emit('open', post)"
        @keydown.enter="openByKeyboard($event, post)"
        @keydown.space="openByKeyboard($event, post)"
      >
        <PostListItem :item="post" :can-delete="canDelete" @delete="emit('delete', $event)" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.post-list-link {
  border-radius: 4px;
  cursor: pointer;
}
.post-list-link:hover {
  background: var(--subtle-secondary);
}
.post-list-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
</style>
