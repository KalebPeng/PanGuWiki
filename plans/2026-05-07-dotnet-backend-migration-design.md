# 设计文档：Rust → .NET 后端迁移

**日期**：2026-05-07  
**状态**：已审核  
**方案**：A+C（抽象层 + 渐进迁移）

---

## 背景

LLM Wiki 当前为 Tauri 桌面应用，后端由 Rust 实现（6 个模块，21 个命令）。目标是将后端迁移到 .NET，保持 React 前端不变，并为后续云迁移做准备。

---

## 一、整体架构

### 过渡期（渐进迁移中）

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri 壳（WebView2）                                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  React 前端                                            │  │
│  │  业务组件 ──→ backend-client 抽象层（src/api/backend.ts）│  │
│  │                │                                       │  │
│  │                ├─ 已迁移 → fetch/WebSocket → .NET      │  │
│  │                └─ 未迁移 → invoke() → Tauri Rust       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         │                              │
   Tauri Rust 进程                .NET 进程（ASP.NET Core 8）
   （逐步缩减至清空）              ├─ REST Controllers
                                   ├─ WebSocket（claude 流式）
                                   ├─ Qdrant Client
                                   └─ 文件系统 / PDF 服务
                                            │
                                     Qdrant（本地进程）
```

### 目标架构（迁移完成后）

Tauri 壳保留（或换其他宿主），Rust 代码全部删除，React 前端所有调用走 .NET HTTP/WebSocket。云迁移时仅需修改 `appsettings.json` 中的 host 配置，前端零改动。

### 迁移阶段

| 阶段 | 内容 | 模块 |
|------|------|------|
| P0 | 搭建 .NET 项目骨架 + 前端抽象层 | — |
| P1 | 项目管理 + 代理 + 状态 | `project`, `proxy`, `clip_server_status` |
| P2 | 全部文件系统操作 | `fs`（12 个端点） |
| P3 | Claude CLI 子进程 + WebSocket 流 | `claude_cli` |
| P4 | PDF / Office 图片提取 | `extract_images` |
| P5 | 向量存储切换到 Qdrant | `vectorstore`（8 个端点） |
| P6 | 删除全部 Tauri Rust 代码 | `src-tauri/` |

---

## 二、.NET 项目结构

```
llm-wiki-server/
├── LlmWiki.sln
├── src/
│   └── LlmWiki.Api/
│       ├── Program.cs
│       ├── appsettings.json
│       ├── Controllers/
│       │   ├── ProjectController.cs
│       │   ├── FileController.cs
│       │   ├── VectorController.cs
│       │   ├── ClaudeController.cs
│       │   ├── ProxyController.cs
│       │   └── ExtractController.cs
│       ├── Hubs/
│       │   └── ClaudeHub.cs              # WebSocket，claude CLI 流式推送
│       ├── Services/
│       │   ├── FileService.cs
│       │   ├── ProjectService.cs
│       │   ├── VectorService.cs          # Qdrant 封装
│       │   ├── ClaudeCliService.cs       # claude 子进程管理
│       │   ├── ProxyService.cs
│       │   └── PdfExtractService.cs
│       └── Models/
│           ├── FileNode.cs
│           ├── WikiProject.cs
│           ├── VectorSearchResult.cs
│           └── ChunkUpsertInput.cs
└── tests/
    └── LlmWiki.Api.Tests/
        ├── VectorServiceTests.cs
        └── FileServiceTests.cs
```

### 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| Web 框架 | ASP.NET Core 8 Minimal API | 轻量，云迁移友好 |
| WebSocket | 原生 WebSocket 中间件 | 无 SignalR 协议开销，协议自定义灵活 |
| PDF 文本提取 | PdfPig（纯 .NET） | 无 native 依赖，跨平台 |
| Office 提取 | DocumentFormat.OpenXml + ClosedXML | 微软官方 SDK |
| 向量数据库 | Qdrant.Client（官方 .NET SDK） | gRPC 连接本地/云 Qdrant |
| JSON | System.Text.Json | 内置，性能好 |
| 进程管理 | System.Diagnostics.Process | claude CLI 子进程异步流读取 |

---

## 三、API 路由

```
# 项目
POST   /api/project/create
POST   /api/project/open

# 文件系统
GET    /api/file/read?path=
POST   /api/file/write
GET    /api/file/list?path=
POST   /api/file/copy
POST   /api/file/copy-directory
POST   /api/file/preprocess
DELETE /api/file?path=
GET    /api/file/exists?path=
GET    /api/file/base64?path=
POST   /api/file/find-related
POST   /api/file/create-directory

# 向量存储
POST   /api/vector/upsert
POST   /api/vector/search
DELETE /api/vector/{pageId}
GET    /api/vector/count
POST   /api/vector/chunks/upsert
POST   /api/vector/chunks/search
DELETE /api/vector/chunks/{pageId}
GET    /api/vector/chunks/count
GET    /api/vector/legacy/count        # 返回 0（兼容旧前端，无实际数据）
DELETE /api/vector/legacy              # no-op（兼容旧前端）

# Claude CLI
GET    /api/claude/detect
WebSocket /ws/claude                   # spawn + kill + 流式输出

# 其他
POST   /api/proxy/set
GET    /api/status/clip

# 图片提取
POST   /api/extract/pdf-images
POST   /api/extract/office-images
POST   /api/extract/pdf-images/save
POST   /api/extract/office-images/save
```

### CORS

本地运行允许 `tauri://localhost` 和 `https://tauri.localhost`。云部署改为实际域名，配置在 `appsettings.json`。

---

## 四、前端抽象层设计

文件路径：`src/api/backend.ts`

### 核心结构

```typescript
const DOTNET_BASE = 'http://localhost:5200'
const DOTNET_MODULES = new Set<string>() // 已迁移模块，按阶段逐步添加

// 统一调用入口，替代直接使用 Tauri invoke
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (DOTNET_MODULES.has(commandToModule(command))) {
    return httpInvoke<T>(command, args)
  }
  return tauriInvoke<T>(command, args)
}
```

### 渐进激活

每个阶段完成后激活对应模块：

```typescript
// P1 完成后
DOTNET_MODULES.add('project')
DOTNET_MODULES.add('proxy')

// P2 完成后
DOTNET_MODULES.add('fs')

// P3 完成后
DOTNET_MODULES.add('claude_cli')

// P5 完成后
DOTNET_MODULES.add('vector')
```

### WebSocket 流式协议

与现有 Tauri 事件格式保持兼容，前端处理逻辑不变：

```typescript
// 发送（前端 → .NET）
{ type: 'spawn', streamId: string, model: string, messages: ClaudeMessage[] }
{ type: 'kill',  streamId: string }

// 接收（.NET → 前端）
{ type: 'line', streamId: string, payload: string }   // 对应原 claude-cli:{id} 事件
{ type: 'done', streamId: string, code: number | null, stderr: string }  // 对应原 :done 事件
```

---

## 五、Qdrant 向量存储

### 数据组织

每个 Wiki 项目对应一个 Qdrant Collection，命名：`llmwiki_{project_path_hash}`。

- Qdrant 以本地进程运行，数据存储在 `~/.llm-wiki/qdrant/`
- 全局共享一个 Qdrant 实例，多项目使用不同 Collection 隔离

### Collection Schema

```
距离度量：Cosine（与现有评分公式 1/(1+distance) 兼容）
向量维度：动态（首次 upsert 时由 chunk embedding 长度决定）

Payload 字段：
  chunk_id     string
  page_id      string
  chunk_index  uint32
  chunk_text   string
  heading_path string
```

### 启动管理

.NET 后端启动时检测 Qdrant 是否运行，未运行则自动启动本地 Qdrant 进程（二进制随 .NET 后端分发）。若启动失败，向量功能降级返回空结果，不崩溃。

### 数据初始化

无需从 LanceDB 迁移历史数据。P5 完成后，用户通过 Settings 页面"重新索引"触发全量写入 Qdrant。原 `.llm-wiki/lancedb/` 目录保留但不再读取。

### 云迁移

仅需修改 `appsettings.json`：

```json
{
  "Qdrant": {
    "Host": "your-cloud-host",
    "Port": 6334,
    "ApiKey": "your-api-key",
    "UseTls": true
  }
}
```

`VectorService.cs` 代码零改动。

---

## 六、错误处理

- 所有 REST 端点返回统一结构：`{ "error": "message" }` on 4xx/5xx
- WebSocket 异常以 `{ type: "error", message: string }` 消息推送，不断连
- .NET 后端未启动时，抽象层自动降级走 Tauri invoke（过渡期保护）
- PDF/Office 提取失败返回占位文本，不中断流程（与 Rust 行为一致）
