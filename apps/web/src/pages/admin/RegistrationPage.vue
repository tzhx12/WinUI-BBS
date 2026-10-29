<script setup lang="ts">
import { NumberBox, ToggleSwitch } from 'winuionweb'
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
    }>('/api/admin/registration-settings', { token: site.token.value }),
  {
    registration_enabled: true,
    registration_mode: 'open' as 'open' | 'invite',
    security: { ...site.settings.emailSecurity },
  },
)
async function save() {
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
          },
        }),
      '注册与密码安全设置已保存',
    )
  ) {
    site.settings.registrationEnabled = data.value.registration_enabled
    site.settings.registrationMode = data.value.registration_mode
    site.settings.emailSecurity = { ...data.value.security }
  }
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content settings-page">
      <PageHeader title="注册管理" description="配置注册验证、找回密码与账号安全。"
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
          <p class="field-hint">用户通过已绑定邮箱的验证码更改密码；成功后使旧登录凭证失效。</p>
        </section>
      </template>
    </div>
  </div>
</template>
