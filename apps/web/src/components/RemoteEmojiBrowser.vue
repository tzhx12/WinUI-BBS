<script setup lang="ts">
import { computed, ref } from 'vue'
import { TextBox, ProgressRing } from 'winuionweb'
import { api } from '../api'
import { useSite } from '../site'
import WinButton from './ui/WinButton.vue'
import WinDialog from './ui/WinDialog.vue'
import WinSelect from './ui/WinSelect.vue'
import ResourceState from './ui/ResourceState.vue'
const props = defineProps<{ admin?: boolean }>()
const emit = defineEmits<{ added: [] }>()
const site = useSite(),
  prefix = computed(() => (props.admin ? '/api/admin' : '/api/me'))
interface RemotePack {
  id: number
  name: string
  thumbnail: string
}
interface Detail {
  id: number
  name: string
  hasAnimated: boolean
  items: Array<{ name: string; url: string; animatedUrl: string | null }>
}
const search = ref(''),
  items = ref<RemotePack[]>([]),
  total = ref(0),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  detail = ref<Detail | null>(null),
  preview = ref(false),
  variant = ref<string | number>('static')
async function load(more = false) {
  loading.value = true
  error.value = ''
  try {
    const result = await api<{ items: RemotePack[]; total: number }>(
      `${prefix.value}/remote-emoji/packages?q=${encodeURIComponent(search.value)}&offset=${more ? items.value.length : 0}`,
      { token: site.token.value },
    )
    items.value = more ? [...items.value, ...result.items] : result.items
    total.value = result.total
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    loading.value = false
  }
}
async function show(pack: RemotePack) {
  loading.value = true
  error.value = ''
  try {
    detail.value = await api<Detail>(`${prefix.value}/remote-emoji/packages/${pack.id}`, {
      token: site.token.value,
    })
    variant.value = 'static'
    preview.value = true
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    loading.value = false
  }
}
async function add() {
  busy.value = true
  error.value = ''
  try {
    await api(`${prefix.value}/remote-emoji/import`, {
      method: 'POST',
      token: site.token.value,
      body: { remoteId: detail.value!.id, variant: variant.value },
    })
    preview.value = false
    site.notify('表情包已添加')
    emit('added')
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <section class="surface-card">
    <h2>远端表情包</h2>
    <form class="toolbar-search" @submit.prevent="load()">
      <TextBox
        v-model:Text="search"
        PlaceholderText="搜索表情包"
        AutomationProperties.Name="搜索远端表情包"
      /><WinButton label="搜索" icon="search" :disabled="loading" @click="load()" />
    </form>
    <ResourceState :loading="loading" :error="preview ? '' : error" />
    <div class="remote-pack-grid">
      <button v-for="pack in items" :key="pack.id" class="remote-pack" type="button" @click="show(pack)">
        <img :src="pack.thumbnail" :alt="pack.name" loading="lazy" referrerpolicy="no-referrer" /><strong>{{
          pack.name
        }}</strong>
      </button>
    </div>
    <div v-if="items.length < total" class="form-actions">
      <WinButton label="加载更多" :disabled="loading" @click="load(true)" />
    </div>
    <WinDialog
      v-model:open="preview"
      :title="detail?.name || '表情包预览'"
      primary="添加表情包"
      :busy="busy"
      :error="error"
      @primary="add"
      ><template v-if="detail">
        <WinSelect
          v-model="variant"
          label="版本"
          :disabled="busy"
          :options="
            detail.hasAnimated
              ? [
                  { value: 'static', label: '静态' },
                  { value: 'animated', label: '动态' },
                ]
              : [{ value: 'static', label: '静态' }]
          "
        />
        <div class="emoji-preview-grid">
          <img
            v-for="item in detail.items.filter((item) => variant === 'static' || item.animatedUrl)"
            :key="item.name"
            :src="variant === 'animated' ? item.animatedUrl! : item.url"
            :alt="item.name"
            :title="item.name"
            referrerpolicy="no-referrer"
            loading="lazy"
          />
        </div>
        <p v-if="busy" class="secondary-text">
          <ProgressRing :IsActive="true" :Width="18" :Height="18" /> 正在下载表情包…
        </p>
      </template></WinDialog
    >
  </section>
</template>
