<script setup lang="ts">
import { ref } from 'vue'
import { NumberBox, PasswordBox, TextBox, ToggleSwitch } from 'winuionweb'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
defineOptions({ inheritAttrs: false })
const site = useSite(),
  recipient = ref('')
interface Endpoint {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  hasPassword?: boolean
}
interface Settings {
  enabled: boolean
  fromName: string
  fromAddress: string
  smtp: Endpoint
  imap: Endpoint & { enabled: boolean }
}
const { data, loading, error, saving, run, reload } = useResource(
  () => api<Settings>('/api/admin/mail-settings', { token: site.token.value }),
  {
    enabled: false,
    fromName: 'WinUI-BBS',
    fromAddress: '',
    smtp: { host: '', port: 465, secure: true, user: '', password: '' },
    imap: { enabled: false, host: '', port: 993, secure: true, user: '', password: '' },
  },
)
async function save() {
  if (
    await run(
      () => api('/api/admin/mail-settings', { method: 'PUT', token: site.token.value, body: data.value }),
      '发信设置已保存',
    )
  )
    await reload()
}
async function testMail() {
  await run(
    () =>
      api('/api/admin/mail-settings/test', {
        method: 'POST',
        token: site.token.value,
        body: { email: recipient.value },
      }),
    '测试邮件已发送',
  )
}
async function testImap() {
  await run(
    () => api('/api/admin/mail-settings/test-imap', { method: 'POST', token: site.token.value }),
    'IMAP 连接成功',
  )
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content settings-page">
      <PageHeader title="发信设置" description="通过 SMTP 发送验证邮件，使用 IMAP 检查收信连接。"
        ><WinButton label="保存设置" accent :disabled="loading || saving" @click="save"
      /></PageHeader>
      <ResourceState :loading="loading" :error="error" />
      <template v-if="!loading">
        <section class="surface-card form-stack">
          <h2>发件身份</h2>
          <ToggleSwitch v-model:IsOn="data.enabled" Header="启用发信" OnContent="开启" OffContent="关闭" />
          <div class="form-columns">
            <TextBox v-model:Text="data.fromName" Header="发件人名称" /><TextBox
              v-model:Text="data.fromAddress"
              Header="发件邮箱"
            />
          </div>
        </section>
        <section class="surface-card form-stack">
          <h2>SMTP 发信服务器</h2>
          <div class="form-columns">
            <TextBox v-model:Text="data.smtp.host" Header="SMTP 服务器" /><NumberBox
              v-model:Value="data.smtp.port"
              Header="SMTP 端口"
              :Minimum="1"
              :Maximum="65535"
              SpinButtonPlacementMode="Inline"
              AutomationProperties.Name="SMTP 端口"
            />
          </div>
          <ToggleSwitch
            v-model:IsOn="data.smtp.secure"
            Header="SMTP SSL/TLS"
            OnContent="直接使用 TLS"
            OffContent="使用 STARTTLS"
          />
          <TextBox v-model:Text="data.smtp.user" Header="SMTP 账号" autocomplete="off" />
          <PasswordBox
            v-model:Password="data.smtp.password"
            Header="SMTP 密码 / 授权码"
            :PlaceholderText="data.smtp.hasPassword ? '已保存，留空保持原密码' : '输入密码或授权码'"
            autocomplete="new-password"
          />
        </section>
        <section class="surface-card form-stack">
          <h2>IMAP 收信检查</h2>
          <ToggleSwitch
            v-model:IsOn="data.imap.enabled"
            Header="启用 IMAP 连接检查"
            OnContent="开启"
            OffContent="关闭"
          />
          <template v-if="data.imap.enabled"
            ><div class="form-columns">
              <TextBox v-model:Text="data.imap.host" Header="IMAP 服务器" /><NumberBox
                v-model:Value="data.imap.port"
                Header="IMAP 端口"
                :Minimum="1"
                :Maximum="65535"
                SpinButtonPlacementMode="Inline"
                AutomationProperties.Name="IMAP 端口"
              />
            </div>
            <ToggleSwitch
              v-model:IsOn="data.imap.secure"
              Header="IMAP SSL/TLS"
              OnContent="开启"
              OffContent="关闭"
            />
            <TextBox v-model:Text="data.imap.user" Header="IMAP 账号" autocomplete="off" />
            <PasswordBox
              v-model:Password="data.imap.password"
              Header="IMAP 密码 / 授权码"
              :PlaceholderText="data.imap.hasPassword ? '已保存，留空保持原密码' : '输入密码或授权码'"
              autocomplete="new-password"
            />
            <WinButton label="检查 IMAP 连接" :disabled="saving" @click="testImap" />
          </template>
        </section>
        <section class="surface-card form-stack">
          <h2>发送测试邮件</h2>
          <p class="field-hint">先保存设置，再发送测试邮件。</p>
          <TextBox v-model:Text="recipient" Header="测试收件邮箱" /><WinButton
            label="发送测试邮件"
            icon="mail"
            :disabled="saving || !recipient.trim()"
            @click="testMail"
          />
        </section>
      </template>
    </div>
  </div>
</template>
