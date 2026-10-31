<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useSite } from '../site'
import PageHeader from '../components/ui/PageHeader.vue'
import WinButton from '../components/ui/WinButton.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import AccountProfileEditor from '../components/AccountProfileEditor.vue'
defineOptions({ inheritAttrs: false })
const router = useRouter(),
  site = useSite()
</script>
<template>
  <div class="page-scroll">
    <div class="page-content settings-page">
      <PageHeader title="资料管理"
        ><WinButton label="返回用户后台" icon="back" @click="router.push('/account')"
      /></PageHeader>
      <EmptyState v-if="!site.user.value" title="登录后管理资料" icon="person"
        ><WinButton label="登录 / 注册" accent @click="site.authOpen.value = true"
      /></EmptyState>
      <EmptyState v-else-if="site.user.value.isBanned" title="账号封禁期间无法更改资料" icon="lock" />
      <AccountProfileEditor v-else show-actions />
    </div>
  </div>
</template>
