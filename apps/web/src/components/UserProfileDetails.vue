<script setup lang="ts">
import { PersonPicture } from 'winuionweb'
import type { User } from '../types'
import { useSite } from '../site'
import { formatDate, groupTypes } from '../utils'
import WinButton from './ui/WinButton.vue'
defineProps<{ user: User }>()
const site = useSite()
async function copyUuid(uuid: string) {
  await navigator.clipboard.writeText(uuid)
  site.notify('UUID 已复制')
}
</script>
<template>
  <section class="surface-card user-profile-details">
    <div class="profile-summary-heading">
      <div class="profile-identity">
        <PersonPicture
          :DisplayName="user.displayName"
          :ProfilePicture="user.avatarUrl || undefined"
          :Width="72"
          :Height="72"
        />
        <div>
          <h2>{{ user.displayName }}</h2>
          <p class="secondary-text">@{{ user.username }}</p>
          <p class="user-space-followers" aria-live="polite">
            <strong>{{ (user.followerCount || 0).toLocaleString() }}</strong
            ><span class="secondary-text">粉丝</span>
          </p>
        </div>
      </div>
      <slot name="action" />
    </div>
    <dl class="details-list">
      <div>
        <dt>UID</dt>
        <dd>{{ user.uid }}</dd>
      </div>
      <div>
        <dt>UUID</dt>
        <dd class="uuid-value">
          {{ user.uuid }}<WinButton label="复制 UUID" icon="copy" subtle @click="copyUuid(user.uuid)" />
        </dd>
      </div>
      <div>
        <dt>等级</dt>
        <dd>
          Lv.{{ user.level }}
          <span v-if="user.title" :style="{ color: user.title.color }">{{ user.title.title }}</span>
        </dd>
      </div>
      <div>
        <dt>累计经验</dt>
        <dd>{{ user.experience }}</dd>
      </div>
    </dl>
    <h3>所属用户组</h3>
    <div class="membership-list">
      <div v-for="group in user.groups" :key="group.id" class="setting-row">
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
      <p v-if="!user.groups?.length" class="secondary-text">暂无用户组</p>
    </div>
  </section>
</template>
