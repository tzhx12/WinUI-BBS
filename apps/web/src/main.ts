import { createApp } from 'vue'
import WinUIOnWeb from 'winuionweb'
import 'winuionweb/style.css'
import './style.css'
import App from './App.vue'
import { router } from './router'

createApp(App).use(WinUIOnWeb, { locale: 'zh-CN' }).use(router).mount('#app')
