import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
// Element Plus 暗色变量：由 <html class="dark"> 驱动（见 composables/useTheme.ts）
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import './styles/index.css'
import './styles/dark.css'
import { initTheme } from './composables/useTheme'

// 先落主题类名再挂载，避免应用界面出现一次浅色闪屏
initTheme()

const app = createApp(App)
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')
