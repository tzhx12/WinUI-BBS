<script setup lang="ts">
import { TextBox } from 'winuionweb'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
import AdminImageSetting from '../../components/AdminImageSetting.vue'
defineOptions({ inheritAttrs: false })
const site = useSite()
const { data, loading, error, saving, run } = useResource(
  () =>
    api<{ home_content: typeof site.settings.homeContent }>('/api/admin/home-settings', {
      token: site.token.value,
    }),
  { home_content: { ...site.settings.homeContent } },
)
async function save() {
  if (
    await run(
      () =>
        api('/api/admin/home-settings', {
          method: 'PATCH',
          token: site.token.value,
          body: data.value.home_content,
        }),
      '主页设置已保存',
    )
  )
    site.updateSettings({ homeContent: { ...data.value.home_content } })
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content settings-page">
      <PageHeader title="主页设置"
        ><WinButton label="保存设置" accent :disabled="loading || saving" @click="save"
      /></PageHeader>
      <ResourceState :loading="loading" :error="error" />
      <template v-if="!loading">
        <section class="surface-card form-stack">
          <h2>社区首页</h2>
          <TextBox
            v-model:Text="data.home_content.homeTitle"
            Header="主页标题"
            aria-label="主页标题"
            :MaxLength="64"
          />
          <TextBox
            v-model:Text="data.home_content.homeDescription"
            Header="主页说明"
            aria-label="主页说明"
            :MaxLength="500"
            :AcceptsReturn="true"
          />
          <AdminImageSetting
            label="首页板块背景图"
            :url="site.settings.homeBackground"
            endpoint="/api/admin/home-background"
            @updated="site.updateSettings({ homeBackground: $event })"
          />
        </section>
        <section class="surface-card form-stack">
          <h2>热门讨论</h2>
          <TextBox
            v-model:Text="data.home_content.popularTitle"
            Header="热门讨论标题"
            aria-label="热门讨论标题"
            :MaxLength="64"
          />
          <TextBox
            v-model:Text="data.home_content.popularDescription"
            Header="热门讨论说明"
            aria-label="热门讨论说明"
            :MaxLength="500"
            :AcceptsReturn="true"
          />
        </section>
      </template>
    </div>
  </div>
</template>
