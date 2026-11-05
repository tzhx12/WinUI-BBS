import { shallowRef, watch, type VNode } from 'vue'

export interface NavigationItem {
  Tag?: string
  Type?: 'Header' | 'Separator'
  Content?: string
  Icon?: string | VNode
  SelectsOnInvoked?: boolean
  MenuItems?: NavigationItem[]
  InfoBadge?: { Value: number } | null
}

function reconcileItems(previous: NavigationItem[], next: NavigationItem[]): NavigationItem[] {
  const existing = new Map(previous.map((item) => [item.Tag ?? item.Type, item]))
  return next.map((item) => {
    const retained = existing.get(item.Tag ?? item.Type) ?? {}
    const children = item.MenuItems ? reconcileItems(retained.MenuItems ?? [], item.MenuItems) : undefined
    // NavigationView associates expansion and selection with the source object.
    // Update the declared fields while retaining its runtime state.
    Object.assign(retained, item, { MenuItems: children })
    return retained
  })
}

export function useNavigationItems(source: () => NavigationItem[]) {
  const items = shallowRef<NavigationItem[]>([])
  watch(source, (next) => (items.value = reconcileItems(items.value, next)), {
    immediate: true,
    flush: 'sync',
  })
  return items
}
