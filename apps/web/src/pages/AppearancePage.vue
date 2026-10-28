<script setup lang="ts">
import { computed, watch } from 'vue'
import { NumberBox, RadioButtons, RadioButton, ToggleSwitch } from 'winuionweb'
import { useSite } from '../site'
import PageHeader from '../components/ui/PageHeader.vue'
import WinButton from '../components/ui/WinButton.vue'
import WinSelect from '../components/ui/WinSelect.vue'

defineOptions({ inheritAttrs: false })
const site = useSite()
const compactNavigation = site.compactNavigation
const fontScale = site.fontScale
const accent = site.accent
const accentOptions = [
  { value: 'blue', label: '蓝色' },
  { value: 'teal', label: '青绿色' },
  { value: 'purple', label: '紫色' },
  { value: 'orange', label: '橙色' },
]
const scaleLabel = computed(() => `${fontScale.value}%`)
const lightTheme = computed({
  get: () => site.theme.value === 'light',
  set: (checked: boolean) => {
    if (checked) setTheme('light')
  },
})
const darkTheme = computed({
  get: () => site.theme.value === 'dark',
  set: (checked: boolean) => {
    if (checked) setTheme('dark')
  },
})
watch(compactNavigation, (value) => localStorage.setItem('forum-compact-navigation', String(value)))
watch(fontScale, (value) => {
  document.documentElement.style.setProperty('--forum-font-scale', String(value / 100))
  localStorage.setItem('forum-font-scale', String(value))
})
watch(accent, (value) => {
  document.documentElement.dataset.accent = String(value)
  localStorage.setItem('forum-accent', String(value))
})
function setTheme(value: 'light' | 'dark') {
  site.theme.value = value
  localStorage.setItem('forum-theme', value)
}
function reset() {
  compactNavigation.value = false
  fontScale.value = 100
  accent.value = 'blue'
  site.theme.value = 'light'
  localStorage.removeItem('forum-compact-navigation')
  localStorage.removeItem('forum-font-scale')
  localStorage.removeItem('forum-accent')
  localStorage.removeItem('forum-theme')
  document.documentElement.style.setProperty('--forum-font-scale', '1')
  delete document.documentElement.dataset.accent
  site.notify('已恢复默认外观')
}
</script>
<template>
  <div class="page-scroll">
    <div class="page-content settings-page">
      <PageHeader title="外观设置" />
      <p class="secondary-text appearance-description">更改会立即应用，并保存在当前浏览器中。</p>
      <section class="surface-card appearance-section">
        <h2>主题</h2>
        <RadioButtons Header="颜色模式"
          ><RadioButton Content="浅色" v-model:IsChecked="lightTheme" /><RadioButton
            Content="深色"
            v-model:IsChecked="darkTheme"
        /></RadioButtons>
      </section>
      <section class="surface-card appearance-section">
        <h2>界面密度</h2>
        <ToggleSwitch Header="紧凑导航" v-model:IsOn="compactNavigation" OnContent="紧凑" OffContent="标准" />
        <div class="appearance-field">
          <NumberBox
            v-model:Value="fontScale"
            Header="文字缩放"
            :Minimum="90"
            :Maximum="125"
            :SmallChange="5"
            SpinButtonPlacementMode="Inline"
            aria-label="文字缩放百分比"
          /><span class="secondary-text">{{ scaleLabel }}</span>
        </div>
      </section>
      <section class="surface-card appearance-section">
        <h2>强调色</h2>
        <WinSelect v-model="accent" label="强调色" :options="accentOptions" />
      </section>
      <div class="appearance-actions">
        <WinButton label="恢复默认" icon="refresh" subtle @click="reset" />
      </div>
    </div>
  </div>
</template>
