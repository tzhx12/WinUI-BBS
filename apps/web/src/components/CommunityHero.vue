<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Button, createAcrylicResource, FontIcon, useAcrylicBrushStyle, vAcrylicBrush } from 'winuionweb'
import { categoryPath } from '../utils'
import type { Category } from '../types'
import { useSite } from '../site'
import CategoryIcon from './CategoryIcon.vue'
import IconGlyph from './IconGlyph.vue'
import WinButton from './ui/WinButton.vue'

const props = defineProps<{
  title: string
  description: string
  background?: string
  categories: Category[]
  category?: Category
}>()
defineEmits<{ compose: [] }>()
const site = useSite()
const router = useRouter()
const viewport = ref<HTMLElement | null>(null)
const canGoPrevious = ref(false),
  canGoNext = ref(false),
  overflowing = ref(false)
const materialSettings = computed(() => ({
  TintColor: site.theme.value === 'dark' ? '#202020' : '#ffffff',
  TintOpacity: 0.08,
  TintLuminosityOpacity: site.theme.value === 'dark' ? 0.55 : 0.45,
  FallbackColor: site.theme.value === 'dark' ? '#292929' : '#f3f3f3',
  TintTransitionDuration: 200,
}))
const material = useAcrylicBrushStyle(
  createAcrylicResource((name) => materialSettings.value[name as keyof typeof materialSettings.value]),
)
let observer: ResizeObserver | undefined
let animation = 0
let targetLeft = 0
let animatedLeft = 0
let lastFrame = 0
let wheelDirection = 0
function stopAnimation() {
  cancelAnimationFrame(animation)
  animation = 0
  wheelDirection = 0
}
function animateScroll(now: number) {
  const element = viewport.value
  if (!element) return stopAnimation()
  targetLeft = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, targetLeft))
  const distance = targetLeft - animatedLeft
  if (Math.abs(distance) < 0.5) {
    element.scrollLeft = targetLeft
    stopAnimation()
    return
  }
  // Time-based easing keeps consecutive wheel events continuous at any refresh rate.
  const progress = 1 - Math.exp(-(now - lastFrame) / 65)
  animatedLeft += distance * progress
  element.scrollLeft = animatedLeft
  lastFrame = now
  animation = requestAnimationFrame(animateScroll)
}
function scrollToPosition(left: number) {
  const element = viewport.value
  if (!element) return
  targetLeft = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, left))
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    stopAnimation()
    element.scrollLeft = targetLeft
  } else if (!animation) {
    animatedLeft = element.scrollLeft
    lastFrame = performance.now()
    animation = requestAnimationFrame(animateScroll)
  }
}
function updateScroll() {
  const element = viewport.value
  if (!element) return
  const max = element.scrollWidth - element.clientWidth
  overflowing.value = max > 1
  canGoPrevious.value = element.scrollLeft > 1
  canGoNext.value = element.scrollLeft < max - 1
}
function onWheel(event: WheelEvent) {
  const element = viewport.value
  if (!element) return
  if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    stopAnimation()
    return
  }
  const max = element.scrollWidth - element.clientWidth
  if (max <= 1 || !event.deltaY) return
  const direction = Math.sign(event.deltaY)
  if ((direction > 0 && element.scrollLeft >= max - 0.5) || (direction < 0 && element.scrollLeft <= 0.5)) {
    stopAnimation()
    return
  }
  event.preventDefault()
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientWidth : 1)
  const start = animation && wheelDirection === direction ? targetLeft : element.scrollLeft
  scrollToPosition(start + delta)
  wheelDirection = direction
}
function movePage(direction: number) {
  const element = viewport.value
  const card = element?.querySelector<HTMLElement>('.category-acrylic-card')
  if (!element || !card) return
  const stride = card.getBoundingClientRect().width + 16
  const step = Math.max(1, Math.floor((element.clientWidth + 16) / stride)) * stride
  scrollToPosition((animation ? targetLeft : element.scrollLeft) + direction * step)
  wheelDirection = 0
}
watch(
  () => props.categories,
  async () => {
    await nextTick()
    updateScroll()
  },
)
onMounted(() => {
  observer = new ResizeObserver(updateScroll)
  if (viewport.value) observer.observe(viewport.value)
  updateScroll()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  stopAnimation()
})
</script>
<template>
  <section
    class="community-hero"
    :class="{ 'has-background': background, 'category-hero': category }"
    aria-label="板块导航"
  >
    <div v-if="background" class="community-hero-background" aria-hidden="true">
      <img :src="background" alt="" />
    </div>
    <header class="community-hero-heading">
      <div class="community-hero-title">
        <span v-if="category" class="community-hero-icon"
          ><CategoryIcon :category="category" :size="40"
        /></span>
        <div>
          <span class="page-eyebrow">{{ category ? '社区板块' : site.settings.title }}</span>
          <h1>{{ title }}</h1>
          <p>{{ description }}</p>
        </div>
      </div>
      <WinButton
        label="发布帖子"
        icon="add"
        accent
        :disabled="site.user.value?.isBanned"
        @click="$emit('compose')"
      />
    </header>
    <div v-if="categories.length" class="category-carousel" @wheel="onWheel">
      <div
        ref="viewport"
        class="category-carousel-viewport"
        @scroll.passive="updateScroll"
        @pointerdown="stopAnimation"
      >
        <Button
          v-for="item in categories"
          :key="item.id"
          class="category-acrylic-card"
          Background="Transparent"
          :BorderThickness="0"
          :CornerRadius="8"
          HorizontalAlignment="Stretch"
          VerticalAlignment="Stretch"
          HorizontalContentAlignment="Stretch"
          VerticalContentAlignment="Stretch"
          :aria-label="`进入${item.name}`"
          @Click="router.push(categoryPath(item))"
        >
          <div
            v-acrylic-brush.host-backdrop="material"
            :style="material"
            class="category-acrylic-material"
            aria-hidden="true"
          />
          <div class="category-acrylic-content">
            <span class="category-acrylic-icon" :style="{ color: item.accent_color }"
              ><CategoryIcon :category="item" :size="36"
            /></span>
            <strong>{{ item.name }}</strong>
            <p>{{ item.description }}</p>
            <div class="category-acrylic-footer">
              <small
                >{{ item.post_count || 0 }} 个帖子<span v-if="item.minimum_reader_level">
                  · Lv.{{ item.minimum_reader_level }}+</span
                ></small
              ><IconGlyph name="arrow" :size="16" />
            </div>
          </div>
        </Button>
      </div>
      <div v-if="overflowing" class="category-carousel-controls">
        <Button
          class="category-carousel-control is-previous"
          aria-label="上一页板块"
          title="上一页板块"
          :IsEnabled="canGoPrevious"
          :Width="16"
          :Height="38"
          :MinWidth="16"
          @Click="movePage(-1)"
        >
          <FontIcon
            Glyph="&#xEDD9;"
            FontFamily="{ThemeResource SymbolThemeFontFamily}"
            FontSize="{ThemeResource FlipViewButtonFontSize}"
            Foreground="{ThemeResource FlipViewNextPreviousArrowForeground}"
            aria-hidden="true"
          />
        </Button>
        <Button
          class="category-carousel-control is-next"
          aria-label="下一页板块"
          title="下一页板块"
          :IsEnabled="canGoNext"
          :Width="16"
          :Height="38"
          :MinWidth="16"
          @Click="movePage(1)"
        >
          <FontIcon
            Glyph="&#xEDDA;"
            FontFamily="{ThemeResource SymbolThemeFontFamily}"
            FontSize="{ThemeResource FlipViewButtonFontSize}"
            Foreground="{ThemeResource FlipViewNextPreviousArrowForeground}"
            aria-hidden="true"
          />
        </Button>
      </div>
    </div>
  </section>
</template>
