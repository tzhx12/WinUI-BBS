import { onMounted, ref, type Ref } from 'vue'
import { useSite } from '../site'

export function useResource<T>(fetcher: () => Promise<T>, initial: T) {
  const data = ref(initial) as Ref<T>
  const loading = ref(true)
  const saving = ref(false)
  const error = ref('')
  const site = useSite()

  async function reload() {
    loading.value = true
    error.value = ''
    try {
      data.value = await fetcher()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '加载失败'
    } finally {
      loading.value = false
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
  return { data, loading, saving, error, reload, run }
}
