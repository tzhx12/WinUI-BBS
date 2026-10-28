<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { ContentDialog, InfoBar, ScrollViewer } from 'winuionweb'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    primary?: string
    close?: string
    busy?: boolean
    error?: string
  }>(),
  { primary: '', close: '取消' },
)
const emit = defineEmits<{ 'update:open': [open: boolean]; primary: []; closed: [] }>()
const dialog = ref<InstanceType<typeof ContentDialog> | null>(null)
const xamlRoot = ref<HTMLElement>()
watch(
  () => props.open,
  async (open) => {
    await nextTick()
    if (open) {
      // Scope modal isolation to the application; WinUI flyouts portal to body.
      xamlRoot.value = document.getElementById('forum-root')!
      await nextTick()
      await dialog.value!.ShowAsync()
    } else dialog.value?.Hide()
  },
  { immediate: true },
)
function primaryClick(_sender: unknown, args: { Cancel: boolean }) {
  args.Cancel = true
  emit('primary')
}
function closed() {
  emit('update:open', false)
  emit('closed')
}
</script>
<template>
  <ContentDialog
    ref="dialog"
    :XamlRoot="xamlRoot"
    :Title="title"
    :PrimaryButtonText="primary"
    :CloseButtonText="close"
    DefaultButton="Primary"
    :IsPrimaryButtonEnabled="!busy"
    PrimaryButtonStyle="{StaticResource AccentButtonStyle}"
    @PrimaryButtonClick="primaryClick"
    @Closed="closed"
  >
    <div class="dialog-fields">
      <ScrollViewer
        VerticalScrollBarVisibility="Auto"
        VerticalScrollMode="Auto"
        HorizontalScrollBarVisibility="Disabled"
        MaxHeight="min(55vh, 520px)"
        ><div class="form-stack"><slot /></div></ScrollViewer
      ><InfoBar :IsOpen="true" v-if="error" :Message="error" Severity="Error" :IsClosable="false" />
    </div>
  </ContentDialog>
</template>
