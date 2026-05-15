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
- 放弃 Tauri 桌面模式，统一走 web/云部署路径（Tauri 退场作为独立任务，不在本次范围）
- LLM 调用由后端发起，API Key 加密存储于 DB
- **Phase 1 仅支持单实例部署**（见"多实例限制"节）

---

## 架构

```
前端
  └─ POST /api/departments/{deptId}/ingest-tasks
       └─ DB: IngestTask status=queued
            └─ Channel<Guid>.Writer.TryWrite(taskId)

IngestWorkerService (IHostedService，单实例)
  ├─ 启动：running → queued（重置崩溃中任务）
  │         queued → Channel（恢复）
  └─ 循环：channel.Reader.ReadAllAsync()
       └─ IngestPipelineService.RunAsync(taskId)
            ├─ 读 LlmConfig（task.TriggeredBy 用户级 → 部门级 fallback）
            ├─ LlmClient.StreamChatAsync()（Step 1 分析）
            ├─ LlmClient.StreamChatAsync()（Step 2 生成）
            ├─ 解析 FILE blocks + 写文件（FileService）
            └─ IngestEventBroadcaster.Publish(deptId, event)
                 └─ 广播到该部门所有活跃 SSE 连接

SSE 接入流程：
  前端 POST /api/departments/{deptId}/events/token  → 获取短效 SSE token（TTL 60s）
  前端 EventSource(/api/departments/{deptId}/events?token=xxx)
       └─ 每条连接独立 Channel<IngestEvent>，订阅广播
```

---

## 多实例限制（Phase 1）

**Phase 1 仅支持单实例部署。** `IngestWorkerService` 使用 in-memory Channel，多实例启动时
各自扫 `queued` 任务并各自入队，会导致同一任务被重复执行。

Phase 2 如需水平扩展，改为 DB 级原子 claim：

```sql
-- 原子领取：只有第一个 UPDATE 成功的实例才执行该任务
UPDATE ingest_tasks
SET status = 'running', locked_by = @instanceId, started_at = NOW()
WHERE id = @taskId AND status = 'queued'
```

单实例部署在 Docker Compose 中通过 `replicas: 1` 或不使用 Swarm/K8s 水平扩展来保证。

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

**优先级查询（在 worker 中，无 HTTP 请求上下文）：**
1. `UserId = task.TriggeredBy AND IsActive = true` → 发起人的个人配置
2. `DepartmentId = task.DepartmentId AND IsActive = true` → 部门级兜底
3. 均无 → 任务失败，`ErrorMessage = "LLM not configured for this user or department"`

`task.TriggeredBy` 在 `IngestTask` 实体上已存在，worker 运行时直接使用，无需 HTTP 请求上下文。

**API Key 加密：** 使用 .NET 内置 `IDataProtector`，读写封装在 `LlmConfigService`。

> **部署要求：** 必须显式配置 Data Protection key ring 持久化，否则容器重建后无法解密
> DB 中已存储的 key。推荐方案：
> - **文件系统（Docker volume）：** `builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo("/data/keys"))`，并在 `docker-compose.yml` 中将 `/data/keys` 挂载为具名卷
> - **数据库（EF Core）：** 安装 `Microsoft.AspNetCore.DataProtection.EntityFrameworkCore`，改用 `PersistKeysToDbContext<AppDbContext>()`，key ring 随业务数据库一起备份
>
> 不可依赖默认行为（内存/临时目录），否则实例轮转后旧密文无法解开。

### 扩展：`IngestTask` 表

新增字段：

```csharp
public string? ProgressDetail { get; set; }  // 当前步骤，如 "Step 1/2: Analyzing..."
```

推 SSE 事件时同步写 DB，断线重连时作为初始快照返回。

---

## 核心组件

### IngestWorkerService

```csharp
// 启动时：先重置崩溃中的 running 任务，再恢复 queued
await db.IngestTasks
    .Where(t => t.Status == "running")
    .ExecuteUpdateAsync(s => s.SetProperty(t => t.Status, "queued"));

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
- `RunAsync` 开始前检查 DB status（幂等保护），非 `queued` 则跳过
- 串行执行；如需并发，在 Channel 上加 `SemaphoreSlim` 即可，不影响现有接口
- 维护内存字段 `LastCompletedAt`、`CurrentTaskId` 供健康检查使用

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
// 其他 event（message_start、content_block_start、ping）直接跳过
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
  1. 读 IngestTask，检查 status（非 queued 则跳过，幂等保护）
  2. 解析 LlmConfig（task.TriggeredBy 用户级 → 部门级）
  3. 读源文件内容（FileService）
  4. 读项目元文件（schema.md / purpose.md / index.md / overview.md）
  5. 检查 ingest cache（.llm-wiki/ingest-cache.json）
     → 命中则更新 DB status=done，跳过 LLM
  6. Step 1：StreamChatAsync → 收集 analysis
     → 更新 DB ProgressDetail = "Step 1/2: Analyzing..."
     → Publish SSE event（含 id 字段）
  7. Step 2：StreamChatAsync → 收集 generation
     → 更新 DB ProgressDetail = "Step 2/2: Generating..."
     → Publish SSE event（含 id 字段）
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

## SSE Endpoint 与鉴权

浏览器原生 `EventSource` 不支持自定义 `Authorization` 请求头，无法复用现有 JWT Bearer 鉴权。
采用**短效 SSE token**方案：

```
// Step 1：用已有 JWT 换 SSE token（TTL 60s，一次性）
POST /api/departments/{deptId}/events/token
Authorization: Bearer <jwt>
→ { "token": "sse-token-xxx", "expiresAt": "..." }

// Step 2：用 token 建立 SSE 连接
EventSource("/api/departments/{deptId}/events?token=sse-token-xxx")
```

SSE token 由服务端生成，存于内存（`ConcurrentDictionary<string, SseTokenInfo>`），过期或使用后立即作废。

**SSE 事件格式（含 id 字段）：**

```
id: 42
data: {"taskId":"...","step":"analyzing","detail":"Step 1/2: Analyzing...","timestamp":"..."}

id: 43
data: {"taskId":"...","step":"done","detail":"3 files written","timestamp":"..."}
```

**断线恢复：** `EventSource` 自动重连时携带 `Last-Event-ID: 42`。服务端在内存中保留最近
100 条事件（按 deptId），重连时将 `lastEventId` 之后的事件重放给客户端。若事件已超出保留
窗口，返回当前各任务的 `ProgressDetail` 快照作为兜底，前端不会白屏。

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

**移除（仅 ingest 执行路径，不涉及 Tauri 退场）：**
- `ingest-queue.ts` 中 `processNext` / `autoIngest` 的调用（执行路径）
- `ingest-queue.json` 的读写逻辑
- `pauseQueue` / `restoreQueue` 项目切换处理

**新增：**
- 调用 `POST .../events/token` 获取 SSE token，再建立 `EventSource` 连接
- 收到 SSE 事件后更新 `tasks-store`
- 用户级 LLM 配置页（填写 provider / endpoint / key / model）

**保留：**
- `IngestTask` 类型定义（对齐后端 response 结构）
- 任务列表 UI 和进度展示组件

> **Tauri 退场（删除 `tauri-fetch.ts`、`src-tauri/`、`fs.ts` Tauri 分支等）作为独立任务处理，**
> 不在本次迁移范围内。`tauri-fetch` 当前还被 `llm-client.ts`、`embedding.ts`、
> `web-search.ts` 等多处使用，范围超出 ingest，单独做更安全。

---

## 分阶段计划

### Phase 1（本次迁移 MVP，单实例）

- [ ] `LlmConfig` 表 + CRUD API + `IDataProtector` 加密（含 key ring 持久化配置）
- [ ] `LlmClient`（OpenAI-compat + Anthropic 两分支，含终止信号处理）
- [ ] `IngestPipelineService`（Step 1 + Step 2 + 写文件 + ingest cache）
- [ ] `IngestWorkerService`（Channel + 启动恢复：running→queued + queued→Channel）
- [ ] `IngestEventBroadcaster`（per-connection Channel 广播 + 最近 100 条事件缓存）
- [ ] SSE token 接口（`POST .../events/token`）+ SSE endpoint（带 `id:` 字段）
- [ ] 健康检查接口（`GET /api/health/ingest-worker`）+ Docker healthcheck
- [ ] 前端移除浏览器端执行路径，接入 SSE token 鉴权方案

### Phase 2（后续迭代）

- [ ] 多实例支持（DB 级原子 claim/lease）
- [ ] Gemini provider 支持
- [ ] 图片提取 + Caption（基于已有 `ExtractController`）
- [ ] 向量 embedding（基于已有 `VectorController`）
- [ ] Review block 解析写入 DB
- [ ] 语言检测过滤
- [ ] ingest cache 迁移到 DB（解除文件并发限制）

### 独立任务（不在本迁移范围）

- [ ] Tauri 退场（删除 `tauri-fetch.ts`、`src-tauri/`、`fs.ts` Tauri 分支等）
