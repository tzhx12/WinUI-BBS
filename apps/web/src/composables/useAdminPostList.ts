import { computed, ref, watch, type Ref } from 'vue'
import { api } from '../api'
import { useSite } from '../site'
import { useResource } from './useResource'

export interface AdminPostPage<T> {
  posts: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export function useAdminPostList<T>(path: string, status?: Ref<string>) {
  const site = useSite()
  const search = ref('')
  let query = '',
    requestedPage = 1
  const resource = useResource(
    async () => {
      const params = new URLSearchParams({ q: query, page: String(requestedPage) })
      if (status && status.value !== 'all') params.set('status', status.value)
      const result = await api<AdminPostPage<T>>(`${path}?${params}`, { token: site.token.value })
      return result
    },
    { posts: [], page: 1, pageSize: 25, total: 0, totalPages: 1 } as AdminPostPage<T>,
  )
  watch(resource.data, (result) => {
    requestedPage = result.page
  })

  function applySearch() {
    query = search.value.trim()
    requestedPage = 1
    void resource.reload()
  }
  function goPage(page: number) {
    if (
      resource.loading.value ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > resource.data.value.totalPages
    )
      return
    requestedPage = page
    void resource.reload()
  }
  if (status)
    watch(status, () => {
      requestedPage = 1
      void resource.reload()
    })
  return { ...resource, posts: computed(() => resource.data.value.posts), search, applySearch, goPage }
}
