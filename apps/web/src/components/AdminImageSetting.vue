<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { InfoBar } from 'winuionweb'
import { api, uploadForm } from '../api'
import { useSite } from '../site'
import WinButton from './ui/WinButton.vue'
import ImageCropDialog from './ui/ImageCropDialog.vue'
import WinSelect from './ui/WinSelect.vue'
import { backgroundCropPreset } from '../imageCrop'
import type { ImageCropPreset } from '../imageCrop'
import type { BackgroundHeight } from '../types'

const props = defineProps<{
  label: string
  url: string
  endpoint: string
  icon?: boolean
  cropPreset: ImageCropPreset
  backgroundHeight?: BackgroundHeight
}>()
const emit = defineEmits<{ updated: [url: string]; 'height-updated': [height: BackgroundHeight] }>()
const site = useSite()
const cropper = ref<InstanceType<typeof ImageCropDialog> | null>(null),
  busy = ref(false),
  error = ref('')
const heightChoice = ref<BackgroundHeight>(props.backgroundHeight ?? 50)
watch(
  () => props.backgroundHeight,
  (height) => {
    if (height !== undefined) heightChoice.value = height
  },
)
const preset = computed(() =>
  props.backgroundHeight === undefined ? props.cropPreset : backgroundCropPreset(heightChoice.value),
)
const heightOptions = [
  { value: 50, label: '固定半屏渐变' },
  { value: 75, label: '固定 3/4 屏渐变' },
]
async function changeHeight(value: string | number) {
  if (value === props.backgroundHeight || busy.value) return
  const height = value as BackgroundHeight
  heightChoice.value = height
  busy.value = true
  error.value = ''
  try {
    const result = await api<{ height: BackgroundHeight }>(props.endpoint, {
      method: 'PATCH',
      token: site.token.value,
      body: { height },
    })
    emit('height-updated', result.height)
    site.notify('背景显示范围已更新')
  } catch (cause) {
    heightChoice.value = props.backgroundHeight!
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}
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
    cropper.value?.close()
    site.notify(file ? `${props.label}已更新` : `已移除${props.label}`)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '图片更新失败'
  } finally {
    busy.value = false
  }
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
    <WinSelect
      v-if="backgroundHeight !== undefined"
      :model-value="heightChoice"
      label="背景显示范围"
      :options="heightOptions"
      :disabled="busy"
      @update:model-value="changeHeight"
    />
    <div
      v-if="url"
      class="admin-image-preview"
      :class="{ 'is-icon': icon }"
      :style="!icon ? { aspectRatio: preset.aspectRatio.join('/') } : undefined"
    >
      <img :src="url" :alt="label" />
    </div>
    <InfoBar v-if="error" :IsOpen="true" :Message="error" Severity="Error" :IsClosable="false" />
    <div class="row-actions">
      <WinButton
        :label="busy ? '正在处理…' : url ? '更换图片' : '上传图片'"
        icon="upload"
        :disabled="busy"
        @click="cropper?.choose()"
      /><WinButton v-if="url" label="移除图片" icon="delete" :disabled="busy" @click="change()" />
    </div>
    <ImageCropDialog
      ref="cropper"
      :title="`裁剪${label}`"
      v-bind="preset"
      :max-bytes="(icon ? 2 : 10) * 1024 * 1024"
      :busy="busy"
      :error="error"
      @selected="error = ''"
      @confirm="change"
    />
  </section>
</template>
