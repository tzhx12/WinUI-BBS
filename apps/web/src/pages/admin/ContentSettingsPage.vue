<script setup lang="ts">
import { NumberBox, ToggleSwitch } from 'winuionweb'
import { api } from '../../api'
import { useSite } from '../../site'
import { useResource } from '../../composables/useResource'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
defineOptions({ inheritAttrs: false })
const site = useSite()
const { data, loading, error, saving, run } = useResource(
  () => api<typeof site.settings.contentLimits>('/api/admin/content-settings', { token: site.token.value }),
  { ...site.settings.contentLimits },
)
async function save() {
  if (
    await run(
      () =>
        api('/api/admin/content-settings', { method: 'PATCH', token: site.token.value, body: data.value }),
      '发帖与回复设置已保存',
    )
  )
    site.updateSettings({ contentLimits: { ...data.value } })
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="发帖与回复设置"
        ><WinButton label="保存设置" accent :disabled="saving || loading" @click="save"
      /></PageHeader>
      <ResourceState :loading="loading" :error="error" />
      <section class="surface-card settings-form">
        <h2>帖子正文</h2>
        <div class="form-columns">
          <NumberBox
            v-model:Value="data.postCharacters"
            Header="最多字数（1–100000）"
            :Minimum="1"
            :Maximum="100000"
            SpinButtonPlacementMode="Inline"
          />
          <NumberBox
            v-model:Value="data.postImages"
            Header="最多普通图片（0–50）"
            :Minimum="0"
            :Maximum="50"
            SpinButtonPlacementMode="Inline"
          />
        </div>
      </section>
      <section class="surface-card settings-form">
        <h2>回复</h2>
        <div class="form-columns">
          <NumberBox
            v-model:Value="data.replyCharacters"
            Header="最多字数（1–10000）"
            :Minimum="1"
            :Maximum="10000"
            SpinButtonPlacementMode="Inline"
          />
          <NumberBox
            v-model:Value="data.replyImages"
            Header="最多普通图片（0–20）"
            :Minimum="0"
            :Maximum="20"
            SpinButtonPlacementMode="Inline"
          />
          <NumberBox
            v-model:Value="data.repliesPerPage"
            Header="每页回复数（1–100）"
            :Minimum="1"
            :Maximum="100"
            SpinButtonPlacementMode="Inline"
          />
        </div>
        <p class="field-hint">
          图片上限只计算普通图片。每篇帖子、每条回复的表情合计固定最多 1000
          个，包含用户上传、远端和社区表情。字数按可见文字计数，格式标记不占字数。
        </p>
      </section>
      <section class="surface-card settings-form">
        <h2>个人图床</h2>
        <ToggleSwitch
          v-model:IsOn="data.directLibraryUploads"
          Header="允许在“我的图片”直接上传"
          OnContent="允许"
          OffContent="仅随帖子或回复上传"
        />
      </section>
    </div>
  </div>
</template>
