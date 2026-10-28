<script setup lang="ts">
import { PersonPicture } from 'winuionweb'
import { useSite } from '../site'
import { formatDate, groupTypes } from '../utils'
import PageHeader from '../components/ui/PageHeader.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import WinButton from '../components/ui/WinButton.vue'
import MemberCard from '../components/MemberCard.vue'
defineOptions({ inheritAttrs: false })
const site = useSite()
async function copyUuid() {
  await navigator.clipboard.writeText(site.user.value!.uuid)
  site.notify('UUID 已复制')
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content">
      <PageHeader title="个人资料" />
      <EmptyState v-if="!site.user.value" title="登录后查看个人资料" icon="person"
        ><WinButton label="登录 / 注册" accent @click="site.authOpen.value = true"
      /></EmptyState>
      <div v-else class="profile-layout">
        <section class="surface-card">
          <div class="profile-identity">
            <PersonPicture
              :DisplayName="site.user.value.displayName"
              :ProfilePicture="site.user.value.avatarUrl || undefined"
              :Width="72"
              :Height="72"
            />
            <div>
              <h2>{{ site.user.value.displayName }}</h2>
              <p class="secondary-text">@{{ site.user.value.username }}</p>
            </div>
          </div>
          <dl class="details-list">
            <div>
              <dt>UID</dt>
              <dd>{{ site.user.value.uid }}</dd>
            </div>
            <div>
              <dt>UUID</dt>
              <dd class="uuid-value">
                {{ site.user.value.uuid }}<WinButton label="复制 UUID" icon="copy" subtle @click="copyUuid" />
              </dd>
            </div>
            <div>
              <dt>等级</dt>
              <dd>
                Lv.{{ site.user.value.level }}
                <span v-if="site.user.value.title" :style="{ color: site.user.value.title.color }">{{
                  site.user.value.title.title
                }}</span>
              </dd>
            </div>
            <div>
              <dt>累计经验</dt>
              <dd>{{ site.user.value.experience }}</dd>
            </div>
          </dl>
          <h3>所属用户组</h3>
          <div class="membership-list">
            <div v-for="group in site.user.value.groups" :key="group.id" class="setting-row">
              <div>
                <strong>{{ group.name }}</strong
                ><small
                  >{{ groupTypes.find((type) => type.value === group.group_type)?.label
                  }}<template v-if="group.expires_at">
                    · {{ formatDate(group.expires_at) }} 到期</template
                  ></small
                >
              </div>
            </div>
          </div>
        </section>
        <MemberCard />
      </div>
    </div>
  </div>
</template>
