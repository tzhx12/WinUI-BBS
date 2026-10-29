<script setup lang="ts">
import { ref } from 'vue'
import { InfoBar, PasswordBox } from 'winuionweb'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useResource } from '../composables/useResource'
import { useSite } from '../site'
import type { PageParameter } from '../types'
import PageHeader from '../components/ui/PageHeader.vue'
import ResourceState from '../components/ui/ResourceState.vue'
import WinButton from '../components/ui/WinButton.vue'
defineOptions({ inheritAttrs: false })
const props = defineProps<{ Parameter: PageParameter }>(),
  site = useSite(),
  router = useRouter()
const token = props.Parameter.query.token || '',
  password = ref(''),
  confirm = ref(''),
  done = ref(false)
const { data, loading, error, saving, run } = useResource(
  () =>
    api<{ valid: boolean; expiresAt: string }>('/api/auth/password-reset', {
      method: 'POST',
      body: { token },
    }),
  { valid: false, expiresAt: '' },
)
async function reset() {
  if (password.value !== confirm.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  if (
    await run(() =>
      api('/api/auth/reset-password', { method: 'POST', body: { token, password: password.value } }),
    )
  ) {
    done.value = true
    password.value = ''
    confirm.value = ''
    site.signOut(false)
    window.history.replaceState(null, '', `${window.location.pathname}#/reset-password`)
  }
}
function login() {
  site.authOpen.value = true
  void router.push('/home')
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content password-page">
      <PageHeader title="重设密码" />
      <ResourceState :loading="loading" :error="error" />
      <section v-if="done" class="surface-card form-stack">
        <InfoBar
          :IsOpen="true"
          Message="密码已重设，请使用新密码登录。"
          Severity="Success"
          :IsClosable="false"
        /><WinButton label="返回登录" accent @click="login" />
      </section>
      <form v-else-if="!loading && data.valid" class="surface-card form-stack" @submit.prevent="reset">
        <PasswordBox v-model:Password="password" Header="新密码" autocomplete="new-password" /><PasswordBox
          v-model:Password="confirm"
          Header="确认新密码"
          autocomplete="new-password"
        />
        <p class="field-hint">密码需为 10–128 位，链接只能使用一次。</p>
        <WinButton label="重设密码" accent :disabled="saving" @click="reset" />
      </form>
      <WinButton v-else-if="!loading" label="重新找回密码" @click="login" />
    </div>
  </div>
</template>
<style scoped>
.password-page {
  max-width: 680px;
}
</style>
