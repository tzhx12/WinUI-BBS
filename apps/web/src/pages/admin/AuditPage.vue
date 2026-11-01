<script setup lang="ts">
import { ref } from 'vue'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import type { AuditEvent } from '../../types/admin'
import { formatDate } from '../../utils'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
import WinDialog from '../../components/ui/WinDialog.vue'
defineOptions({ inheritAttrs: false })
const site = useSite()
const { data, loading, error, reload } = useResource(
  () => api<AuditEvent[]>('/api/admin/audit', { token: site.token.value }),
  [],
)
const details = ref<AuditEvent | null>(null),
  open = ref(false)
function showDetails(entry: AuditEvent) {
  details.value = entry
  open.value = true
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="管理记录"><WinButton label="刷新" icon="refresh" @click="reload" /></PageHeader
      ><ResourceState :loading="loading" :error="error" />
      <div v-if="!loading" class="table-surface">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作者</th>
              <th>操作</th>
              <th>对象</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in data" :key="entry.id">
              <td>{{ formatDate(entry.created_at) }}</td>
              <td>{{ entry.actor_name || '系统' }}</td>
              <td>{{ entry.summary.action }}</td>
              <td>
                {{ entry.summary.target }}
              </td>
              <td>
                <WinButton label="详情" subtle @click="showDetails(entry)" />
              </td>
            </tr>
            <tr v-if="!data.length">
              <td colspan="5" class="table-empty">暂无管理记录</td>
            </tr>
          </tbody>
        </table>
      </div>
      <WinDialog v-model:open="open" title="操作详情" close="关闭"
        ><template v-if="details"
          ><strong>{{ details.summary.action }}</strong
          ><small class="secondary-text"
            >{{ formatDate(details.created_at) }} · {{ details.actor_name }}</small
          >
          <p class="secondary-text">{{ details.summary.target }}</p>
          <ul class="audit-summary">
            <li v-for="(line, index) in details.summary.lines" :key="index">{{ line }}</li>
          </ul>
        </template></WinDialog
      >
    </div>
  </div>
</template>
