<script setup lang="ts">
import { ref } from 'vue'
import { InfoBar, TextBox, PasswordBox } from 'winuionweb'
import { api } from '../api'
import type { User } from '../types'
import WinButton from './ui/WinButton.vue'
const emit = defineEmits<{ complete: [value: { token: string; user: User }] }>()
const username = ref(''),
  email = ref(''),
  displayName = ref(''),
  password = ref(''),
  error = ref('')
const busy = ref(false)
async function createOwner() {
  busy.value = true
  error.value = ''
  try {
    emit(
      'complete',
      await api<{ token: string; user: User }>('/api/setup/initialize', {
        method: 'POST',
        body: {
          username: username.value,
          email: email.value,
          displayName: displayName.value || username.value,
          password: password.value,
        },
      }),
    )
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法创建管理员'
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <main class="setup-page">
    <div class="setup-card">
      <img src="/brand-mark.png" alt="" class="setup-logo" />
      <h1>建立你的社区</h1>
      <p class="secondary-text">创建首位管理员，开始配置论坛。</p>
      <form class="form-stack" @submit.prevent="createOwner">
        <TextBox v-model:Text="username" Header="管理员用户名" aria-label="管理员用户名" :MaxLength="32" />
        <TextBox v-model:Text="email" Header="邮箱" aria-label="邮箱" />
        <TextBox v-model:Text="displayName" Header="显示名称" aria-label="显示名称" :MaxLength="48" />
        <PasswordBox
          v-model:Password="password"
          Header="密码"
          aria-label="密码"
          autocomplete="new-password"
        />
        <small class="field-hint">密码至少 10 位</small>
        <InfoBar :IsOpen="true" v-if="error" :Message="error" Severity="Error" :IsClosable="false" />
        <WinButton :label="busy ? '正在创建…' : '创建管理员'" :disabled="busy" accent @click="createOwner" />
      </form>
    </div>
  </main>
</template>
