<script setup lang="ts">
import { ref } from 'vue'
import { InfoBar } from 'winuionweb'
import { api, uploadForm } from '../api'
import { useSite } from '../site'
import WinButton from './ui/WinButton.vue'

const props = defineProps<{ label: string; url: string; endpoint: string; icon?: boolean }>()
const emit = defineEmits<{ updated: [url: string] }>()
const site = useSite()
const input = ref<HTMLInputElement | null>(null),
  busy = ref(false),
  error = ref('')
async function change(file?: File) {
  busy.value = true
  error.value = ''
  try {
    if (file && file.size > (props.icon ? 2 : 10) * 1024 * 1024)
      throw new Error(props.icon ? '图标不能超过 2 MiB' : '背景图不能超过 10 MiB')
    const result = await api<{ url: string }>(props.endpoint, {
      method: file ? 'POST' : 'DELETE',
      token: site.token.value,
      ...(file ? { body: uploadForm(file) } : {}),
    })
    emit('updated', result.url)
    site.notify(file ? `${props.label}已更新` : `已移除${props.label}`)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '图片更新失败'
  } finally {
    busy.value = false
    if (input.value) input.value.value = ''
  }
}
function choose(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) void change(file)
}
</script>
<template>
  <section class="admin-image-setting" :aria-label="label">
    <div class="setting-row">
      <div>
        <h3>{{ label }}</h3>
        <p class="secondary-text">
          {{ icon ? '建议使用方形透明图片，最大 2 MiB。' : '建议使用横向图片，最大 10 MiB。' }}
        </p>
      </div>
    </div>
    <div v-if="url" class="admin-image-preview" :class="{ 'is-icon': icon }">
      <img :src="url" :alt="label" />
    </div>
    <InfoBar v-if="error" :IsOpen="true" :Message="error" Severity="Error" :IsClosable="false" />
    <div class="row-actions">
      <WinButton
        :label="busy ? '正在处理…' : url ? '更换图片' : '上传图片'"
        icon="upload"
        :disabled="busy"
        @click="input?.click()"
      /><WinButton v-if="url" label="移除图片" icon="delete" :disabled="busy" @click="change()" /><input
        ref="input"
        class="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        :aria-label="`上传${label}`"
        @change="choose"
      />
    </div>
  </section>
</template>
