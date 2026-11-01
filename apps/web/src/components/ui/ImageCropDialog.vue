<script setup lang="ts">
import { computed, ref, shallowRef, watch, watchEffect } from 'vue'
import { imageCropOutputSize, imageCropRectangle, moveImageCrop, resizeImageCrop } from '../../imageCrop'
import type { CropHandle, CropRectangle } from '../../imageCrop'
import WinButton from './WinButton.vue'
import WinDialog from './WinDialog.vue'

const props = withDefaults(
  defineProps<{
    title: string
    primary?: string
    aspectRatio?: readonly [number, number]
    maxWidth?: number
    circularPreview?: boolean
    maxBytes?: number
    busy?: boolean
    error?: string
  }>(),
  { primary: '保存图片', aspectRatio: () => [1, 1], maxWidth: 1920 },
)
const emit = defineEmits<{ selected: []; confirm: [file: File] }>()
defineExpose({ choose, close: () => (open.value = false) })

const open = ref(false)
const input = ref<HTMLInputElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const stage = ref<HTMLElement | null>(null)
const file = shallowRef<File | null>(null)
const image = shallowRef<ImageBitmap | null>(null)
const loading = ref(false),
  generating = ref(false),
  localError = ref('')
const crop = ref<CropRectangle | null>(null)
const processing = computed(() => props.busy || generating.value)
const ratio = computed(() => props.aspectRatio[0] / props.aspectRatio[1])
const outputSize = computed(() =>
  crop.value ? imageCropOutputSize(crop.value.width, props.aspectRatio, props.maxWidth) : null,
)
const stageStyle = computed(() => {
  if (!image.value) return undefined
  const aspect = image.value.width / image.value.height
  return { width: `min(100%, calc(var(--crop-preview-max-height) * ${aspect}))`, aspectRatio: String(aspect) }
})
const frameStyle = computed(() => {
  if (!image.value || !crop.value) return undefined
  return {
    width: `${(crop.value.width / image.value.width) * 100}%`,
    height: `${(crop.value.height / image.value.height) * 100}%`,
    left: `${(crop.value.x / image.value.width) * 100}%`,
    top: `${(crop.value.y / image.value.height) * 100}%`,
  }
})
const handles: { value: CropHandle; label: string }[] = [
  { value: 'nw', label: '调整左上角' },
  { value: 'n', label: '调整上边缘' },
  { value: 'ne', label: '调整右上角' },
  { value: 'e', label: '调整右边缘' },
  { value: 'se', label: '调整右下角' },
  { value: 's', label: '调整下边缘' },
  { value: 'sw', label: '调整左下角' },
  { value: 'w', label: '调整左边缘' },
]

function choose() {
  if (processing.value) return
  input.value!.value = ''
  input.value!.click()
}
function select(event: Event) {
  const selected = (event.target as HTMLInputElement).files?.[0]
  if (!selected) return
  emit('selected')
  file.value = null
  localError.value = ''
  open.value = true
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(selected.type)) {
    localError.value = '仅支持 PNG、JPEG、WebP 和 GIF 图片'
  } else if (props.maxBytes && selected.size > props.maxBytes) {
    localError.value = `图片不能超过 ${props.maxBytes / 1024 / 1024} MiB`
  } else file.value = selected
}
function reset() {
  if (!image.value) return
  crop.value = imageCropRectangle(image.value.width, image.value.height, ratio.value)
}

watch(file, async (selected, _previous, onCleanup) => {
  image.value = null
  crop.value = null
  loading.value = !!selected
  let current = true
  let decoded: ImageBitmap | undefined
  onCleanup(() => {
    current = false
    decoded?.close()
  })
  if (!selected) return
  try {
    // Freeze animated inputs so the preview and exported crop use the same frame.
    decoded = await createImageBitmap(selected, { imageOrientation: 'from-image' })
    if (!current) {
      decoded.close()
      return
    }
    image.value = decoded
    reset()
  } catch {
    if (current) localError.value = '无法读取这张图片，请选择其他图片'
  } finally {
    if (current) loading.value = false
  }
})

watchEffect(
  () => {
    const surface = canvas.value,
      source = image.value
    if (!surface || !source) return
    const scale = Math.min(1, 896 / Math.max(source.width, source.height))
    surface.width = Math.max(1, Math.round(source.width * scale))
    surface.height = Math.max(1, Math.round(source.height * scale))
    const context = surface.getContext('2d')!
    context.drawImage(source, 0, 0, surface.width, surface.height)
  },
  { flush: 'post' },
)

let drag:
  { id: number; x: number; y: number; crop: CropRectangle; scale: number; handle?: CropHandle } | undefined
const dragging = ref(false)
function startDrag(event: PointerEvent, handle?: CropHandle) {
  if (!image.value || !crop.value || processing.value || !event.isPrimary || event.button !== 0) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  target.focus({ preventScroll: true })
  target.setPointerCapture(event.pointerId)
  drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    crop: { ...crop.value },
    scale: stage.value!.getBoundingClientRect().width / image.value.width,
    handle,
  }
  dragging.value = true
}
function moveDrag(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId || !image.value) return
  const dx = (event.clientX - drag.x) / drag.scale
  const dy = (event.clientY - drag.y) / drag.scale
  crop.value = drag.handle
    ? resizeImageCrop(
        drag.crop,
        image.value.width,
        image.value.height,
        drag.handle,
        dx,
        dy,
        minimumWidth(drag.scale),
      )
    : moveImageCrop(drag.crop, image.value.width, image.value.height, dx, dy)
}
function endDrag(event: PointerEvent) {
  if (drag?.id !== event.pointerId) return
  drag = undefined
  dragging.value = false
  const target = event.target as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}
function minimumWidth(scale: number) {
  return Math.max(48, 48 * ratio.value) / scale
}
function keyboard(event: KeyboardEvent, handle?: CropHandle) {
  if (!image.value || !crop.value || processing.value) return
  const directions: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }
  const direction = directions[event.key]
  if (!direction) return
  event.preventDefault()
  event.stopPropagation()
  const step = event.shiftKey ? 20 : 4
  const scale = stage.value!.getBoundingClientRect().width / image.value.width
  const dx = (direction[0] * step) / scale,
    dy = (direction[1] * step) / scale
  crop.value = handle
    ? resizeImageCrop(crop.value, image.value.width, image.value.height, handle, dx, dy, minimumWidth(scale))
    : moveImageCrop(crop.value, image.value.width, image.value.height, dx, dy)
}

async function confirm() {
  if (!image.value || !crop.value || !file.value || !outputSize.value || processing.value) return
  generating.value = true
  localError.value = ''
  try {
    const output = document.createElement('canvas')
    output.width = outputSize.value.width
    output.height = outputSize.value.height
    const context = output.getContext('2d')!
    const selection = crop.value
    context.drawImage(
      image.value,
      selection.x,
      selection.y,
      selection.width,
      selection.height,
      0,
      0,
      output.width,
      output.height,
    )
    const type = file.value.type === 'image/gif' ? 'image/png' : file.value.type
    const blob = await new Promise<Blob>((resolve, reject) =>
      output.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('图片裁剪失败，请重试'))),
        type,
        0.92,
      ),
    )
    if (props.maxBytes && blob.size > props.maxBytes)
      throw new Error('裁剪后的图片仍超过大小限制，请选择较小的图片')
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[blob.type]
    const name = `${file.value.name.replace(/\.[^.]+$/, '')}-cropped.${extension}`
    emit('confirm', new File([blob], name, { type: blob.type }))
  } catch (cause) {
    localError.value = (cause as Error).message
  } finally {
    generating.value = false
  }
}
function clear() {
  file.value = null
  localError.value = ''
  drag = undefined
  dragging.value = false
  input.value!.value = ''
}
</script>

<template>
  <input
    ref="input"
    type="file"
    class="visually-hidden"
    accept="image/png,image/jpeg,image/webp,image/gif"
    :aria-label="title"
    @change="select"
  />
  <WinDialog
    v-model:open="open"
    :title="title"
    :primary="processing ? '正在保存…' : primary"
    :busy="processing || loading || !image"
    :dismissible="!processing"
    :error="localError || error"
    @primary="confirm"
    @closed="clear"
  >
    <div class="image-crop-editor">
      <p class="image-crop-hint">拖动裁剪框移动，拖动边角调整大小。</p>
      <div
        ref="stage"
        class="image-crop-stage"
        :class="{ 'has-image': image, 'is-dragging': dragging, 'is-disabled': processing }"
        :style="stageStyle"
        @pointermove="moveDrag"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @lostpointercapture="endDrag"
      >
        <canvas v-show="image" ref="canvas" role="img" aria-label="待裁剪的图片" />
        <div
          v-if="crop"
          class="image-crop-frame"
          :style="frameStyle"
          role="group"
          aria-label="裁剪框，方向键移动，按住 Shift 加快"
          :tabindex="processing ? -1 : 0"
          @pointerdown.stop="startDrag($event)"
          @keydown="keyboard($event)"
        >
          <div class="image-crop-grid" aria-hidden="true" />
          <div v-if="circularPreview" class="image-crop-circle" aria-hidden="true" />
          <button
            v-for="handle in handles"
            :key="handle.value"
            type="button"
            class="image-crop-handle"
            :class="`is-${handle.value}`"
            :aria-label="handle.label"
            :title="`${handle.label}，也可使用方向键`"
            :disabled="processing"
            @pointerdown.stop="startDrag($event, handle.value)"
            @keydown="keyboard($event, handle.value)"
          />
        </div>
        <span v-else class="image-crop-status" role="status">{{
          loading ? '正在读取图片…' : '请选择图片'
        }}</span>
      </div>
      <div class="image-crop-meta">
        <span>{{ aspectRatio[0] }}:{{ aspectRatio[1] }}</span>
        <span v-if="outputSize">{{ outputSize.width }} × {{ outputSize.height }}</span>
      </div>
      <div class="row-actions">
        <WinButton label="更换图片" icon="image" :disabled="processing" @click="choose" />
        <WinButton label="重置" :disabled="!image || processing" @click="reset" />
      </div>
      <p v-if="file?.type === 'image/gif' || file?.type === 'image/webp'" class="field-hint">
        动图裁剪后保存为静态图片。
      </p>
    </div>
  </WinDialog>
</template>

<style scoped>
.image-crop-editor {
  width: min(448px, calc(100vw - 100px));
  max-width: 100%;
  /* WinUI ScrollViewer overlays its 12px scrollbar on the content. */
  padding-inline-end: 20px;
}
.image-crop-hint {
  margin: 0 0 12px;
  color: var(--text-secondary);
}
.image-crop-stage {
  --crop-preview-max-height: clamp(140px, calc(55dvh - 140px), 340px);
  position: relative;
  margin-inline: auto;
  overflow: hidden;
  border-radius: 4px;
  background-color: var(--SolidBackgroundFillColorBaseBrush);
  touch-action: none;
  user-select: none;
}
.image-crop-stage:not(.has-image) {
  height: 100px;
}
.image-crop-stage.is-dragging .image-crop-frame {
  cursor: grabbing;
}
.image-crop-stage.is-disabled .image-crop-frame {
  cursor: wait;
}
.image-crop-stage canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.image-crop-frame {
  position: absolute;
  outline: 1px solid white;
  outline-offset: -1px;
  box-shadow:
    0 0 0 1000px rgb(0 0 0 / 48%),
    inset 0 0 0 2px rgb(0 0 0 / 20%);
  cursor: move;
}
.image-crop-frame:focus-visible {
  outline: 2px solid var(--accent-text-fill-color-primary);
  outline-offset: -2px;
}
.image-crop-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.image-crop-grid::before,
.image-crop-grid::after {
  content: '';
  position: absolute;
  border: 0 solid rgb(255 255 255 / 40%);
}
.image-crop-grid::before {
  inset: calc(100% / 3) 0;
  border-block-width: 1px;
}
.image-crop-grid::after {
  inset: 0 calc(100% / 3);
  border-inline-width: 1px;
}
.image-crop-circle {
  position: absolute;
  inset: 0;
  border: 1px dashed white;
  border-radius: 50%;
  background: rgb(0 0 0 / 8%);
  pointer-events: none;
}
.image-crop-handle {
  position: absolute;
  width: min(28px, calc(100% / 3));
  height: min(28px, calc(100% / 3));
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  touch-action: none;
}
.image-crop-handle::after {
  content: '';
  position: absolute;
  inset: 2px;
  border: 0 solid white;
  filter: drop-shadow(0 1px 1px rgb(0 0 0 / 60%));
}
.image-crop-handle:focus-visible {
  outline: 2px solid var(--accent-text-fill-color-primary);
  outline-offset: -3px;
  background: var(--subtle-secondary);
}
.image-crop-handle.is-nw,
.image-crop-handle.is-ne {
  top: 0;
}
.image-crop-handle.is-sw,
.image-crop-handle.is-se {
  bottom: 0;
}
.image-crop-handle.is-nw,
.image-crop-handle.is-sw {
  left: 0;
}
.image-crop-handle.is-ne,
.image-crop-handle.is-se {
  right: 0;
}
.image-crop-handle.is-nw,
.image-crop-handle.is-se {
  cursor: nwse-resize;
}
.image-crop-handle.is-ne,
.image-crop-handle.is-sw {
  cursor: nesw-resize;
}
.image-crop-handle.is-nw::after {
  border-top-width: 3px;
  border-left-width: 3px;
}
.image-crop-handle.is-ne::after {
  border-top-width: 3px;
  border-right-width: 3px;
}
.image-crop-handle.is-sw::after {
  border-bottom-width: 3px;
  border-left-width: 3px;
}
.image-crop-handle.is-se::after {
  border-bottom-width: 3px;
  border-right-width: 3px;
}
.image-crop-handle.is-n,
.image-crop-handle.is-s {
  left: 50%;
  transform: translateX(-50%);
  cursor: ns-resize;
}
.image-crop-handle.is-w,
.image-crop-handle.is-e {
  top: 50%;
  transform: translateY(-50%);
  cursor: ew-resize;
}
.image-crop-handle.is-n {
  top: 0;
}
.image-crop-handle.is-s {
  bottom: 0;
}
.image-crop-handle.is-w {
  left: 0;
}
.image-crop-handle.is-e {
  right: 0;
}
.image-crop-handle.is-n::after {
  border-top-width: 3px;
}
.image-crop-handle.is-s::after {
  border-bottom-width: 3px;
}
.image-crop-handle.is-w::after {
  border-left-width: 3px;
}
.image-crop-handle.is-e::after {
  border-right-width: 3px;
}
.image-crop-status {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
}
.image-crop-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}
.image-crop-editor .row-actions {
  margin-top: 12px;
}
.image-crop-editor .field-hint {
  margin: 12px 0 0;
}
</style>
