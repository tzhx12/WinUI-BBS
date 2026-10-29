<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  provide,
  ref,
  resolveComponent,
  shallowReactive,
  watch,
  type Component,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Frame,
  InfoBar,
  NavigationView,
  ProgressRing,
  TitleBar,
  xamlNameScopeKey,
  xamlScopeKey,
} from 'winuionweb'
import { api } from './api'
import { adminNavigationGroups, adminSections, createSite, siteKey } from './site'
import type { Category, User } from './types'
import HeaderSearch from './components/HeaderSearch.vue'
import HeaderAccount from './components/HeaderAccount.vue'
import AuthDialog from './components/AuthDialog.vue'
import SetupView from './components/SetupView.vue'
import EmptyState from './components/ui/EmptyState.vue'
import WinButton from './components/ui/WinButton.vue'
import WinDialog from './components/ui/WinDialog.vue'

const site = createSite()
const TitleBarLeftHeader = resolveComponent('TitleBar.LeftHeader')
const TitleBarContent = resolveComponent('TitleBar.Content')
const TitleBarRightHeader = resolveComponent('TitleBar.RightHeader')
provide(siteKey, site)
provide(xamlScopeKey, {})
provide(xamlNameScopeKey, shallowReactive({}))
const router = useRouter()
const route = useRoute()
const mode = ref<'loading' | 'ready' | 'setup' | 'error'>('loading')
const error = ref('')
const frame = ref<InstanceType<typeof Frame> | null>(null)
const isAdmin = computed(() => route.path.startsWith('/admin/'))
const permittedSections = computed(() =>
  adminSections.filter((item) => site.user.value?.permissions?.includes(item.permission)),
)
const canAccess = computed(
  () => !isAdmin.value || permittedSections.value.some((item) => route.path === `/admin/${item.id}`),
)
const selectedNavigation = computed(() =>
  route.path.startsWith('/account/')
    ? '/account'
    : route.path.startsWith('/post/') || route.path === '/compose' || route.path === '/search'
      ? '/home'
      : route.path,
)

function categoryItems(parent: string | null): unknown[] {
  return site.categories.value
    .filter((item) => item.parent_id === parent)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item: Category) => ({
      Tag: `/category/${item.id}`,
      Content: item.name,
      Icon: item.icon_glyph,
      MenuItems: categoryItems(item.id),
      InfoBadge:
        item.show_notification && Number(item.post_count) ? { Value: Number(item.post_count) } : null,
    }))
}

const menuItems = computed(() =>
  isAdmin.value
    ? [
        ...permittedSections.value
          .filter((item) => item.id === 'overview')
          .map((item) => ({ Tag: `/admin/${item.id}`, Content: item.label, Icon: item.icon })),
        ...adminNavigationGroups.flatMap((group) => {
          const children = group.sections.flatMap((id) => {
            const item = permittedSections.value.find((section) => section.id === id)
            return item ? [{ Tag: `/admin/${item.id}`, Content: item.label, Icon: item.icon }] : []
          })
          return children.length
            ? [
                {
                  Tag: `admin-group:${group.id}`,
                  Content: group.label,
                  Icon: group.icon,
                  SelectsOnInvoked: false,
                  MenuItems: children,
                },
              ]
            : []
        }),
      ]
    : [
        { Tag: '/home', Content: '社区首页', Icon: '\ue80f' },
        { Tag: '/popular', Content: '热门讨论', Icon: '\ue8e5' },
        { Type: 'Header', Content: '板块' },
        ...categoryItems(null),
        { Type: 'Separator' },
        { Tag: '/groups', Content: '公开用户组', Icon: '\ue716' },
        ...(site.user.value ? [{ Tag: '/account', Content: '用户后台', Icon: '\ue77b' }] : []),
        ...(site.user.value
          ? [
              {
                Tag: '/notifications',
                Content: '站内通知',
                Icon: '\ue715',
                InfoBadge: site.unreadCount.value ? { Value: site.unreadCount.value } : null,
              },
            ]
          : []),
        ...(site.user.value?.isBanned || site.user.value?.permissions?.includes('media.use')
          ? [{ Tag: '/my-images', Content: '我的图片', Icon: '\ue8b9' }]
          : []),
      ],
)

const footerItems = computed(() => [
  { Tag: '/about', Content: '关于', Icon: '\ue946' },
  ...(isAdmin.value
    ? [{ Tag: '/home', Content: '返回社区', Icon: '\ue72b' }]
    : permittedSections.value.length
      ? [{ Tag: `/admin/${permittedSections.value[0]!.id}`, Content: '管理后台', Icon: '\ue713' }]
      : [{ Tag: '/appearance', Content: '外观设置', Icon: '\ue771' }]),
])

function navigate(_sender: unknown, args: { InvokedItemContainer: { Tag: string } }) {
  if (args.InvokedItemContainer.Tag.startsWith('admin-group:')) return
  void router.push(args.InvokedItemContainer.Tag)
}

async function initialize() {
  mode.value = 'loading'
  error.value = ''
  try {
    const status = await api<{ required: boolean }>('/api/setup/status')
    if (status.required) {
      mode.value = 'setup'
      return
    }
    await site.load()
    mode.value = 'ready'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法连接论坛服务'
    mode.value = 'error'
  }
}

async function setupComplete(value: { token: string; user: User }) {
  await site.authenticate(value)
  await site.load()
  mode.value = 'ready'
}

async function renderPage() {
  if (mode.value !== 'ready' || !canAccess.value) return
  await nextTick()
  const component = route.matched.at(-1)?.components?.default as Component | undefined
  if (component && frame.value)
    frame.value.NavigateToType(
      component,
      {
        path: route.path,
        id: route.params.id,
        query: { ...route.query },
      },
      {
        IsNavigationStackEnabled: false,
        TransitionInfoOverride: {
          Type:
            route.path.startsWith('/post/') || route.path.startsWith('/account/')
              ? 'DrillInNavigationTransitionInfo'
              : 'EntranceNavigationTransitionInfo',
        },
      },
    )
}

watch([mode, () => route.fullPath, canAccess], renderPage, { flush: 'post' })
watch(
  () => route.path,
  (path) => {
    if (path === '/reset-password') site.authOpen.value = false
  },
)
onMounted(initialize)
const unreadTimer = setInterval(() => {
  void site.refreshUnread().catch(() => {})
}, 30_000)
onBeforeUnmount(() => clearInterval(unreadTimer))
</script>

<template>
  <div id="forum-root" class="forum-app">
    <TitleBar class="app-titlebar" :Title="site.settings.title" :Subtitle="isAdmin ? '管理后台' : '社区'">
      <TitleBarLeftHeader
        ><img :src="site.settings.icon || '/brand-mark.png'" class="site-mark" alt=""
      /></TitleBarLeftHeader>
      <TitleBarContent v-if="mode === 'ready'"><HeaderSearch /></TitleBarContent>
      <TitleBarRightHeader><HeaderAccount /></TitleBarRightHeader>
    </TitleBar>

    <SetupView v-if="mode === 'setup'" @complete="setupComplete" />
    <div v-else-if="mode === 'loading'" class="app-status">
      <ProgressRing :IsActive="true" :Width="40" :Height="40" />
      <p>正在连接社区</p>
    </div>
    <div v-else-if="mode === 'error'" class="app-status">
      <EmptyState title="无法连接论坛" :description="error" icon="shield"
        ><WinButton label="重新连接" icon="refresh" @click="initialize"
      /></EmptyState>
    </div>

    <NavigationView
      v-else
      class="app-navigation"
      :PaneDisplayMode="site.compactNavigation.value ? 'LeftCompact' : 'Auto'"
      :OpenPaneLength="248"
      :ExpandedModeThresholdWidth="1080"
      :CompactModeThresholdWidth="640"
      :MenuItemsSource="menuItems"
      :FooterMenuItemsSource="footerItems"
      :SelectedItem="selectedNavigation"
      :IsSettingsVisible="false"
      IsBackButtonVisible="Collapsed"
      :AlwaysShowHeader="false"
      :PaneTitle="isAdmin ? '管理后台' : '导航'"
      @ItemInvoked="navigate"
    >
      <Frame v-if="canAccess" ref="frame" class="app-frame" :IsNavigationStackEnabled="false" />
      <EmptyState v-else :title="site.user.value ? '没有访问权限' : '登录后访问管理后台'" icon="lock">
        <WinButton v-if="!site.user.value" label="登录" accent @click="site.authOpen.value = true" />
        <WinButton label="返回社区" @click="router.push('/home')" />
      </EmptyState>
    </NavigationView>

    <AuthDialog v-model:open="site.authOpen.value" @authenticated="site.authenticate" />
    <WinDialog
      v-model:open="site.confirmation.open"
      :title="site.confirmation.title"
      :primary="site.confirmation.action"
      @primary="site.finishConfirmation(true)"
      @closed="site.finishConfirmation(false)"
    >
      <p>{{ site.confirmation.message }}</p>
    </WinDialog>
    <Transition name="notification"
      ><div v-if="site.notification.value" class="notification" role="status">
        <InfoBar
          :IsOpen="true"
          Severity="Success"
          :Message="site.notification.value"
          :IsClosable="false"
        /></div
    ></Transition>
  </div>
</template>
