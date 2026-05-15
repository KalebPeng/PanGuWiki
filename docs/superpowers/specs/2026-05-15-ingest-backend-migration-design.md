# Ingest 后端迁移设计

**日期：** 2026-05-15  
**状态：** 待实现

## 背景与问题

当前 ingest 的核心计算（调 LLM、生成 wiki 页面）运行在用户浏览器中，导致三个问题：

1. **任务卡死**：用户 A 关闭 Tab，DB 中的 `IngestTask` 永远停留在 `running`
2. **无实时进度**：用户 B 只能看到用户 A 的浏览器已写入 DB 的部分状态
3. **中断无法恢复**：执行状态未持久化，只有结果状态持久化了

## 决策

- 将 ingest 执行权完整迁移到 .NET 后端
- 放弃 Tauri 桌面模式，统一走 web/云部署路径
- LLM 调用由后端发起，API Key 加密存储于 DB

---

## 架构

```
前端
  └─ POST /api/departments/{deptId}/ingest-tasks
       └─ DB: IngestTask status=queued
            └─ Channel<Guid>.Writer.TryWrite(taskId)

IngestWorkerService (IHostedService)
  ├─ 启动：DB 查所有 queued → 写 Channel（崩溃恢复）
  └─ 循环：channel.Reader.ReadAllAsync()
       └─ IngestPipelineService.RunAsync(taskId)
            ├─ 读 LlmConfig（用户级 → 部门级 fallback）
            ├─ LlmClient.StreamChatAsync()（Step 1 分析）
            ├─ LlmClient.StreamChatAsync()（Step 2 生成）
            ├─ 解析 FILE blocks + 写文件（FileService）
            └─ IngestEventBroadcaster.Publish(deptId, event)
                 └─ 广播到该部门所有活跃 SSE 连接

SSE endpoint: GET /api/departments/{deptId}/events
  └─ 每条连接独立 Channel<IngestEvent>，订阅广播
```

---

## 数据模型

### 新增：`LlmConfig` 表

```csharp
public class LlmConfig
{
    public Guid Id { get; set; }
    public Guid? UserId { get; set; }        // 非空 = 用户级配置
    public Guid? DepartmentId { get; set; }  // 非空 = 部门级配置
    public string Provider { get; set; }     // "openai" | "anthropic" | "ollama" | ...
    public string Endpoint { get; set; }     // base URL
    public string EncryptedApiKey { get; set; }  // IDataProtector.Protect()
    public string Model { get; set; }
    public bool IsActive { get; set; } = true;
}
```

**优先级查询：**
1. `UserId = currentUser.Id AND IsActive = true` → 用户自己的配置
2. `DepartmentId = task.DeptId AND IsActive = true` → 部门级兜底
3. 均无 → 任务失败，`ErrorMessage = "LLM not configured"`

**API Key 加密：** 使用 .NET 内置 `IDataProtector`，密钥自动管理，无需额外依赖。  
读写封装在 `LlmConfigService`，不散落到业务逻辑中。

### 扩展：`IngestTask` 表

新增一个字段：

```csharp
public string? ProgressDetail { get; set; }  // 当前步骤，如 "Step 1/2: Analyzing..."
```

写 SSE 事件时同步更新 DB，客户端断线重连时通过 `Last-Event-ID` 机制恢复最后状态，不会白屏。

---

## 核心组件

### IngestWorkerService

```csharp
// 启动时从 DB 恢复
var queued = await db.IngestTasks
    .Where(t => t.Status == "queued")
    .OrderBy(t => t.QueuedAt)
    .ToListAsync();
foreach (var t in queued)
    channel.Writer.TryWrite(t.Id);

// 主循环（串行）
await foreach (var taskId in channel.Reader.ReadAllAsync(ct))
    await pipeline.RunAsync(taskId, ct);
```

- Channel 使用 `Channel.CreateUnbounded<Guid>()`
- 写入幂等：`RunAsync` 开始前检查 DB status，非 `queued`/`running` 则跳过
- 串行执行，同一部门多任务排队；如需并发，在 Channel 上加 `SemaphoreSlim` 即可

### IngestEventBroadcaster

每条 SSE 连接独立一个 `Channel<IngestEvent>`，`Publish` 广播到同一部门所有活跃连接：

```csharp
// key: connectionId (Guid.NewGuid() per Subscribe call)
private readonly ConcurrentDictionary<Guid, (Guid DeptId, Channel<IngestEvent> Ch)> _connections = new();

public IAsyncEnumerable<IngestEvent> Subscribe(Guid deptId, CancellationToken ct)
{
    var connId = Guid.NewGuid();
    var channel = Channel.CreateUnbounded<IngestEvent>();
    _connections[connId] = (deptId, channel);
    ct.Register(() => {
        _connections.TryRemove(connId, out _);
        channel.Writer.TryComplete();
    });
    return channel.Reader.ReadAllAsync(ct);
}

public void Publish(Guid deptId, IngestEvent evt)
{
    foreach (var (_, (d, ch)) in _connections)
        if (d == deptId) ch.Writer.TryWrite(evt);
}
```

`TryRemove` 是原子操作，无竞争问题。

### LlmClient

ingest 调用关闭了 reasoning（`mode: off`），无图片输入，Phase 1 只需两个分支：

```csharp
private Task<HttpResponseMessage> SendRequest(LlmConfig config, ...) =>
    config.Provider switch {
        "anthropic" => SendAnthropic(...),
        _           => SendOpenAiCompat(...)  // 默认：OpenAI、DeepSeek、Ollama 等
    };
```

**SSE 终止信号处理：**

```csharp
// OpenAI-compat 分支
if (data == "[DONE]") yield break;

// Anthropic 分支 —— 终止在 event: 行而非 data: 行
// 需同时跟踪当前 event 类型；只有 content_block_delta 时才提取 delta.text
if (line.StartsWith("event:") && line.Contains("message_stop")) yield break;
```

Anthropic URL 构建需处理用户输入的各种形式（`/v1`、`/v1/messages`、裸 host 等），
参考前端的 `buildAnthropicUrl()` 逻辑。

**Phase 1 不支持的 provider：**`google`、`claude-code` CLI。任务遇到不支持的 provider 时直接
`failed` 并在 `ErrorMessage` 中提示。

### IngestPipelineService

对应前端 `ingest.ts` 的 Step 1 + Step 2：

```
RunAsync(taskId):
  1. 读 IngestTask，检查 status（幂等保护）
  2. 解析 LlmConfig（用户级 → 部门级）
  3. 读源文件内容（FileService）
  4. 读项目元文件（schema.md / purpose.md / index.md / overview.md）
  5. 检查 ingest cache（.llm-wiki/ingest-cache.json）
     → 命中则更新 DB status=done，跳过 LLM
  6. Step 1：StreamChatAsync → 收集 analysis
     → PATCH DB ProgressDetail = "Step 1/2: Analyzing..."
     → Publish SSE event
  7. Step 2：StreamChatAsync → 收集 generation
     → PATCH DB ProgressDetail = "Step 2/2: Generating..."
     → Publish SSE event
  8. ParseFileBlocks(generation)
     → 路径安全校验（必须 wiki/ 开头，无 .. 段）
  9. 写文件（FileService）
     → Publish SSE event { step: "writing", detail: "Writing N files..." }
 10. 更新 DB：status=done, wiki_pages_count, completed_at
 11. 写 ingest cache
```

> **已知限制：** ingest cache 当前为单文件 JSON（`.llm-wiki/ingest-cache.json`），串行执行下
> 安全。如后续改为并发执行，需迁移到 DB 存储或加文件锁。

---

## SSE Endpoint

```
GET /api/departments/{deptId}/events
Content-Type: text/event-stream

data: {"taskId":"...","step":"analyzing","detail":"Step 1/2: Analyzing...","timestamp":"..."}
data: {"taskId":"...","step":"generating","detail":"Step 2/2: Generating...","timestamp":"..."}
data: {"taskId":"...","step":"done","detail":"3 files written","timestamp":"..."}
```

- 客户端使用 `EventSource` 订阅，原生支持断线自动重连
- 重连时携带 `Last-Event-ID`，服务端可返回 `IngestTask.ProgressDetail` 作为初始状态

---

## 健康检查

```
GET /api/health/ingest-worker
```

响应示例：

```json
{
  "workerAlive": true,
  "channelBacklog": 3,
  "lastCompletedAt": "2026-05-15T10:23:00Z",
  "currentTaskId": "uuid-or-null"
}
```

- `workerAlive`：`IHostedService` 生命周期状态
- `channelBacklog`：`channel.Reader.Count`
- `lastCompletedAt` / `currentTaskId`：`IngestWorkerService` 内存字段，无需查 DB

Docker Compose 配置 `healthcheck` 打此接口，`workerAlive: false` 或非 200 触发容器重启。
单容器部署必须配置，否则 Worker 卡死无法自动恢复。

---

## 前端变更

**移除：**
- `ingest-queue.ts` 中 `processNext` / `autoIngest` 的调用（执行路径）
- `ingest-queue.json` 的读写逻辑
- `pauseQueue` / `restoreQueue` 项目切换处理
- `tauri-fetch.ts` Tauri 路径、`src-tauri/` 目录、`fs.ts` Tauri invoke 分支

**新增：**
- `EventSource` 订阅 `/api/departments/{deptId}/events`，收到事件更新 `tasks-store`
- 用户级 LLM 配置页（填写 provider / endpoint / key / model）

**保留：**
- `IngestTask` 类型定义（对齐后端 response 结构）
- 任务列表 UI 和进度展示组件

---

## 分阶段计划

### Phase 1（本次迁移 MVP）

- [ ] `LlmConfig` 表 + CRUD API + `IDataProtector` 加密
- [ ] `LlmClient`（OpenAI-compat + Anthropic 两分支，含终止信号处理）
- [ ] `IngestPipelineService`（Step 1 + Step 2 + 写文件 + ingest cache）
- [ ] `IngestWorkerService`（Channel + 启动恢复 + 健康状态字段）
- [ ] `IngestEventBroadcaster`（per-connection Channel 广播）
- [ ] SSE endpoint（`/api/departments/{deptId}/events`）
- [ ] 健康检查接口（`/api/health/ingest-worker`）+ Docker healthcheck
- [ ] 前端移除浏览器端执行路径，接入 SSE
- [ ] 删除 Tauri 相关代码

### Phase 2（后续迭代）

- [ ] Gemini provider 支持
- [ ] 图片提取 + Caption（基于已有 `ExtractController`）
- [ ] 向量 embedding（基于已有 `VectorController`）
- [ ] Review block 解析写入 DB
- [ ] 语言检测过滤
- [ ] ingest cache 迁移到 DB（解除文件并发限制）
