<script setup lang="ts">
import { ref } from 'vue'
import { api } from '../api'
import { useSite } from '../site'
import WinButton from './ui/WinButton.vue'

const props = defineProps<{ uid: string; following: boolean }>()
const emit = defineEmits<{ changed: [following: boolean]; error: [message: string] }>()
const site = useSite()
const busy = ref(false)
async function toggle() {
  if (!site.user.value) {
    site.authOpen.value = true
    return
  }
  busy.value = true
  try {
    const result = await api<{ following: boolean }>(`/api/users/${props.uid}/follow`, {
      method: props.following ? 'DELETE' : 'PUT',
      token: site.token.value,
    })
    emit('changed', result.following)
  } catch (cause) {
    emit('error', (cause as Error).message)
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <WinButton
    v-if="site.user.value?.uid !== uid"
    :label="following ? '已关注' : '关注'"
    :icon="following ? 'check' : 'add'"
    :accent="!following"
    :disabled="busy || site.user.value?.isBanned"
    :aria-pressed="following"
    @click="toggle"
  />
</template>
