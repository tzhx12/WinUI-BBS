<script setup lang="ts">
import { Button } from 'winuionweb'
import IconGlyph from '../IconGlyph.vue'
import type { IconName } from '../iconNames'

withDefaults(
  defineProps<{
    label?: string
    icon?: IconName
    accent?: boolean
    subtle?: boolean
    disabled?: boolean
    iconOnly?: boolean
  }>(),
  {
    label: '',
    accent: false,
    subtle: false,
    disabled: false,
  },
)
defineEmits<{ click: [] }>()
</script>

<template>
  <Button
    :IsEnabled="!disabled"
    :Style="
      accent
        ? '{StaticResource AccentButtonStyle}'
        : subtle
          ? '{StaticResource SubtleButtonStyle}'
          : '{StaticResource DefaultButtonStyle}'
    "
    :aria-label="label"
    :title="label"
    @Click="$emit('click')"
  >
    <span class="button-content"
      ><IconGlyph v-if="icon" :name="icon" :size="16" /><span v-if="label && !iconOnly"
        ><slot>{{ label }}</slot></span
      ></span
    >
  </Button>
</template>
