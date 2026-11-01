<script setup lang="ts">
import { ToggleSwitch } from 'winuionweb'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
defineOptions({ inheritAttrs: false })
const site = useSite()
const { data, loading, error, saving, run } = useResource(
  () => api<{ posts_require_review: boolean }>('/api/admin/review-settings', { token: site.token.value }),
  { posts_require_review: false },
)
async function save() {
  if (
    await run(
      () =>
        api('/api/admin/review-settings', {
          method: 'PATCH',
          token: site.token.value,
          body: { requireReview: data.value.posts_require_review },
        }),
      '审核设置已保存',
    )
  )
    site.settings.postsRequireReview = data.value.posts_require_review
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content settings-page">
      <PageHeader title="审核设置"
        ><WinButton label="保存设置" icon="check" accent :disabled="loading || saving" @click="save"
      /></PageHeader>
      <ResourceState :loading="loading" :error="error" />
      <section v-if="!loading" class="surface-card">
        <ToggleSwitch
          v-model:IsOn="data.posts_require_review"
          Header="全站发帖审核"
          OnContent="新帖需审核"
          OffContent="新帖直接发布"
        />
        <p class="field-hint">仅影响之后提交的新帖，待审核队列不变。</p>
      </section>
    </div>
  </div>
</template>
