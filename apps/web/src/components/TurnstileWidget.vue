<script lang="ts">
interface TurnstileApi {
  render(target: HTMLElement, options: Record<string, unknown>): string
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}
let scriptLoad: Promise<void> | undefined
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ siteKey: string; action: string }>()
const emit = defineEmits<{ verified: [token: string]; error: [message: string] }>()
const host = ref<HTMLElement>()
let widgetId: string | undefined
let mounted = false
let compact = false
let observer: ResizeObserver | undefined
let generation = 0

function loadScript() {
  if (window.turnstile) return Promise.resolve()
  if (scriptLoad) return scriptLoad
  scriptLoad = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => (window.turnstile ? resolve() : reject(new Error('Turnstile API 未加载')))
    script.onerror = () => reject(new Error('无法加载 Turnstile 人机验证'))
    document.head.append(script)
  }).catch((error) => {
    scriptLoad = undefined
    throw error
  })
  return scriptLoad
}

async function renderWidget() {
  if (!mounted || !host.value || !props.siteKey) return
  const currentGeneration = ++generation
  emit('verified', '')
  if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
  widgetId = undefined
  host.value.replaceChildren()
  try {
    await loadScript()
    if (!mounted || !host.value || !window.turnstile || currentGeneration !== generation) return
    widgetId = window.turnstile.render(host.value, {
      sitekey: props.siteKey,
      action: props.action,
      size: compact ? 'compact' : 'normal',
      theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
      callback: (token: string) => emit('verified', token),
      'expired-callback': () => emit('verified', ''),
      'error-callback': () => {
        emit('verified', '')
        emit('error', '人机验证失败，请重新验证。')
      },
    })
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '人机验证加载失败')
  }
}

onMounted(() => {
  mounted = true
  compact = (host.value?.clientWidth ?? 300) < 300
  observer = new ResizeObserver(([entry]) => {
    const nextCompact = entry!.contentRect.width < 300
    if (compact !== nextCompact) {
      compact = nextCompact
      void renderWidget()
    }
  })
  observer.observe(host.value!)
  void renderWidget()
})
watch(
  () => [props.siteKey, props.action],
  () => void renderWidget(),
)
onBeforeUnmount(() => {
  mounted = false
  generation += 1
  observer?.disconnect()
  if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
})
</script>

<template>
  <div ref="host" class="turnstile-widget" />
</template>

<style scoped>
.turnstile-widget {
  display: flex;
  justify-content: center;
  min-height: 65px;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
}
</style>
