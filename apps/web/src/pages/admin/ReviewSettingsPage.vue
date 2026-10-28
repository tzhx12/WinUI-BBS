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
      <PageHeader title="审核设置" description="设置新帖是否需要审核后公开。"
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
        <p class="field-hint">板块可以单独开启审核。此设置只影响之后提交的新帖，队列中的帖子仍需处理。</p>
      </section>
      <section class="surface-card">
        <h2>审核规则的优先顺序</h2>
        <ol class="review-rules">
          <li>
            <strong>发帖必须审核</strong>
            <p>拥有此权限的用户始终需要审核；同时拥有免审核权限时，以必须审核为准。</p>
          </li>
          <li>
            <strong>发帖全局免审核</strong>
            <p>其余拥有此权限的用户可直接发布，包括开启审核的板块。</p>
          </li>
          <li>
            <strong>全站与板块设置</strong>
            <p>其余用户在全站或当前板块开启审核时进入待审核队列。</p>
          </li>
        </ol>
      </section>
    </div>
  </div>
</template>
