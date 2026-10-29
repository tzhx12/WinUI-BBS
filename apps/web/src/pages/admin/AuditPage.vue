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
const actionNames: Record<string, string> = {
  'levels.update': '更新等级规则',
  'site.title.update': '更新站点名称',
  'user.update': '更新用户',
  'group.create': '创建用户组',
  'group.update': '更新用户组',
  'group.delete': '删除用户组',
  'group.member.add': '添加用户组成员',
  'group.member.remove': '移除用户组成员',
  'category.create': '创建板块',
  'category.update': '更新板块',
  'category.delete': '删除板块',
  'post.moderate': '发帖管理',
  'post.delete': '删除发帖',
  'post.restore': '恢复发帖',
  'post.review.approve': '发帖审核通过',
  'post.review.reject': '发帖审核拒绝',
  'post.review.ban': '发帖审核封禁账号',
  'review.settings.update': '更新发帖审核设置',
  'site.settings.update': '更新站点设置',
  'notification.send': '发送站内通知',
  'invitation.rule.delete': '删除邀请码奖励规则',
  'mail.settings.update': '更新发信设置',
  'registration.settings.update': '更新注册与密码安全设置',
  'content.settings.update': '更新发帖与回复设置',
  'group.type.normalize': '调整用户组类型',
  'group.permissions.restrict': '调整用户组权限',
}
const targetNames: Record<string, string> = {
  user: '用户',
  group: '用户组',
  category: '板块',
  post: '帖子',
  'level-config': '等级规则',
  site: '站点',
  notification: '通知',
  'invitation-rule': '邀请码奖励规则',
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="管理记录" description="查看最近的后台管理操作。"
        ><WinButton label="刷新" icon="refresh" @click="reload" /></PageHeader
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
              <td>{{ actionNames[entry.action_key] }}</td>
              <td>
                {{ targetNames[entry.target_type]
                }}<span v-if="entry.target_id" class="secondary-text"> #{{ entry.target_id }}</span>
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
          ><strong>{{ actionNames[details.action_key] }}</strong
          ><small class="secondary-text"
            >{{ formatDate(details.created_at) }} · {{ details.actor_name }}</small
          >
          <pre class="audit-json">{{ JSON.stringify(details.details, null, 2) }}</pre>
        </template></WinDialog
      >
    </div>
  </div>
</template>
