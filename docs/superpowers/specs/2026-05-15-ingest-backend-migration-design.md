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
       ├─ DB: IngestTask status=queued
       └─ channel.Writer.TryWrite(Signal)  ← 唤醒 worker

IngestWorkerService (IHostedService，单实例)
  ├─ 启动：running → queued（重置崩溃中任务）
  │         TryWrite(Signal)（唤醒一次）
  └─ 循环：channel.Reader.ReadAsync()  ← 收到信号即查 DB
       └─ 从 DB 取下一个 queued 任务
            └─ IngestPipelineService.RunAsync(task)
                 ├─ 读 LlmConfig（task.TriggeredBy 用户级 → 部门级 fallback）
                 ├─ LlmClient.StreamChatAsync()（Step 1 分析）
                 ├─ LlmClient.StreamChatAsync()（Step 2 生成）
                 ├─ 覆盖写文件（FileService）
                 └─ IngestEventBroadcaster.Publish(deptId, event)

SSE 接入流程：
  前端 POST /api/departments/{deptId}/events/token（附 JWT）
       → 返回 SseToken（TTL 内持续有效，可重连复用）
  前端 EventSource(/api/departments/{deptId}/events?token=xxx)
       └─ 每条连接独立 Channel<IngestEvent>，订阅广播
```

---

## 多实例限制（Phase 1）

**Phase 1 仅支持单实例部署。** `IngestWorkerService` 使用 in-memory Channel，多实例启动时
各自扫 `queued` 任务并各自入队，会导致同一任务被重复执行。

Phase 2 如需水平扩展，改为 DB 级原子 claim：

```sql
UPDATE ingest_tasks
SET status = 'running', locked_by = @instanceId, started_at = NOW()
WHERE id = @taskId AND status = 'queued'
```

只有 UPDATE 成功（affected rows = 1）的实例才执行该任务。

单实例部署在 Docker Compose 中通过 `replicas: 1` 或不使用 Swarm/K8s 水平扩展来保证。

---

## 数据模型

### 新增：`LlmConfig` 表

```csharp
public class LlmConfig
{
    public Guid Id { get; set; }
    public Guid? UserId { get; set; }           // 非空 = 用户级配置
    public Guid? DepartmentId { get; set; }     // 非空 = 部门级配置
    public string Provider { get; set; }        // "openai" | "anthropic" | "ollama" | ...
    public string Endpoint { get; set; }        // base URL
    public string EncryptedApiKey { get; set; } // IDataProtector.Protect()
    public string Model { get; set; }
    public string? ApiMode { get; set; }        // e.g. "openai-compat" | "anthropic-native"
    public int MaxContextSize { get; set; } = 32000  // 影响截断策略
    public bool IsActive { get; set; } = true;
}
```

**DB 约束：**

```sql
-- 必须恰好有一个非空（不能同时为空，不能同时有值）
ALTER TABLE llm_configs
  ADD CONSTRAINT chk_scope CHECK (num_nonnulls(user_id, department_id) = 1);

-- 每个用户最多一个 active 配置
CREATE UNIQUE INDEX uq_llm_config_user_active
  ON llm_configs (user_id) WHERE user_id IS NOT NULL AND is_active = true;

-- 每个部门最多一个 active 配置
CREATE UNIQUE INDEX uq_llm_config_dept_active
  ON llm_configs (department_id) WHERE department_id IS NOT NULL AND is_active = true;
```

创建新配置前，API 层先将该 scope 下现有 active 配置置为 `IsActive = false`，再插入新记录。

**优先级查询（worker 无 HTTP 请求上下文，使用 `task.TriggeredBy`）：**
1. `UserId = task.TriggeredBy AND IsActive = true` → 发起人的个人配置
2. `DepartmentId = task.DepartmentId AND IsActive = true` → 部门级兜底
3. 均无 → 任务失败，`ErrorMessage = "LLM not configured for this user or department"`

**API Key 加密：** 使用 .NET 内置 `IDataProtector`，读写封装在 `LlmConfigService`。

> **部署要求：** 必须显式配置 Data Protection key ring 持久化，否则容器重建后无法解密
> DB 中已存储的密文。推荐方案（二选一）：
>
> - **文件系统（Docker volume）：**
>   ```csharp
>   builder.Services.AddDataProtection()
>       .PersistKeysToFileSystem(new DirectoryInfo("/data/keys"));
>   ```
>   在 `docker-compose.yml` 中将 `/data/keys` 挂载为具名卷。
>
> - **数据库（EF Core）：**
>   安装 `Microsoft.AspNetCore.DataProtection.EntityFrameworkCore`，改用
>   `PersistKeysToDbContext<AppDbContext>()`，key ring 随业务数据库一起备份。
>
> 不可依赖默认行为（内存/临时目录），否则实例轮转后旧密文无法解开。

### 扩展：`IngestTask` 表

新增字段：

```csharp
public string? ProgressDetail { get; set; }  // 当前步骤，如 "Step 1/2: Analyzing..."
```

推 SSE 事件时同步写 DB，断线重连时作为降级快照返回。

---

## 核心组件

### IngestWorkerService

**Channel 设计：** Channel 只作为"有新任务"的唤醒信号，不存 task ID。
使用 `Channel.CreateBounded<byte>(1)`，`DropWrite` 模式——已有待处理信号时重复写入直接丢弃，
不阻塞调用方，也不积压内存。实际任务从 DB 查取，天然有背压。

```csharp
// 类型：Channel<byte>，capacity: 1，DropWrite
// 写信号（幂等，不阻塞）
channel.Writer.TryWrite(0);

// 启动时：先重置崩溃中任务，再唤醒 worker
await db.IngestTasks
    .Where(t => t.Status == "running")
    .ExecuteUpdateAsync(s => s.SetProperty(t => t.Status, "queued"));
channel.Writer.TryWrite(0);  // 有 queued 任务就会被 worker 捡起

// 主循环
await foreach (var _ in channel.Reader.ReadAllAsync(ct))
{
    IngestTask? task;
    // 持续取任务直到队列清空
    while ((task = await db.IngestTasks
                .Where(t => t.Status == "queued")
                .OrderBy(t => t.QueuedAt)
                .FirstOrDefaultAsync(ct)) is not null)
    {
        await pipeline.RunAsync(task, ct);
    }
}
```

- 维护内存字段 `LastCompletedAt`、`CurrentTaskId` 供健康检查使用

### 重跑幂等策略

任务从 `running` 重置回 `queued` 后重跑时可能存在部分写入。处理规则：

- **wiki 页面文件（`wiki/concepts/*.md` 等）：** 覆盖写，LLM 重新生成并覆盖之前的部分结果，无重复风险
- **`wiki/log.md`：** 按来源文件名去重——写入前检查是否已有同名 source 的 log 条目，有则替换，无则追加；不允许同一 source 出现多条 log 记录
- **`wiki/index.md` / `wiki/overview.md`：** 通过 `mergePageContent` 合并，逻辑与前端一致，重复来源条目会被更新而非追加
- **ingest cache：** 仅在 `status=done` 写入 DB 之后才写 cache；重跑时 cache 必然未命中（任务未完成），全流程重新执行
- **结论：** 重跑是安全的，最终结果与首次成功执行一致

### IngestEventBroadcaster

每条 SSE 连接独立一个 `Channel<IngestEvent>`，`Publish` 广播到同一部门所有活跃连接。
同时在内存中按 `deptId` 保留最近 100 条事件，用于短断线重连的事件回放：

```csharp
// key: connectionId (Guid.NewGuid() per Subscribe call)
private readonly ConcurrentDictionary<Guid, (Guid DeptId, Channel<IngestEvent> Ch)> _connections = new();
// key: deptId, value: 最近 100 条事件（循环缓冲）
private readonly ConcurrentDictionary<Guid, Queue<IngestEvent>> _recentEvents = new();

public IAsyncEnumerable<IngestEvent> Subscribe(Guid deptId, long lastEventId, CancellationToken ct)
{
    var connId = Guid.NewGuid();
    var channel = Channel.CreateUnbounded<IngestEvent>();

    // 重连时回放错过的事件
    if (_recentEvents.TryGetValue(deptId, out var recent))
        foreach (var evt in recent.Where(e => e.Id > lastEventId))
            channel.Writer.TryWrite(evt);

    _connections[connId] = (deptId, channel);
    ct.Register(() => {
        _connections.TryRemove(connId, out _);
        channel.Writer.TryComplete();
    });
    return channel.Reader.ReadAllAsync(ct);
}

public void Publish(Guid deptId, IngestEvent evt)
{
    // 更新近期事件缓冲
    var buf = _recentEvents.GetOrAdd(deptId, _ => new Queue<IngestEvent>());
    lock (buf) { buf.Enqueue(evt); if (buf.Count > 100) buf.Dequeue(); }

    foreach (var (_, (d, ch)) in _connections)
        if (d == deptId) ch.Writer.TryWrite(evt);
}
```

> **事件缓存语义：** 内存级，服务重启后清空。重连时若 `lastEventId` 在缓冲窗口内则回放；
> 超出窗口或服务重启后，降级为返回各任务 `ProgressDetail` DB 快照，保证不白屏，但不保证
> 完整事件重放。这不是 event sourcing，是尽力而为的短窗口回放。

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

`MaxContextSize` 用于截断源文件内容：超出限制时截断到 `MaxContextSize - system_prompt_estimate`
字符，与前端 `ingest.ts` 的 `50000` 硬编码逻辑对齐，但改为从 `LlmConfig` 读取。

**Phase 1 不支持的 provider：**`google`、`claude-code` CLI。任务遇到不支持的 provider 时直接
`failed` 并在 `ErrorMessage` 中提示。

### IngestPipelineService

对应前端 `ingest.ts` 的 Step 1 + Step 2：

```
RunAsync(task):
  1. 将 task.Status 置为 running，原子更新（幂等保护）
  2. 解析 LlmConfig（task.TriggeredBy 用户级 → 部门级）
  3. 读源文件内容（FileService）
  4. 读项目元文件（schema.md / purpose.md / index.md / overview.md）
  5. 检查 ingest cache → 命中则 status=done，跳过 LLM
  6. Step 1：StreamChatAsync → 收集 analysis
     → 更新 DB ProgressDetail = "Step 1/2: Analyzing..."
     → Publish SSE event（含递增 id）
  7. Step 2：StreamChatAsync → 收集 generation
     → 更新 DB ProgressDetail = "Step 2/2: Generating..."
     → Publish SSE event
  8. ParseFileBlocks(generation)
     → 路径安全校验（必须 wiki/ 开头，无 .. 段）
  9. 覆盖写文件（FileService）；log.md 按来源去重；index.md/overview.md merge
     → Publish SSE event { step: "writing", detail: "Writing N files..." }
 10. 更新 DB：status=done, wiki_pages_count, completed_at（先于 cache 写入）
 11. 写 ingest cache
```

> **已知限制：** ingest cache 当前为单文件 JSON（`.llm-wiki/ingest-cache.json`），串行执行下
> 安全。如后续改为并发执行，需迁移到 DB 存储或加文件锁。

---

## SSE Endpoint 与鉴权

浏览器原生 `EventSource` 不支持 `Authorization` 请求头，采用**短效 SSE token**方案：

```
// Step 1：用已有 JWT 换 SSE token
POST /api/departments/{deptId}/events/token
Authorization: Bearer <jwt>
→ { "token": "sse-token-xxx", "expiresAt": "..." }

// Step 2：建立 SSE 连接（token TTL 内持续有效，支持自动重连复用）
EventSource("/api/departments/{deptId}/events?token=sse-token-xxx&lastEventId=42")
```

**Token 语义：**
- TTL 内持续有效（不是一次性），允许 `EventSource` 自动重连复用同一 token
- 绑定到 `(userId, deptId)` 对，不可跨用户或跨部门使用
- 显式登出时服务端撤销；TTL 到期自动失效
- Token 存于内存 `ConcurrentDictionary`，重启后失效，前端需重新换取

**SSE 事件格式（含 `id:` 字段）：**

```
id: 42
data: {"taskId":"...","step":"analyzing","detail":"Step 1/2: Analyzing...","timestamp":"..."}

id: 43
data: {"taskId":"...","step":"done","detail":"3 files written","timestamp":"..."}
```

**断线恢复：**
- `EventSource` 自动重连时，浏览器携带 `Last-Event-ID: 42` 请求头
- 服务端从 `IngestEventBroadcaster` 的近期事件缓冲中回放 id > 42 的事件
- 若缓冲已清空（服务重启），降级返回各任务 `ProgressDetail` DB 快照，不保证完整重放

---

## 健康检查

```
GET /api/health/ingest-worker
```

响应示例：

```json
{
  "workerAlive": true,
  "channelBacklog": 0,
  "lastCompletedAt": "2026-05-15T10:23:00Z",
  "currentTaskId": "uuid-or-null"
}
```

注：Channel 改为信号模式（capacity: 1）后，`channelBacklog` 值为 0 或 1，实际积压量
通过 `SELECT COUNT(*) FROM ingest_tasks WHERE status='queued'` 反映更准确，可按需补充此字段。

Docker Compose 配置 `healthcheck` 打此接口，`workerAlive: false` 或非 200 触发容器重启。

---

## 前端变更

**移除（仅 ingest 执行路径，不涉及 Tauri 退场）：**
- `ingest-queue.ts` 中 `processNext` / `autoIngest` 的调用（执行路径）
- `ingest-queue.json` 的读写逻辑
- `pauseQueue` / `restoreQueue` 项目切换处理

**新增：**
- 调用 `POST .../events/token` 获取 SSE token，再建立 `EventSource` 连接
- `EventSource.onerror` 时重新换 token 并携带 `lastEventId` 查询参数重连
- 收到 SSE 事件后更新 `tasks-store`
- 用户级 LLM 配置页（填写 provider / endpoint / key / model / maxContextSize）

**保留：**
- `IngestTask` 类型定义（对齐后端 response 结构）
- 任务列表 UI 和进度展示组件

> **Tauri 退场**（删除 `tauri-fetch.ts`、`src-tauri/`、`fs.ts` Tauri 分支等）作为独立任务处理，
> 不在本次迁移范围内。`tauri-fetch` 当前还被 `llm-client.ts`、`embedding.ts`、
> `web-search.ts` 等多处使用，范围超出 ingest，单独做更安全。

---

## 分阶段计划

### Phase 1（本次迁移 MVP，单实例）

- [ ] `LlmConfig` 表（含 DB 约束）+ CRUD API + `IDataProtector` 加密（含 key ring 持久化配置）
- [ ] `LlmClient`（OpenAI-compat + Anthropic 两分支，含终止信号处理，`MaxContextSize` 截断）
- [ ] `IngestPipelineService`（Step 1 + Step 2 + 写文件 + 幂等重跑策略 + ingest cache）
- [ ] `IngestWorkerService`（信号模式 Channel + 启动恢复：running→queued + 触发信号）
- [ ] `IngestEventBroadcaster`（per-connection Channel + 近期事件缓冲回放）
- [ ] SSE token 接口（`POST .../events/token`，TTL 内持续有效）+ SSE endpoint（带 `id:` 字段）
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
