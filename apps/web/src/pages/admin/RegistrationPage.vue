<script setup lang="ts">
import { NumberBox, PasswordBox, TextBox, ToggleSwitch } from 'winuionweb'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
import WinSelect from '../../components/ui/WinSelect.vue'
defineOptions({ inheritAttrs: false })
const site = useSite()
const { data, loading, error, saving, run } = useResource(
  () =>
    api<{
      registration_enabled: boolean
      registration_mode: 'open' | 'invite'
      security: typeof site.settings.emailSecurity
      turnstile: { enabled: boolean; siteKey: string; hasSecret: boolean }
    }>('/api/admin/registration-settings', { token: site.token.value }).then((value) => ({
      ...value,
      turnstile: { ...value.turnstile, secretKey: '' },
    })),
  {
    registration_enabled: true,
    registration_mode: 'open' as 'open' | 'invite',
    security: { ...site.settings.emailSecurity },
    turnstile: { enabled: false, siteKey: '', hasSecret: false, secretKey: '' },
  },
)
async function save() {
  const hasNewTurnstileSecret = !!data.value.turnstile.secretKey
  if (
    await run(
      () =>
        api('/api/admin/registration-settings', {
          method: 'PUT',
          token: site.token.value,
          body: {
            registrationEnabled: data.value.registration_enabled,
            registrationMode: data.value.registration_mode,
            security: data.value.security,
            turnstile: {
              enabled: data.value.turnstile.enabled,
              siteKey: data.value.turnstile.siteKey,
              secretKey: data.value.turnstile.secretKey,
            },
          },
        }),
      '注册与密码安全设置已保存',
    )
  ) {
    site.settings.registrationEnabled = data.value.registration_enabled
    site.settings.registrationMode = data.value.registration_mode
    site.settings.emailSecurity = { ...data.value.security }
    site.settings.turnstile = {
      enabled: data.value.turnstile.enabled,
      siteKey: data.value.turnstile.enabled ? data.value.turnstile.siteKey : '',
    }
    data.value.turnstile.hasSecret ||= hasNewTurnstileSecret
    data.value.turnstile.secretKey = ''
  }
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content settings-page">
      <PageHeader title="注册管理"
        ><WinButton label="保存设置" accent :disabled="loading || saving" @click="save"
      /></PageHeader>
      <ResourceState :loading="loading" :error="error" />
      <template v-if="!loading">
        <section class="surface-card form-stack">
          <h2>注册</h2>
          <ToggleSwitch
            v-model:IsOn="data.registration_enabled"
            Header="开放注册"
            OnContent="开放"
            OffContent="关闭"
          />
          <WinSelect
            v-model="data.registration_mode"
            label="注册机制"
            :options="[
              { value: 'open', label: '开放注册' },
              { value: 'invite', label: '邀请注册' },
            ]"
          />
          <ToggleSwitch
            v-model:IsOn="data.security.registrationVerification"
            Header="注册邮箱验证"
            OnContent="需要验证码"
            OffContent="无需验证"
          />
        </section>
        <section class="surface-card form-stack">
          <h2>人机验证</h2>
          <ToggleSwitch
            v-model:IsOn="data.turnstile.enabled"
            Header="启用 Cloudflare Turnstile"
            OnContent="开启"
            OffContent="关闭"
          />
          <template v-if="data.turnstile.enabled">
            <TextBox
              v-model:Text="data.turnstile.siteKey"
              Header="站点密钥"
              aria-label="Turnstile 站点密钥"
              autocomplete="off"
            />
            <PasswordBox
              v-model:Password="data.turnstile.secretKey"
              Header="私钥"
              autocomplete="new-password"
            />
            <p class="field-hint">
              {{ data.turnstile.hasSecret ? '已保存私钥；留空会保留当前密钥。' : '私钥加密保存在服务端。' }}
              开启后，登录、注册、找回密码和更改密码都需要完成验证。
            </p>
          </template>
        </section>
        <section class="surface-card form-stack">
          <h2>邮箱验证码</h2>
          <div class="form-columns">
            <NumberBox
              v-model:Value="data.security.codeMinutes"
              Header="验证码有效期（分钟）"
              :Minimum="1"
              :Maximum="1440"
              SpinButtonPlacementMode="Inline"
              AutomationProperties.Name="验证码有效期（分钟）"
            />
            <NumberBox
              v-model:Value="data.security.resendSeconds"
              Header="同一邮箱发送间隔（秒）"
              :Minimum="60"
              :Maximum="3600"
              SpinButtonPlacementMode="Inline"
              AutomationProperties.Name="同一邮箱发送间隔（秒）"
            />
          </div>
          <p class="field-hint">注册与修改密码共用发送间隔，每个邮箱每分钟最多接收一次。</p>
        </section>
        <section class="surface-card form-stack">
          <h2>找回密码</h2>
          <ToggleSwitch
            v-model:IsOn="data.security.recoveryEnabled"
            Header="允许通过邮箱找回密码"
            OnContent="开启"
            OffContent="关闭"
          />
          <div class="form-columns">
            <NumberBox
              v-model:Value="data.security.resetMinutes"
              Header="找回链接有效期（分钟）"
              :Minimum="1"
              :Maximum="1440"
              SpinButtonPlacementMode="Inline"
              AutomationProperties.Name="找回链接有效期（分钟）"
            />
            <NumberBox
              v-model:Value="data.security.recoveryDailyLimit"
              Header="每天找回次数"
              :Minimum="1"
              :Maximum="10"
              SpinButtonPlacementMode="Inline"
              AutomationProperties.Name="每天找回次数"
            />
          </div>
          <p class="field-hint">每日次数按站点时区计算。请在站点设置填写可访问的站点 URL。</p>
        </section>
        <section class="surface-card form-stack">
          <h2>手动更改密码</h2>
          <NumberBox
            v-model:Value="data.security.passwordChangeSeconds"
            Header="两次改密最短间隔（秒）"
            :Minimum="60"
            :Maximum="86400"
            SpinButtonPlacementMode="Inline"
            AutomationProperties.Name="两次改密最短间隔（秒）"
          />
        </section>
      </template>
    </div>
  </div>
</template>
