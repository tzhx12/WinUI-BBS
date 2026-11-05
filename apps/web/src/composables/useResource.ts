import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { useSite } from '../site'

export function useResource<T>(fetcher: () => Promise<T>, initial: T) {
  const data = ref(initial) as Ref<T>
  const loading = ref(true)
  const saving = ref(false)
  const error = ref('')
  const site = useSite()
  let requestVersion = 0

  async function reload() {
    const version = ++requestVersion
    loading.value = true
    error.value = ''
    try {
      const result = await fetcher()
      if (version === requestVersion) data.value = result
    } catch (cause) {
      if (version === requestVersion) error.value = cause instanceof Error ? cause.message : '加载失败'
    } finally {
      if (version === requestVersion) loading.value = false
    }
  }

  async function run(action: () => Promise<unknown>, message?: string) {
    saving.value = true
    error.value = ''
    try {
      await action()
      if (message) site.notify(message)
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '操作失败'
      return false
    } finally {
      saving.value = false
    }
  }

  onMounted(reload)
  onBeforeUnmount(() => {
    requestVersion++
  })
  return { data, loading, saving, error, reload, run }
}
