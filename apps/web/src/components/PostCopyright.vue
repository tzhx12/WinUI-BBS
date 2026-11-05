<script setup lang="ts">
import { computed } from 'vue'
import { copyrightLicenses } from '../copyright'

const props = defineProps<{ license?: string; author: string }>()
const license = computed(() => copyrightLicenses.find((item) => item.value === props.license))
</script>

<template>
  <footer
    v-if="license || props.license === 'all-rights-reserved'"
    class="post-copyright"
    aria-label="版权声明"
  >
    <a v-if="license" :href="license.url" target="_blank" rel="license noopener noreferrer">
      <img :src="license.badge" :alt="license.label" width="88" height="31" />
    </a>
    <span v-else class="copyright-symbol" aria-hidden="true">©</span>
    <div class="copyright-text">
      <template v-if="license">
        <a :href="license.url" target="_blank" rel="license noopener noreferrer"
          >{{ license.name }}<template v-if="license.value !== 'cc0'">（{{ license.label }}）</template></a
        >
        <p>
          本文由 {{ author }} 发布，采用上述{{
            license.value === 'cc0' ? '公共领域贡献声明' : '许可协议'
          }}。{{ license.notice }}
        </p>
      </template>
      <template v-else>
        <strong>版权所有声明</strong>
        <p>本文版权归 {{ author }} 所有。未经作者许可，不得转载或改编。</p>
      </template>
    </div>
  </footer>
</template>

<style scoped>
.post-copyright {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--stroke-divider);
  font-size: 13px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.post-copyright img {
  display: block;
}
.copyright-symbol {
  font-size: 32px;
  line-height: 31px;
}
.copyright-text {
  flex: 1 1 240px;
  min-width: 0;
}
.copyright-text p {
  margin: 4px 0 0;
  color: var(--text-secondary);
}
</style>
