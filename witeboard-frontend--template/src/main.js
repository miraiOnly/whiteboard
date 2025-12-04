import { createApp } from 'vue'
import './style.css'
// 1. 导入新的根组件 Main.vue
import Main from './Main.vue'
// 2. 导入路由实例（和之前一样）
import router from './router'

// 3. 创建应用，挂载 Main.vue（不再挂载 App.vue）
createApp(Main)
  .use(router)
  .mount('#app')