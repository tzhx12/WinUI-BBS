<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../../api'
import { useResource } from '../../composables/useResource'
import { useSite } from '../../site'
import type { Overview } from '../../types/admin'
import PageHeader from '../../components/ui/PageHeader.vue'
import ResourceState from '../../components/ui/ResourceState.vue'
import WinButton from '../../components/ui/WinButton.vue'
import IconGlyph from '../../components/IconGlyph.vue'
defineOptions({ inheritAttrs: false })
const site = useSite(),
  router = useRouter()
const { data, loading, error, reload } = useResource<Overview | null>(
  () => api('/api/admin/overview', { token: site.token.value }),
  null,
)
const maxActivity = computed(() => Math.max(1, ...(data.value?.activity.map((item) => item.posts) || [])))
const stats = computed(() =>
  data.value
    ? [
        { label: '社区用户', value: data.value.stats.users, icon: 'people' as const },
        { label: '已发布帖子', value: data.value.stats.posts, icon: 'chat' as const },
        { label: '今日签到', value: data.value.stats.checkins, icon: 'calendar' as const },
        { label: '媒体文件', value: data.value.stats.media, icon: 'image' as const },
      ]
    : [],
)
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="管理概览" description="查看社区运行情况和近期动态。"
        ><WinButton label="刷新" icon="refresh" @click="reload" /></PageHeader
      ><ResourceState :loading="loading" :error="error" />
      <template v-if="data"
        ><div class="stats-grid">
          <section v-for="item in stats" :key="item.label" class="surface-card stat-card">
            <IconGlyph :name="item.icon" :size="22" />
            <div>
              <span>{{ item.label }}</span
              ><strong>{{ item.value }}</strong>
            </div>
          </section>
        </div>
        <div class="overview-grid">
          <section class="surface-card activity-panel">
            <div class="section-toolbar">
              <h2>近期发帖</h2>
              <span class="secondary-text">最近 {{ data.activity.length }} 天</span>
            </div>
            <div class="activity-chart">
              <div
                v-for="entry in data.activity"
                :key="entry.day"
                class="activity-column"
                :title="`${entry.day}：${entry.posts} 篇`"
              >
                <span class="activity-value">{{ entry.posts }}</span>
                <div class="activity-track">
                  <div :style="{ height: `${(entry.posts / maxActivity) * 100}%` }" />
                </div>
                <span class="activity-date">{{ entry.day.slice(5).replace('-', '/') }}</span>
              </div>
            </div>
          </section>
          <section class="surface-card">
            <h2>用户组成员</h2>
            <div v-for="group in data.groups" :key="group.id" class="compact-row">
              <span>{{ group.name }}</span
              ><strong>{{ group.member_count }}</strong>
            </div>
          </section>
        </div>
        <section class="surface-card">
          <div class="section-toolbar">
            <div>
              <h2>内容管理</h2>
              <p class="secondary-text">
                共 {{ data.stats.replies }} 条回复，{{ data.stats.pending }} 篇帖子待审核。
              </p>
            </div>
            <WinButton
              v-if="site.user.value?.permissions?.includes('posts.manage')"
              label="发帖管理"
              icon="arrow"
              @click="router.push('/admin/posts')"
            />
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
