<script setup lang="ts">
import { NumberBox, CheckBox } from 'winuionweb'
import type { MediaLimits } from '../types/admin'
const props = defineProps<{ modelValue: Partial<MediaLimits>; overrides?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: Partial<MediaLimits>] }>()
const fields: Array<{
  key: keyof MediaLimits
  label: string
  unit: number
  initial: number
  min: number
  max: number
}> = [
  { key: 'storageBytes', label: '总容量 (GiB)', unit: 1024 ** 3, initial: 1, min: 1 / 1024, max: 1024 },
  { key: 'imageBytes', label: '单图大小 (MiB)', unit: 1024 ** 2, initial: 20, min: 1 / 1024, max: 100 },
  { key: 'emojiPackCount', label: '表情包组数', unit: 1, initial: 20, min: 0, max: 10000 },
  { key: 'emojiImagesPerPack', label: '每组图片数', unit: 1, initial: 150, min: 1, max: 150 },
  { key: 'emojiImageBytes', label: '单张表情 (MiB)', unit: 1024 ** 2, initial: 3, min: 1 / 1024, max: 3 },
]
function set(key: keyof MediaLimits, value: number) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}
function toggle(field: (typeof fields)[number], checked: boolean | null) {
  const next = { ...props.modelValue }
  if (checked) next[field.key] = field.initial * field.unit
  else delete next[field.key]
  emit('update:modelValue', next)
}
</script>
<template>
  <div class="limits-grid">
    <div v-for="field in fields" :key="field.key" class="limit-field">
      <CheckBox
        v-if="overrides"
        :Content="field.label"
        :IsChecked="modelValue[field.key] !== undefined"
        @update:IsChecked="toggle(field, $event)"
      />
      <NumberBox
        :Header="overrides ? '' : field.label"
        :Value="modelValue[field.key] === undefined ? field.initial : modelValue[field.key]! / field.unit"
        :IsEnabled="!overrides || modelValue[field.key] !== undefined"
        :Minimum="field.min"
        :Maximum="field.max"
        :SmallChange="1"
        SpinButtonPlacementMode="Inline"
        v-bind="{ 'AutomationProperties.Name': field.label }"
        @update:Value="set(field.key, Math.round($event * field.unit))"
      />
    </div>
  </div>
</template>
