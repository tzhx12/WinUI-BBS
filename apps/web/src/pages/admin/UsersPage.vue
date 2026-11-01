<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NumberBox, PersonPicture, TextBox } from 'winuionweb'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import type { AdminUser } from '../../types/admin'
import { formatDate } from '../../utils'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
import WinDialog from '../../components/ui/WinDialog.vue'
import WinSelect from '../../components/ui/WinSelect.vue'
defineOptions({ inheritAttrs: false })
const site = useSite(),
  search = ref(''),
  statusFilter = ref<string | number>('all')
const {
  data: users,
  loading,
  error,
  saving,
  reload,
  run,
} = useResource(
  () =>
    api<AdminUser[]>(`/api/admin/users?q=${encodeURIComponent(search.value)}&status=${statusFilter.value}`, {
      token: site.token.value,
    }),
  [],
)
watch(statusFilter, reload)
const dialog = ref(false),
  selected = ref<AdminUser | null>(null),
  level = ref(1),
  status = ref<string | number>('active')
const banDialog = ref(false),
  banDuration = ref(1),
  banUnit = ref<string | number>(1440)
const banMinutes = computed(() => banDuration.value * Number(banUnit.value))
const validBanDuration = computed(
  () => Number.isInteger(banDuration.value) && banMinutes.value >= 30 && banMinutes.value <= 1095 * 1440,
)
const formatBanExpiry = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))

function openBan(user: AdminUser) {
  selected.value = user
  banDuration.value = 1
  banUnit.value = 1440
  error.value = ''
  banDialog.value = true
}
async function setBan(user: AdminUser, minutes: number | null) {
  if (
    await run(
      () =>
        api(`/api/admin/users/${user.uid}`, {
          method: 'PATCH',
          token: site.token.value,
          body: { banMinutes: minutes },
        }),
      minutes === null ? '已解除封禁' : '用户已封禁',
    )
  ) {
    banDialog.value = false
    await Promise.all([reload(), site.refreshUser()])
  }
}
async function unban(user: AdminUser) {
  if (await site.confirm(`解除“${user.display_name}”的封禁？`, '封禁将立即解除。', '解除封禁'))
    await setBan(user, null)
}
function edit(user: AdminUser) {
  selected.value = user
  level.value = user.level
  status.value = user.status
  error.value = ''
  dialog.value = true
}
async function save() {
  if (
    await run(
      () =>
        api(`/api/admin/users/${selected.value!.uid}`, {
          method: 'PATCH',
          token: site.token.value,
          body: { level: level.value, status: status.value },
        }),
      '用户资料已更新',
    )
  ) {
    dialog.value = false
    await Promise.all([reload(), site.refreshUser()])
  }
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="用户管理" />
      <form class="section-toolbar" @submit.prevent="reload">
        <WinSelect
          v-model="statusFilter"
          label="账号状态筛选"
          :options="[
            { value: 'all', label: '全部状态' },
            { value: 'active', label: '正常' },
            { value: 'banned', label: '已封禁' },
            { value: 'suspended', label: '已停用' },
          ]"
        />
        <div class="toolbar-search">
          <TextBox
            v-model:Text="search"
            PlaceholderText="搜索 UID、用户名或邮箱"
            aria-label="搜索用户"
          /><WinButton label="搜索" icon="search" @click="reload" />
        </div>
        <span class="secondary-text">{{ users.length }} 位用户</span>
      </form>
      <ResourceState :loading="loading" :error="dialog || banDialog ? '' : error" />
      <div v-if="!loading" class="table-surface">
        <table class="data-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>UID</th>
              <th>用户组</th>
              <th>等级 / 经验</th>
              <th>状态</th>
              <th>注册时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in users" :key="user.uid">
              <td>
                <div class="table-person">
                  <PersonPicture
                    :DisplayName="user.display_name"
                    :ProfilePicture="user.avatar_url || undefined"
                    :Width="32"
                    :Height="32"
                    :MinWidth="32"
                    :MinHeight="32"
                  />
                  <div>
                    <strong>{{ user.display_name }}</strong
                    ><small>@{{ user.username }}</small>
                  </div>
                </div>
              </td>
              <td>{{ user.uid }}</td>
              <td>
                <div class="tag-list">
                  <span v-for="group in user.groups" :key="group" class="tag">{{ group }}</span>
                </div>
              </td>
              <td>
                Lv.{{ user.level }}<small class="cell-secondary">{{ user.experience }} EXP</small>
              </td>
              <td>
                <span
                  :class="['status-tag', user.status === 'active' && !user.is_banned ? 'success' : 'warning']"
                  >{{ user.status === 'suspended' ? '已停用' : user.is_banned ? '已封禁' : '正常' }}</span
                >
                <small v-if="user.is_banned && user.banned_until" class="cell-secondary"
                  >至 {{ formatBanExpiry(user.banned_until) }}</small
                >
              </td>
              <td class="secondary-text">{{ formatDate(user.created_at) }}</td>
              <td>
                <div class="row-actions">
                  <WinButton label="编辑" icon="edit" subtle :disabled="saving" @click="edit(user)" />
                  <WinButton
                    v-if="user.is_banned"
                    label="解除封禁"
                    subtle
                    :disabled="saving"
                    @click="unban(user)"
                  />
                  <WinButton
                    v-else
                    label="封禁"
                    icon="lock"
                    subtle
                    :disabled="saving || user.uid === '1'"
                    @click="openBan(user)"
                  />
                </div>
              </td>
            </tr>
            <tr v-if="!users.length">
              <td colspan="7" class="table-empty">没有找到用户</td>
            </tr>
          </tbody>
        </table>
      </div>
      <WinDialog
        v-model:open="dialog"
        title="编辑用户"
        primary="保存"
        :busy="saving"
        :error="error"
        @primary="save"
        ><template v-if="selected"
          ><div>
            <strong>{{ selected.display_name }}</strong>
            <p class="secondary-text">UID {{ selected.uid }} · @{{ selected.username }}</p>
          </div>
          <dl class="details-list compact-details">
            <div>
              <dt>UUID</dt>
              <dd class="uuid-value">{{ selected.uuid }}</dd>
            </div>
            <div>
              <dt>邮箱</dt>
              <dd>{{ selected.email }}</dd>
            </div>
          </dl>
          <NumberBox
            v-model:Value="level"
            Header="用户等级"
            :Minimum="1"
            SpinButtonPlacementMode="Inline"
            AutomationProperties.Name="用户等级"
          /><WinSelect
            v-model="status"
            label="账号状态"
            :disabled="selected.uid === '1'"
            :options="[
              { value: 'active', label: '正常' },
              { value: 'suspended', label: '停用' },
            ]"
          />
          <p v-if="selected.uid === '1'" class="field-hint">UID 1 的账号不可停用或封禁。</p></template
        ></WinDialog
      >
      <WinDialog
        v-model:open="banDialog"
        title="封禁用户"
        primary="封禁"
        :busy="saving || !validBanDuration"
        :error="error"
        @primary="setBan(selected!, banMinutes)"
      >
        <template v-if="selected">
          <p>{{ selected.display_name }} · UID {{ selected.uid }}</p>
          <div class="form-columns">
            <NumberBox
              v-model:Value="banDuration"
              Header="封禁时长"
              :Minimum="Number(banUnit) === 1 ? 30 : 1"
              :Maximum="(1095 * 1440) / Number(banUnit)"
              SpinButtonPlacementMode="Inline"
              AutomationProperties.Name="封禁时长"
            />
            <WinSelect
              v-model="banUnit"
              label="单位"
              :options="[
                { value: 1, label: '分钟' },
                { value: 60, label: '小时' },
                { value: 1440, label: '天' },
              ]"
            />
          </div>
          <p class="field-hint">30 分钟至 1095 天，到期自动解除。</p>
        </template>
      </WinDialog>
    </div>
  </div>
</template>
