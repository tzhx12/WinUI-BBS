<script setup lang="ts">
import { useRouter } from 'vue-router'
import PageHeader from '../components/ui/PageHeader.vue'
import WinButton from '../components/ui/WinButton.vue'
import MyInvitations from '../components/MyInvitations.vue'

defineOptions({ inheritAttrs: false })
const router = useRouter()
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="我的邀请码">
        <WinButton label="返回用户后台" icon="back" @click="router.push('/account')" />
      </PageHeader>
      <MyInvitations />
    </div>
  </div>
</template>
