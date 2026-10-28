<script setup lang="ts">
import { ref } from 'vue'
import { NumberBox, TextBox, ToggleSwitch } from 'winuionweb'
import { api, uploadForm } from '../../api'
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
      site_title: string
      site_icon_url: string
      site_url: string
      registration_enabled: boolean
      registration_mode: 'open' | 'invite'
      trash_retention_days: number
    }>('/api/admin/settings', { token: site.token.value }),
  {
    site_title: site.settings.title,
    site_icon_url: site.settings.icon,
    site_url: site.settings.url,
    registration_enabled: true,
    registration_mode: 'open' as 'open' | 'invite',
    trash_retention_days: 30,
  },
)
const fileInput = ref<HTMLInputElement | null>(null)
async function save() {
  if (
    await run(
      () =>
        api('/api/admin/settings', {
          method: 'PATCH',
          token: site.token.value,
          body: {
            siteTitle: data.value.site_title,
            siteUrl: data.value.site_url,
            registrationEnabled: data.value.registration_enabled,
            registrationMode: data.value.registration_mode,
            trashRetentionDays: data.value.trash_retention_days,
          },
        }),
      '站点设置已保存',
    )
  )
    site.updateSettings({
      title: data.value.site_title,
      icon: data.value.site_icon_url,
      url: data.value.site_url,
      registrationEnabled: data.value.registration_enabled,
      registrationMode: data.value.registration_mode,
    })
}
async function upload(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  if (!file) return
  await run(async () => {
    const result = await api<{ url: string }>('/api/admin/site-icon', {
      method: 'POST',
      token: site.token.value,
      body: uploadForm(file),
    })
    data.value.site_icon_url = result.url
    site.updateSettings({ title: site.settings.title, icon: result.url })
    input.value = ''
  }, '站点图标已更新')
}
async function reset() {
  if (
    await run(
      () => api('/api/admin/site-icon', { method: 'DELETE', token: site.token.value }),
      '已恢复默认图标',
    )
  ) {
    data.value.site_icon_url = ''
    site.updateSettings({ title: site.settings.title, icon: '' })
  }
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content settings-page">
      <PageHeader title="站点设置"
        ><WinButton label="保存设置" accent :disabled="saving" @click="save" /></PageHeader
      ><ResourceState :loading="loading" :error="error" />
      <section v-if="!loading" class="surface-card">
        <h2>基本信息</h2>
        <div class="setting-row">
          <TextBox v-model:Text="data.site_title" Header="站点名称" aria-label="站点名称" :MaxLength="64" />
        </div>
        <TextBox
          v-model:Text="data.site_url"
          Header="站点 URL"
          PlaceholderText="https://forum.example.com"
          aria-label="站点 URL"
        />
        <div class="setting-row">
          <div>
            <h3>站点图标</h3>
            <p class="secondary-text">用于应用标题栏和浏览器标签页。</p>
          </div>
          <img class="site-icon-preview" :src="data.site_icon_url || '/brand-mark.png'" alt="当前站点图标" />
        </div>
        <div class="row-actions">
          <WinButton
            label="上传图标"
            icon="upload"
            :disabled="saving"
            @click="fileInput?.click()"
          /><WinButton label="恢复默认" :disabled="saving || !data.site_icon_url" @click="reset" /><input
            ref="fileInput"
            class="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            @change="upload"
          />
        </div>
      </section>
      <section v-if="!loading" class="surface-card form-stack">
        <h2>回收站</h2>
        <NumberBox
          v-model:Value="data.trash_retention_days"
          Header="帖子保留天数"
          :Minimum="1"
          :Maximum="3650"
          SpinButtonPlacementMode="Inline"
          AutomationProperties.Name="帖子保留天数"
        />
        <p class="field-hint">更改适用于之后删除的帖子。</p>
      </section>
      <section v-if="!loading" class="surface-card form-stack">
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
      </section>
    </div>
  </div>
</template>
