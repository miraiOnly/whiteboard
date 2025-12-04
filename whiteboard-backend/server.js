// 依赖：express、cors、uuid（执行 npm install express cors uuid 安装）
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs'); // 数据持久化（文件存储，本地运行也需要）
const WebSocket = require('ws'); // 新增：WebSocket依赖
const app = express();
const port = 3000;

// ===================== 跨域配置（仅本地访问，无公网地址）=====================
app.use(cors({
  origin: ['http://localhost:5173','http://localhost:8080', 'http://localhost:3000'], // 只允许本地前端访问
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

// ===================== 基础配置 =====================
app.use(express.json({ limit: '20mb' })); // 解析JSON请求体
app.use(express.static(path.join(__dirname, 'dist'))); // 托管前端静态资源（本地打包后可用）

// ===================== 数据持久化（文件存储，本地运行数据不丢失）=====================
const DATA_FILE = path.join(__dirname, 'whiteboards.json');

// 初始化数据
const initData = () => {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(data) || [];
    } else {
      fs.writeFileSync(DATA_FILE, '[]', 'utf8');
      return [];
    }
  } catch (err) {
    console.error('初始化数据失败：', err);
    return [];
  }
};

// 保存数据到文件
const saveDataToFile = (data) => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('保存数据失败：', err);
  }
};

let whiteboards = initData(); // 加载数据

// ===================== 核心API路由（本地访问用）=====================
// 1. 获取所有白板列表
app.get('/api/whiteboards', (req, res) => {
  try {
    const boardList = whiteboards.map(board => ({
      boardId: board.boardId,
      title: board.title,
      createdAt: board.createdAt
    }));
    res.json(boardList);
  } catch (err) {
    res.json({ error: '获取列表失败' });
  }
});

// 2. 创建新白板
app.post('/api/whiteboard/new', (req, res) => {
  try {
    const newBoardId = uuidv4().replace(/-/g, '');
    const newBoard = {
      boardId: newBoardId,
      title: '未命名白板',
      content: {},
      createdAt: new Date().toLocaleString()
    };
    whiteboards.push(newBoard);
    saveDataToFile(whiteboards);
    res.json({ success: true, boardId: newBoardId });
  } catch (err) {
    res.json({ error: '创建失败' });
  }
});

// 3. 加载指定白板
app.get('/api/whiteboard', (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return res.json({ error: '缺少boardId' });
    
    const board = whiteboards.find(item => item.boardId === id);
    if (board) res.json(board);
    else res.json({ error: '白板不存在' });
  } catch (err) {
    res.json({ error: '加载失败' });
  }
});

// 4. 保存白板（修改：保存成功后推送更新）
app.post('/api/whiteboard/save', (req, res) => {
  try {
    const { boardId, title, content } = req.body;
    if (!boardId || !title || !content) {
      return res.json({ error: '缺少参数' });
    }
    
    const index = whiteboards.findIndex(item => item.boardId === boardId);
    if (index !== -1) {
      whiteboards[index].title = title;
      whiteboards[index].content = content;
      saveDataToFile(whiteboards);
      
      // 👇 新增：如果这个白板已经被分享（有shareId），推送最新内容给观众
      const shareId = whiteboards[index].shareId;
      if (shareId) {
        broadcastToShare(shareId, {
          type: 'update', // 告诉前端：这是内容更新消息
          content: content, // 最新的画布内容
          title: title     // 最新的白板标题（如果改了标题）
        });
        console.log(`已向分享链接${shareId}推送最新内容`);
      }
      
      res.json({ success: true });
    } else {
      res.json({ error: '白板不存在' });
    }
  } catch (err) {
    res.json({ error: '保存失败' });
  }
});

// 5. 删除白板
app.delete('/api/whiteboard/:boardId', (req, res) => {
  try {
    const { boardId } = req.params;
    const originalLength = whiteboards.length;
    whiteboards = whiteboards.filter(item => item.boardId !== boardId);
    
    if (whiteboards.length !== originalLength) {
      saveDataToFile(whiteboards);
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ error: '删除失败' });
  }
});

// 6. 生成分享链接（新增接口）
app.get('/api/whiteboard/generate-share', (req, res) => {
  try {
    const { boardId } = req.query;
    if (!boardId) return res.json({ error: '缺少boardId参数' });
    
    const boardIndex = whiteboards.findIndex(item => item.boardId === boardId);
    if (boardIndex === -1) return res.json({ error: '白板不存在' });
    
    const shareId = uuidv4().replace(/-/g, '');
    whiteboards[boardIndex].shareId = shareId;
    saveDataToFile(whiteboards);
    
    res.json({ shareId });
  } catch (err) {
    console.error('生成分享链接失败：', err);
    res.json({ error: '生成分享链接失败' });
  }
});

// 7. 通过shareId获取白板内容（修改后）
app.get('/api/whiteboard/get-by-share', (req, res) => {
  try {
    const { shareId } = req.query;
    if (!shareId) return res.json({ error: '缺少shareId参数' });
    
    const board = whiteboards.find(item => item.shareId === shareId);
    if (!board) return res.json({ error: '分享链接无效或已过期' });
    
    // 新增返回title字段（原存档名字）
    res.json({ 
      title: board.title, // 原存档的名字
      content: board.content 
    });
  } catch (err) {
    console.error('加载共享白板失败：', err);
    res.json({ error: '加载共享白板失败' });
  }
});

// ===================== SPA路由适配（本地刷新不404）=====================
app.get('*', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  } catch (err) {
    res.status(404).send('页面未找到');
  }
});

// ===================== 启动服务 =====================
// 👇 修改：创建HTTP服务器（让Express和WebSocket共用3000端口）
const server = app.listen(port, () => {
  console.log(`后端运行在 http://localhost:${port}`);
  console.log(`API测试：http://localhost:${port}/api/whiteboards`);
  console.log(`WebSocket服务启动：ws://localhost:${port}`); // 新增：显示WebSocket地址
});

// 👇 新增：创建WebSocket服务器（复制这部分到server变量后面）
const wss = new WebSocket.Server({ server });

// 👇 新增：维护连接映射（记录哪个分享链接有哪些用户在看）
const shareConnections = new Map();

// 👇 新增：监听WebSocket连接（用户打开分享页面时触发）
wss.on('connection', (ws) => {
  console.log('新的WebSocket连接');
  let currentShareId = null; // 记录当前用户在看哪个分享链接

  // 👇 新增：接收前端发送的消息（用户告知后端“我在看哪个分享链接”）
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      // 前端说“绑定shareId=xxx”，就把这个用户的连接和shareId关联起来
      if (data.type === 'bind' && data.shareId) {
        currentShareId = data.shareId;
        if (!shareConnections.has(currentShareId)) {
          shareConnections.set(currentShareId, new Set());
        }
        shareConnections.get(currentShareId).add(ws);
        console.log(`用户开始看分享链接：${currentShareId}（当前${shareConnections.get(currentShareId).size}人在看）`);
      }
    } catch (err) {
      console.error('WebSocket消息解析失败：', err);
    }
  });

  // 👇 新增：用户关闭分享页面时，移除连接（节省内存）
  ws.on('close', () => {
    console.log('用户关闭了分享页面');
    if (currentShareId && shareConnections.has(currentShareId)) {
      const connections = shareConnections.get(currentShareId);
      connections.delete(ws);
      if (connections.size === 0) {
        shareConnections.delete(currentShareId);
      }
      console.log(`分享链接${currentShareId}：剩余${connections.size}人在看`);
    }
  });

  // 👇 新增：处理WebSocket错误
  ws.on('error', (err) => {
    console.error('WebSocket错误：', err);
  });
});

// 👇 新增：工具函数（向所有看同一个分享链接的用户推送最新内容）
const broadcastToShare = (shareId, message) => {
  if (!shareConnections.has(shareId)) return;
  const connections = shareConnections.get(shareId);
  // 给每个在看这个分享链接的用户发消息
  connections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
};