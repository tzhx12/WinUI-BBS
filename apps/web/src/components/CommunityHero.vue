<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Button, FontIcon, SystemBackdropElement } from 'winuionweb'
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
const material = computed(() => ({
  Type: 'Mica',
  Kind: 'Base',
  FallbackColor: site.theme.value === 'dark' ? '#292929' : '#f3f3f3',
}))
let observer: ResizeObserver | undefined
function updateScroll() {
  const element = viewport.value
  if (!element) return
  const max = element.scrollWidth - element.clientWidth
  overflowing.value = max > 1
  canGoPrevious.value = element.scrollLeft > 1
  canGoNext.value = element.scrollLeft < max - 1
}
function movePage(direction: number) {
  const element = viewport.value
  const card = element?.querySelector<HTMLElement>('.category-mica-card')
  if (!element || !card) return
  const stride = card.getBoundingClientRect().width + 16
  const step = Math.max(1, Math.floor((element.clientWidth + 16) / stride)) * stride
  element.scrollTo({
    left: Math.max(
      0,
      Math.min(element.scrollWidth - element.clientWidth, element.scrollLeft + direction * step),
    ),
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  })
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
onBeforeUnmount(() => observer?.disconnect())
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
    <div v-if="categories.length" class="category-carousel">
      <div ref="viewport" class="category-carousel-viewport" @scroll.passive="updateScroll">
        <Button
          v-for="item in categories"
          :key="item.id"
          class="category-mica-card"
          HorizontalAlignment="Stretch"
          VerticalAlignment="Stretch"
          HorizontalContentAlignment="Stretch"
          VerticalContentAlignment="Stretch"
          :aria-label="`进入${item.name}`"
          @Click="router.push(`/category/${item.id}`)"
        >
          <SystemBackdropElement
            class="category-mica-material"
            :SystemBackdrop="material"
            :CornerRadius="8"
            :RequestedTheme="site.theme.value === 'dark' ? 'Dark' : 'Light'"
            :IsHitTestVisible="false"
          />
          <div class="category-mica-content">
            <span class="category-mica-icon" :style="{ color: item.accent_color }"
              ><CategoryIcon :category="item" :size="36"
            /></span>
            <strong>{{ item.name }}</strong>
            <p>{{ item.description }}</p>
            <div class="category-mica-footer">
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
