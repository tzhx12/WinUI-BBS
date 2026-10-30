import { createApp } from 'vue'
import WinUIOnWeb from 'winuionweb'
import 'winuionweb/style.css'
import './iconCompatibility.css'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { initializeIconFont } from './iconPlatform'

await initializeIconFont()
createApp(App).use(WinUIOnWeb, { locale: 'zh-CN' }).use(router).mount('#app')
