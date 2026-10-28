<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import { ComboBox } from 'winuionweb'
const props = defineProps<{
  modelValue: string | number
  options: Array<{ value: string | number; label: string }>
  label?: string
  placeholder?: string
  disabled?: boolean
}>()
const items = shallowRef(props.options)
// ComboBox retains item identity across selection and flyout transitions.
watch(
  () => props.options,
  (next) => {
    if (
      next.length !== items.value.length ||
      next.some(
        (item, index) => item.value !== items.value[index]!.value || item.label !== items.value[index]!.label,
      )
    )
      items.value = next
  },
)
const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()
function change(_sender: unknown, args: { AddedItems: Array<{ value: string | number }> }) {
  if (args.AddedItems.length) emit('update:modelValue', args.AddedItems[0]!.value)
}
</script>
<template>
  <ComboBox
    :ItemsSource="items"
    DisplayMemberPath="label"
    SelectedValuePath="value"
    :SelectedValue="modelValue"
    :Header="label || ''"
    :PlaceholderText="placeholder || '请选择'"
    :IsEnabled="!disabled"
    HorizontalAlignment="Stretch"
    :aria-label="label || placeholder"
    @SelectionChanged="change"
  />
</template>
