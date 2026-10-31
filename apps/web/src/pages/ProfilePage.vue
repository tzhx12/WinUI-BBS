<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useSite } from '../site'
import UserProfileDetails from '../components/UserProfileDetails.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import WinButton from '../components/ui/WinButton.vue'
import MemberCard from '../components/MemberCard.vue'
defineOptions({ inheritAttrs: false })
const site = useSite()
const router = useRouter()
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="个人资料"
        ><WinButton
          v-if="site.user.value"
          label="用户后台"
          icon="person"
          accent
          @click="router.push('/account')"
      /></PageHeader>
      <EmptyState v-if="!site.user.value" title="登录后查看个人资料" icon="person"
        ><WinButton label="登录 / 注册" accent @click="site.authOpen.value = true"
      /></EmptyState>
      <div v-else class="profile-layout">
        <UserProfileDetails :user="site.user.value" />
        <MemberCard />
      </div>
    </div>
  </div>
</template>
