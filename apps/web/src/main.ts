import { createApp } from 'vue'
import { createI18n, i18nKey } from 'winuionweb'
import 'winuionweb/style.css'
import './iconCompatibility.css'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { initializeIconFont } from './iconPlatform'

await initializeIconFont()
const app = createApp(App)
const i18n = createI18n('zh-CN')
app.provide(i18nKey, i18n)
app.config.globalProperties.$t = i18n.t
app.use(router).mount('#app')
