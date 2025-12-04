import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // 关键：跨域配置（适配前后端分离）
  server: {
    port: 8080, // 前端运行端口（可修改，避免和后端冲突）
    proxy: {
      // 所有以 /api 开头的请求，都会代理到后端地址
      '/api': {
        target: 'http://localhost:3000', // 👉 必须替换为你的后端实际运行地址！
        changeOrigin: true, // 允许跨域
        //rewrite: (path) => path.replace(/^\/api/, '') // 去掉请求路径中的/api前缀（后端接口无/api时必需）
      }
    }
  }
})