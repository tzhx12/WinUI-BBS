<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PersonPicture, ProgressBar } from 'winuionweb'
import { api } from '../api'
import { useSite } from '../site'
import WinButton from './ui/WinButton.vue'
const site = useSite()
const router = useRouter()
const busy = ref(false)
const progress = computed(() =>
  site.user.value ? site.user.value.experience % (site.user.value.pointsPerLevel || 100) : 0,
)
async function checkin() {
  busy.value = true
  try {
    const result = await api<{ points: number }>('/api/check-in', { method: 'POST', token: site.token.value })
    site.notify(`签到成功，获得 ${result.points} 经验`)
    await site.refreshUser()
  } catch (cause) {
    site.notify(cause instanceof Error ? cause.message : '签到失败')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section class="surface-card member-card">
    <template v-if="site.user.value"
      ><div class="member-identity">
        <PersonPicture
          :DisplayName="site.user.value.displayName"
          :ProfilePicture="site.user.value.avatarUrl || undefined"
          :Width="44"
          :Height="44"
        />
        <div>
          <strong>{{ site.user.value.displayName }}</strong
          ><small>UID {{ site.user.value.uid }} · Lv.{{ site.user.value.level }}</small>
        </div>
      </div>
      <span
        v-if="site.user.value.title"
        class="member-title"
        :style="{ color: site.user.value.title.color }"
        >{{ site.user.value.title.title }}</span
      >
      <ProgressBar :Value="progress" :Maximum="site.user.value.pointsPerLevel || 100" /><small
        class="secondary-text"
        >{{ progress }} / {{ site.user.value.pointsPerLevel || 100 }} 升级经验</small
      >
      <WinButton
        :label="site.user.value.checkedIn ? '今日已签到' : '每日签到'"
        icon="calendar"
        :disabled="site.user.value.checkedIn || busy"
        @click="checkin"
      /><WinButton label="个人资料" subtle @click="router.push('/profile')" /> </template
    ><template v-else
      ><h2>加入社区讨论</h2>
      <p class="secondary-text">登录后发布帖子、回复和每日签到。</p>
      <WinButton label="登录 / 注册" accent @click="site.authOpen.value = true"
    /></template>
  </section>
</template>
