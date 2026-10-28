<script setup lang="ts">
import { ref } from 'vue'
import { NumberBox } from 'winuionweb'
import { api } from '../../api'
import { useSite } from '../../site'
import { useResource } from '../../composables/useResource'
import type { Invitation, InvitationRule } from '../../types/admin'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
import WinDialog from '../../components/ui/WinDialog.vue'
defineOptions({ inheritAttrs: false })
const site = useSite()
const { data, loading, error, saving, reload, run } = useResource(
  () =>
    api<{ codes: Invitation[]; rules: InvitationRule[] }>('/api/admin/invitations', {
      token: site.token.value,
    }),
  { codes: [], rules: [] },
)
const createOpen = ref(false),
  quantity = ref(1),
  maxUses = ref(1),
  level = ref(3),
  reward = ref(1)
async function create() {
  if (
    await run(
      () =>
        api('/api/admin/invitations', {
          method: 'POST',
          token: site.token.value,
          body: { quantity: quantity.value, maxUses: maxUses.value },
        }),
      '邀请码已创建',
    )
  ) {
    createOpen.value = false
    await reload()
  }
}
async function addRule() {
  if (
    await run(
      () =>
        api('/api/admin/invitation-rules', {
          method: 'POST',
          token: site.token.value,
          body: { minimumLevel: level.value, quantity: reward.value },
        }),
      '等级奖励已添加',
    )
  )
    await reload()
}
async function toggle(path: string, id: string, enabled: boolean) {
  if (
    await run(
      () =>
        api(`/api/admin/${path}/${id}`, {
          method: 'PATCH',
          token: site.token.value,
          body: { isEnabled: enabled },
        }),
      '状态已更新',
    )
  )
    await reload()
}
async function removeRule(rule: InvitationRule) {
  if (
    !(await site.confirm(
      '删除等级奖励规则？',
      `删除 Lv.${rule.minimum_level} 的奖励规则，已发出的邀请码仍可使用。`,
      '删除规则',
    ))
  )
    return
  if (
    await run(
      () => api(`/api/admin/invitation-rules/${rule.id}`, { method: 'DELETE', token: site.token.value }),
      '奖励规则已删除',
    )
  )
    await reload()
}
async function copy(code: string) {
  const base = site.settings.url || window.location.origin
  await navigator.clipboard.writeText(`${base.replace(/\/$/, '')}/#/home?invite=${encodeURIComponent(code)}`)
  site.notify('邀请链接已复制')
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="邀请码管理"
        ><WinButton label="创建邀请码" icon="add" accent @click="createOpen = true"
      /></PageHeader>
      <ResourceState :loading="loading" :error="createOpen ? '' : error" />
      <section class="surface-card">
        <h2>等级奖励</h2>
        <p class="secondary-text">达到指定等级后自动获得一次奖励，每个邀请码可使用一次。</p>
        <div class="form-columns">
          <NumberBox
            v-model:Value="level"
            Header="最低等级"
            :Minimum="1"
            :Maximum="10000"
            SpinButtonPlacementMode="Inline"
            AutomationProperties.Name="奖励等级"
          /><NumberBox
            v-model:Value="reward"
            Header="奖励数量"
            :Minimum="1"
            :Maximum="100"
            SpinButtonPlacementMode="Inline"
            AutomationProperties.Name="奖励数量"
          />
        </div>
        <div class="form-actions"><WinButton label="添加规则" :disabled="saving" @click="addRule" /></div>
        <div v-for="rule in data.rules" :key="rule.id" class="setting-row">
          <span>Lv.{{ rule.minimum_level }} · {{ rule.quantity }} 个邀请码</span>
          <div class="row-actions">
            <WinButton
              :label="rule.is_enabled ? '停用' : '启用'"
              subtle
              :disabled="saving"
              @click="toggle('invitation-rules', rule.id, !rule.is_enabled)"
            />
            <WinButton label="删除" icon="delete" subtle :disabled="saving" @click="removeRule(rule)" />
          </div>
        </div>
      </section>
      <div class="table-surface">
        <table class="data-table">
          <thead>
            <tr>
              <th>邀请码</th>
              <th>所属用户</th>
              <th>使用次数</th>
              <th>状态</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="code in data.codes" :key="code.id">
              <td>
                <code>{{ code.code }}</code>
              </td>
              <td>{{ code.owner_name }}</td>
              <td>{{ code.used_count }} / {{ code.max_uses }}</td>
              <td>{{ code.is_enabled ? '启用' : '停用' }}</td>
              <td>
                <div class="row-actions">
                  <WinButton label="复制邀请链接" icon="copy" subtle @click="copy(code.code)" /><WinButton
                    :label="code.is_enabled ? '停用' : '启用'"
                    subtle
                    :disabled="saving"
                    @click="toggle('invitations', code.id, !code.is_enabled)"
                  />
                </div>
              </td>
            </tr>
            <tr v-if="!data.codes.length">
              <td colspan="5" class="table-empty">暂无邀请码</td>
            </tr>
          </tbody>
        </table>
      </div>
      <WinDialog
        v-model:open="createOpen"
        title="创建邀请码"
        primary="创建"
        :busy="saving"
        :error="error"
        @primary="create"
        ><NumberBox
          v-model:Value="quantity"
          Header="创建数量"
          :Minimum="1"
          :Maximum="100"
          SpinButtonPlacementMode="Inline"
          AutomationProperties.Name="创建数量" /><NumberBox
          v-model:Value="maxUses"
          Header="每个邀请码可使用次数"
          :Minimum="1"
          :Maximum="100000"
          SpinButtonPlacementMode="Inline"
          AutomationProperties.Name="可使用次数"
      /></WinDialog>
    </div>
  </div>
</template>
