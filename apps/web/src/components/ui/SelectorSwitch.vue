<script setup lang="ts" generic="T extends string">
import { computed, shallowRef, watch } from 'vue'
import { SelectorBar } from 'winuionweb'

interface SelectorSwitchOption {
  value: T
  label: string
  icon?: string
}

const props = defineProps<{
  modelValue: T
  options: SelectorSwitchOption[]
  ariaLabel?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

function createItems() {
  return props.options.map((option) => ({
    Tag: option.value,
    Text: option.label,
    Style: '{StaticResource TokenViewSelectorBarItemStyle}',
    ...(option.icon ? { Icon: option.icon } : {}),
  }))
}
const items = shallowRef(createItems())
watch(
  () => props.options,
  (options) => {
    if (
      options.length !== items.value.length ||
      options.some((option, index) => {
        const item = items.value[index]!
        return option.value !== item.Tag || option.label !== item.Text || option.icon !== item.Icon
      })
    )
      items.value = createItems()
  },
)
const selectedItem = computed(() => items.value.find((item) => item.Tag === props.modelValue) ?? null)

function selectionChanged(sender: { SelectedItem?: { Tag?: T } }) {
  const value = sender.SelectedItem?.Tag
  if (value !== undefined && value !== props.modelValue) emit('update:modelValue', value)
}
</script>

<template>
  <SelectorBar
    class="selector-switch"
    Style="{StaticResource TokenViewSelectorBarStyle}"
    :Items="items"
    :SelectedItem="selectedItem"
    :aria-label="ariaLabel"
    @SelectionChanged="selectionChanged"
  />
</template>
