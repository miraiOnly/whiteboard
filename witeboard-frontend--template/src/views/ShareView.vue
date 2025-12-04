<template>
  <div class="share-container">
    <div class="toolbar">
      <h2 class="board-title">共享白板查看：{{ boardTitle }}</h2>
      <span class="status">
        {{ isConnected ? '✅ 实时同步中' : '🔄 连接中...' }}
      </span>
      
    </div>
    <div class="overlay" v-if="isLoading || errorMsg">
      <div class="overlay-content">
        <div v-if="isLoading">加载共享白板中...</div>
        <div class="error" v-if="errorMsg">{{ errorMsg }}</div>
      </div>
    </div>
    <div class="canvas-container" @mousedown.prevent @mouseup.prevent @click.prevent @dblclick.prevent @mousemove.prevent>
      <canvas id="share-canvas" width="1200" height="800"></canvas>
    </div>
  </div>
</template>

<script setup>
// 确保所有需要的API都被导入
import { ref, onMounted, nextTick, onUnmounted } from 'vue'
import * as fabric from 'fabric'
import { useRoute } from 'vue-router'

// 1. 所有状态变量（响应式定义）
const route = useRoute()
const shareId = route.params.shareId
const isLoading = ref(true)
const errorMsg = ref('')
const boardTitle = ref('未命名白板')
const isConnected = ref(false) // 实时同步状态
const canvas = ref(null) // 关键：ref包裹，确保响应式
let ws = null // WebSocket实例
let reconnectTimer = null // 自动重连定时器

// 2. WebSocket相关函数
// 创建WebSocket连接
const createWebSocket = () => {
  if (ws) ws.close() // 关闭现有连接，避免重复

  // 连接后端WebSocket服务
  ws = new WebSocket(`ws://${window.location.hostname}:3000`)

  // 连接成功
  ws.onopen = () => {
    console.log('WebSocket连接成功')
    isConnected.value = true
    // 绑定当前shareId到后端
    ws.send(JSON.stringify({ type: 'bind', shareId: shareId }))
  }

  // 接收后端推送的更新（核心自动刷新逻辑）
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      // 只处理更新类型的消息
      if (data.type === 'update' && data.content) {
        console.log('收到保存后的更新，准备刷新画布')
        
        // 校验画布实例是否就绪
        if (!canvas.value || !(canvas.value instanceof fabric.Canvas)) {
          console.log('画布未就绪，100ms后重试')
          setTimeout(() => ws.onmessage(event), 100)
          return
        }

        // 解析画布内容（兼容字符串/对象格式）
        const jsonData = typeof data.content === 'string' 
          ? JSON.parse(data.content) 
          : data.content

        // 加载最新内容到画布
        canvas.value.loadFromJSON(jsonData, async () => {
          // 保持只读状态：禁用所有操作
          canvas.value.forEachObject(obj => {
            obj.selectable = false
            obj.evented = false
            obj.lockMovementX = obj.lockMovementY = true
            obj.lockScalingX = obj.lockScalingY = true
            obj.lockRotation = true
          })

          // 强制渲染（解决"加载了但不显示"问题）
          canvas.value.renderAll()

          // 安全设置画布尺寸（添加延迟+兜底尺寸）
          await new Promise(resolve => setTimeout(resolve, 50))
          const canvasDom = document.getElementById('share-canvas')
          const width = canvasDom.offsetWidth || 1200 // 兜底尺寸，避免为0
          const height = canvasDom.offsetHeight || 800

          // 优先使用fabric内置方法，兼容降级方案
          if (canvas.value.setDimensions) {
            canvas.value.setDimensions({ width, height })
          } else {
            canvasDom.width = width
            canvasDom.height = height
          }

          // 最终渲染确认
          canvas.value.renderAll()
          console.log('画布自动刷新成功！')
        })

        // 同步更新白板标题
        if (data.title) {
          boardTitle.value = data.title
        }
      }
    } catch (err) {
      console.error('自动刷新失败：', err)
      alert('更新失败，请手动刷新一次～')
    }
  }

  // 连接关闭（自动重连）
  ws.onclose = () => {
    console.log('WebSocket断开，5秒后自动重连')
    isConnected.value = false
    reconnectTimer = setTimeout(createWebSocket, 5000)
  }

  // 连接错误
  ws.onerror = (err) => {
    console.error('WebSocket错误：', err)
    isConnected.value = false
  }
}

// 关闭WebSocket连接（页面卸载时调用）
const closeWebSocket = () => {
  if (ws) ws.close()
  if (reconnectTimer) clearTimeout(reconnectTimer)
}

// 3. 加载共享白板初始内容
const loadSharedContent = async (canvasDom) => {
  try {
    // 调用后端接口，通过shareId获取白板内容
    const res = await fetch(`/api/whiteboard/get-by-share?shareId=${shareId}`)
    const data = await res.json()

    // 接口错误处理
    if (!res.ok) throw new Error(data.error || '分享链接无效')
    if (!data.content) throw new Error('白板内容不存在')

    // 设置白板标题
    boardTitle.value = data.title || '未命名白板'

    // 解析画布内容（兼容字符串/对象格式）
    const jsonData = typeof data.content === 'string' 
      ? JSON.parse(data.content) 
      : data.content

    // 校验画布实例
    if (!canvas.value || !(canvas.value instanceof fabric.Canvas)) {
      throw new Error('画布初始化失败，无法加载内容')
    }

    // 加载内容到画布
    canvas.value.loadFromJSON(jsonData, async () => {
      // 禁用所有操作，保持只读
      canvas.value.forEachObject(obj => {
        obj.selectable = false
        obj.evented = false
        obj.lockMovementX = obj.lockMovementY = true
        obj.lockScalingX = obj.lockScalingY = true
        obj.lockRotation = true
      })

      // 强制渲染
      canvas.value.renderAll()

      // 安全设置尺寸（延迟+兜底）
      await new Promise(resolve => setTimeout(resolve, 50))
      const width = canvasDom.offsetWidth || 1200
      const height = canvasDom.offsetHeight || 800

      if (canvas.value.setDimensions) {
        canvas.value.setDimensions({ width, height })
      } else {
        canvasDom.width = width
        canvasDom.height = height
      }

      // 最终渲染+隐藏加载提示
      await new Promise(resolve => setTimeout(resolve, 50))
      canvas.value.renderAll()
      isLoading.value = false
    })
  } catch (err) {
    errorMsg.value = err.message
    isLoading.value = false
  }
}

// 4. 生命周期钩子
// 页面挂载时：初始化画布+连接WebSocket
onMounted(async () => {
  try {
    await nextTick() // 等待DOM完全加载
    const canvasDom = document.getElementById('share-canvas')
    if (!canvasDom) throw new Error('未找到画布元素')

    // 创建fabric画布实例（配置只读相关参数）
    canvas.value = new fabric.Canvas(canvasDom, {
      backgroundColor: '#ffffff',
      selection: false, // 禁用选择
      hasControls: false, // 禁用控制手柄
      hasBorders: false, // 禁用边框
      hoverCursor: 'default'
    })

    // 加载初始内容 + 建立WebSocket连接
    await loadSharedContent(canvasDom)
    createWebSocket()
  } catch (err) {
    errorMsg.value = err.message || '加载失败，请刷新页面'
    isLoading.value = false
  }
})

// 页面卸载时：关闭WebSocket，释放资源
onUnmounted(() => {
  closeWebSocket()
})
</script>

<style scoped>
.share-container {
  max-width: 1200px;
  margin: 30px auto;
  padding: 0 20px;
  font-family: "Microsoft Yahei", sans-serif;
  position: relative;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 15px;
  padding: 14px 20px;
  background-color: #f5f7fa;
  border-radius: 8px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
  position: relative;
}

.board-title {
  color: #333;
  font-size: 18px;
  margin: 0;
  text-align: center;
}

.status {
  position: absolute;
  left: 20px;
  font-size: 14px;
  color: #27ae60;
}

.back-btn {
  position: absolute;
  right: 20px;
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  background-color: #2c3e50;
  color: #ffffff;
  font-size: 14px;
  cursor: pointer;
}

.canvas-container {
  width: 100%;
  height: 800px;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid #e1e5eb;
  background-color: #ffffff;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08);
  pointer-events: none !important;
}

#share-canvas {
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none !important;
  user-select: none !important;
  touch-action: none !important;
  -webkit-user-drag: none !important;
}

.overlay {
  position: absolute;
  top: 100px;
  left: 20px;
  right: 20px;
  height: 800px;
  background-color: rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  z-index: 10;
}

.overlay-content {
  font-size: 18px;
  color: #666;
}

.overlay .error {
  color: #e74c3c;
}
</style>