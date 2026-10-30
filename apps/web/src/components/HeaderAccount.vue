<script setup lang="ts">
import { computed, h, resolveComponent } from 'vue'
import { useRouter } from 'vue-router'
import { Button, MenuFlyout, PersonPicture } from 'winuionweb'
import { useSite } from '../site'
import WinButton from './ui/WinButton.vue'
const site = useSite()
const router = useRouter()
const MenuItem = resolveComponent('MenuFlyoutItem')
const appearancePath = computed(() =>
  site.user.value?.permissions?.includes('settings.manage') ? '/admin/appearance' : '/appearance',
)
const flyout = computed(() =>
  h(
    MenuFlyout,
    {},
    {
      default: () => [
        h(MenuItem, {
          Text: '用户后台',
          HorizontalContentAlignment: 'Center',
          onClick: () => router.push('/account'),
        }),
        h(MenuItem, {
          Text: '外观设置',
          HorizontalContentAlignment: 'Center',
          onClick: () => router.push(appearancePath.value),
        }),
        h(MenuItem, {
          Text: '退出登录',
          HorizontalContentAlignment: 'Center',
          onClick: () => {
            site.signOut()
            void router.push('/home')
          },
        }),
      ],
    },
  ),
)
</script>
<template>
  <div class="header-account">
    <WinButton
      :label="site.theme.value === 'light' ? '深色模式' : '浅色模式'"
      icon="theme"
      icon-only
      subtle
      @click="site.toggleTheme"
    />
    <Button
      v-if="site.user.value"
      :Flyout="flyout"
      Style="{StaticResource SubtleButtonStyle}"
      :aria-label="`${site.user.value.displayName}，账户菜单`"
      :title="site.user.value.displayName"
    >
      <span class="account-content"
        ><PersonPicture
          :DisplayName="site.user.value.displayName"
          :ProfilePicture="site.user.value.avatarUrl || undefined"
          :Width="28"
          :Height="28"
        /><span>{{ site.user.value.displayName }}</span></span
      >
    </Button>
    <WinButton
      v-else
      class="account-signin"
      label="登录 / 注册"
      icon="person"
      subtle
      @click="site.authOpen.value = true"
    />
  </div>
</template>
