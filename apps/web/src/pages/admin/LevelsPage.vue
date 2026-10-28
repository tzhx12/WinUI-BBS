<script setup lang="ts">
import { computed } from 'vue'
import { CheckBox, InfoBar, NumberBox, TextBox } from 'winuionweb'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import type { LevelConfig } from '../../types/admin'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
defineOptions({ inheritAttrs: false })
const site = useSite()
const {
  data: config,
  loading,
  error,
  saving,
  reload,
  run,
} = useResource<LevelConfig>(() => api('/api/admin/level-config', { token: site.token.value }), {
  pointsPerLevel: 100,
  titles: [],
  rules: [],
})
const validRanges = computed(() =>
  [...config.value.titles]
    .sort((a, b) => a.minimum_level - b.minimum_level)
    .every(
      (item, index, all) =>
        item.minimum_level <= item.maximum_level &&
        (!index || item.minimum_level > all[index - 1]!.maximum_level),
    ),
)
const names = { checkin: '每日签到', create_post: '发布帖子', create_reply: '回复帖子' }
function addTitle() {
  const start = Math.max(0, ...config.value.titles.map((item) => item.maximum_level)) + 1
  config.value.titles.push({ minimum_level: start, maximum_level: start + 4, title: '', color: '#0078d4' })
}
async function save() {
  if (
    await run(
      () =>
        api('/api/admin/level-config', {
          method: 'PUT',
          token: site.token.value,
          body: {
            pointsPerLevel: config.value.pointsPerLevel,
            titles: config.value.titles.map((item) => ({
              minimumLevel: item.minimum_level,
              maximumLevel: item.maximum_level,
              title: item.title,
              color: item.color,
            })),
            rules: config.value.rules.map((rule) => ({
              actionKey: rule.action_key,
              points: rule.points,
              isEnabled: rule.is_enabled,
            })),
          },
        }),
      '等级与经验规则已保存',
    )
  )
    await Promise.all([reload(), site.refreshUser()])
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="等级与经验" description="设置升级所需经验、活动奖励和等级头衔。"
        ><WinButton
          label="保存设置"
          icon="check"
          accent
          :disabled="saving || !validRanges"
          @click="save" /></PageHeader
      ><ResourceState :loading="loading" :error="error" />
      <template v-if="!loading"
        ><section class="surface-card">
          <div class="setting-row">
            <div>
              <h2>升级经验</h2>
              <p class="secondary-text">每累计相应经验升一级，管理员可单独调整用户等级。</p>
            </div>
            <NumberBox
              v-model:Value="config.pointsPerLevel"
              :Minimum="1"
              SpinButtonPlacementMode="Inline"
              AutomationProperties.Name="每级所需经验"
            />
          </div>
        </section>
        <section class="surface-card">
          <h2>经验获取</h2>
          <div v-for="rule in config.rules" :key="rule.action_key" class="setting-row">
            <CheckBox v-model:IsChecked="rule.is_enabled" :Content="names[rule.action_key]" />
            <div class="inline-field">
              <NumberBox
                v-model:Value="rule.points"
                :MinWidth="0"
                :Width="150"
                :Minimum="0"
                :IsEnabled="rule.is_enabled"
                SpinButtonPlacementMode="Inline"
                v-bind="{ 'AutomationProperties.Name': `${names[rule.action_key]}经验` }"
              /><span class="secondary-text">EXP</span>
            </div>
          </div>
        </section>
        <section class="surface-card">
          <div class="section-toolbar">
            <div>
              <h2>等级头衔</h2>
              <p class="secondary-text">为不同等级范围设置头衔与颜色。</p>
            </div>
            <WinButton label="添加范围" icon="add" @click="addTitle" />
          </div>
          <InfoBar
            :IsOpen="true"
            v-if="!validRanges"
            Severity="Warning"
            Message="等级范围不能重叠，结束等级不能小于开始等级。"
            :IsClosable="false"
          />
          <div class="level-titles">
            <div v-for="(title, index) in config.titles" :key="index" class="level-title-row">
              <NumberBox
                v-model:Value="title.minimum_level"
                Header="开始等级"
                :Minimum="1"
                SpinButtonPlacementMode="Compact"
                v-bind="{ 'AutomationProperties.Name': `范围 ${index + 1} 开始等级` }"
              /><NumberBox
                v-model:Value="title.maximum_level"
                Header="结束等级"
                :Minimum="1"
                SpinButtonPlacementMode="Compact"
                v-bind="{ 'AutomationProperties.Name': `范围 ${index + 1} 结束等级` }"
              /><TextBox
                v-model:Text="title.title"
                Header="头衔"
                :aria-label="`范围 ${index + 1} 头衔`"
                :MaxLength="48"
              />
              <div class="color-field">
                <TextBox
                  v-model:Text="title.color"
                  Header="颜色"
                  :aria-label="`范围 ${index + 1} 颜色`"
                  :MaxLength="7"
                /><span :style="{ background: title.color }" />
              </div>
              <WinButton label="移除范围" icon="delete" subtle @click="config.titles.splice(index, 1)" />
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
