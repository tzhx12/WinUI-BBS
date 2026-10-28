<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { CalendarDatePicker, CheckBox, TextBox, TimePicker } from 'winuionweb'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import type { Group, GroupMember } from '../../types/admin'
import {
  basicUserPermissionKeys,
  formatDate,
  groupTypes,
  managementPermissionKeys,
  permissions,
} from '../../utils'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
import WinDialog from '../../components/ui/WinDialog.vue'
import WinSelect from '../../components/ui/WinSelect.vue'
import IconGlyph from '../../components/IconGlyph.vue'
import MediaLimitsFields from '../../components/MediaLimitsFields.vue'
import type { MediaLimits } from '../../types/admin'
defineOptions({ inheritAttrs: false })
const site = useSite()
const {
  data: groups,
  loading,
  error,
  saving,
  reload,
  run,
} = useResource(() => api<Group[]>('/api/admin/groups', { token: site.token.value }), [])
const dialog = ref(false),
  editing = ref<Group | null>(null)
const form = reactive({
  name: '',
  groupType: 'normal' as string | number,
  description: '',
  isJoinable: false,
  permissions: [] as string[],
  mediaLimits: {} as Partial<MediaLimits>,
})
const isManagement = computed(() => form.groupType === 'management')
const isOrdinary = computed(() => form.groupType === 'normal' || form.groupType === 'public')
const userPermissions = permissions.filter(([key]) => !managementPermissionKeys.includes(key))
const managementPermissions = permissions.filter(([key]) => managementPermissionKeys.includes(key))
watch(
  () => form.groupType,
  () => {
    if (isManagement.value) form.permissions = [...new Set([...form.permissions, ...basicUserPermissionKeys])]
    else if (isOrdinary.value)
      form.permissions = form.permissions.filter((key) => !managementPermissionKeys.includes(key))
  },
)
const membersOpen = ref(false),
  memberGroup = ref<Group | null>(null),
  members = ref<GroupMember[]>([]),
  memberUid = ref('')
const expiryDate = ref<Date | string | undefined>()
// TimePicker represents Time as milliseconds since midnight.
const expiryTime = ref(18 * 60 * 60 * 1000)
function edit(group?: Group) {
  editing.value = group || null
  Object.assign(form, {
    name: group?.name || '',
    groupType: group?.group_type || 'normal',
    description: group?.description || '',
    isJoinable: group?.is_joinable || false,
    permissions: [...(group?.permissions || [])],
    mediaLimits: { ...(group?.media_limits || {}) },
  })
  error.value = ''
  dialog.value = true
}
function togglePermission(key: string, checked: boolean | null) {
  if (
    (isManagement.value && basicUserPermissionKeys.includes(key)) ||
    (isOrdinary.value && managementPermissionKeys.includes(key))
  )
    return
  form.permissions = checked ? [...form.permissions, key] : form.permissions.filter((item) => item !== key)
}
async function save() {
  if (isManagement.value && !form.permissions.some((key) => managementPermissionKeys.includes(key))) {
    error.value = '管理用户组至少需要一个管理类权限'
    return
  }
  if (
    await run(
      () =>
        api(`/api/admin/groups${editing.value ? `/${editing.value.id}` : ''}`, {
          method: editing.value ? 'PATCH' : 'POST',
          token: site.token.value,
          body: form,
        }),
      '用户组已保存',
    )
  ) {
    dialog.value = false
    await reload()
    await site.refreshUser()
  }
}
async function remove(group: Group) {
  if (!(await site.confirm(`删除“${group.name}”？`, '该组的成员关系也会被移除。', '删除'))) return
  if (
    await run(
      () => api(`/api/admin/groups/${group.id}`, { method: 'DELETE', token: site.token.value }),
      '用户组已删除',
    )
  )
    await reload()
}
async function loadMembers() {
  members.value = await api<GroupMember[]>(`/api/admin/groups/${memberGroup.value!.id}/memberships`, {
    token: site.token.value,
  })
}
async function showMembers(group: Group) {
  memberGroup.value = group
  memberUid.value = ''
  expiryDate.value = undefined
  members.value = []
  error.value = ''
  membersOpen.value = true
  await run(loadMembers)
}
async function addMember() {
  if (
    await run(async () => {
      let expiresAt: string | null = null
      if (expiryDate.value) {
        const date = new Date(expiryDate.value)
        date.setHours(
          Math.floor(expiryTime.value / 3_600_000),
          Math.floor((expiryTime.value % 3_600_000) / 60_000),
          0,
          0,
        )
        expiresAt = date.toISOString()
      }
      await api(`/api/admin/groups/${memberGroup.value!.id}/memberships`, {
        method: 'POST',
        token: site.token.value,
        body: { userUid: memberUid.value.trim(), expiresAt },
      })
      await loadMembers()
    }, '成员已添加')
  ) {
    memberUid.value = ''
    await reload()
  }
}
async function removeMember(member: GroupMember) {
  if (
    await run(
      () =>
        api(`/api/admin/groups/${memberGroup.value!.id}/memberships/${member.uid}`, {
          method: 'DELETE',
          token: site.token.value,
        }),
      '成员已移除',
    )
  ) {
    await loadMembers()
    await reload()
    await site.refreshUser()
  }
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="用户组与权限" description="配置用户组权限、公开加入规则和临时成员关系。"
        ><WinButton label="新建用户组" icon="add" accent @click="edit()" /></PageHeader
      ><ResourceState :loading="loading" :error="dialog || membersOpen ? '' : error" />
      <div v-if="!loading" class="group-grid">
        <section v-for="group in groups" :key="group.id" class="surface-card admin-group">
          <div class="section-toolbar">
            <IconGlyph :name="group.group_type === 'management' ? 'shield' : 'people'" :size="26" /><span
              class="tag"
              >{{ groupTypes.find((type) => type.value === group.group_type)?.label }}</span
            >
          </div>
          <h2>{{ group.name }}</h2>
          <p v-if="group.description" class="secondary-text">{{ group.description }}</p>
          <div class="tag-list">
            <span v-for="key in group.permissions" :key="key" class="tag">{{
              permissions.find((item) => item[0] === key)?.[1] || key
            }}</span>
          </div>
          <div class="group-card-footer">
            <span class="secondary-text"
              >{{ group.member_count }} 位成员<template v-if="group.is_default"> · 默认组</template></span
            >
            <div class="row-actions">
              <WinButton label="成员" icon="people" subtle @click="showMembers(group)" /><WinButton
                label="编辑"
                icon="edit"
                subtle
                @click="edit(group)"
              /><WinButton
                v-if="!group.is_protected"
                label="删除"
                icon="delete"
                subtle
                @click="remove(group)"
              />
            </div>
          </div>
        </section>
      </div>
      <WinDialog
        v-model:open="dialog"
        :title="editing ? '编辑用户组' : '新建用户组'"
        primary="保存"
        :busy="saving"
        :error="error"
        @primary="save"
        ><TextBox v-model:Text="form.name" Header="名称" aria-label="用户组名称" :MaxLength="64" /><WinSelect
          v-model="form.groupType"
          label="用户组类型"
          :options="groupTypes"
        /><TextBox
          v-model:Text="form.description"
          Header="说明"
          aria-label="用户组说明"
          :AcceptsReturn="true"
          :MaxLength="500"
        /><CheckBox
          v-if="form.groupType === 'public'"
          v-model:IsChecked="form.isJoinable"
          Content="允许用户自行加入和退出"
        />
        <fieldset class="permissions-fieldset">
          <legend>普通用户权限</legend>
          <div class="permission-grid">
            <CheckBox
              v-for="[key, label] in userPermissions"
              :key="key"
              :Content="label"
              :IsChecked="form.permissions.includes(key)"
              :IsEnabled="!(isManagement && basicUserPermissionKeys.includes(key))"
              @update:IsChecked="togglePermission(key, $event)"
            />
          </div>
        </fieldset>
        <p v-if="isManagement" class="field-hint">管理用户组固定保留发帖、回复和使用图床权限。</p>
        <fieldset v-if="!isOrdinary" class="permissions-fieldset">
          <legend>管理类权限</legend>
          <p v-if="isManagement" class="field-hint">至少选择一项。</p>
          <div class="permission-grid">
            <CheckBox
              v-for="[key, label] in managementPermissions"
              :key="key"
              :Content="label"
              :IsChecked="form.permissions.includes(key)"
              @update:IsChecked="togglePermission(key, $event)"
            />
          </div>
        </fieldset>
        <p v-else class="field-hint">普通用户组和公开用户组不能拥有管理类权限。</p>
        <h3>上传限额</h3>
        <p class="field-hint">勾选以覆盖站点默认值。多个用户组取各项已配置值中的最大值。</p>
        <MediaLimitsFields v-model="form.mediaLimits" overrides />
      </WinDialog>
      <WinDialog
        v-model:open="membersOpen"
        :title="`${memberGroup?.name || ''} · 成员`"
        close="完成"
        :error="error"
        ><div class="form-stack">
          <TextBox
            v-model:Text="memberUid"
            Header="添加用户 UID"
            PlaceholderText="输入 UID"
            aria-label="添加用户 UID"
          /><template v-if="memberGroup?.group_type === 'temporary'"
            ><CalendarDatePicker
              v-model:Date="expiryDate"
              Header="到期日期"
              PlaceholderText="选择日期" /><TimePicker
              v-model:Time="expiryTime"
              Header="到期时间"
              ClockIdentifier="24HourClock" /></template
          ><WinButton
            label="添加成员"
            icon="add"
            :disabled="saving || !memberUid.trim()"
            @click="addMember"
          />
        </div>
        <div class="membership-list">
          <div v-for="member in members" :key="member.uid" class="setting-row">
            <div>
              <strong>{{ member.display_name }}</strong
              ><small
                >UID {{ member.uid }} ·
                {{ member.expires_at ? `${formatDate(member.expires_at)} 到期` : '长期成员' }}</small
              >
            </div>
            <WinButton label="移除" icon="delete" subtle :disabled="saving" @click="removeMember(member)" />
          </div>
          <p v-if="!members.length" class="secondary-text">暂无成员</p>
        </div></WinDialog
      >
    </div>
  </div>
</template>
