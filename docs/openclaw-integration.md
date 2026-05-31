# OpenClaw 小龙虾集成指南

Claw Todo 支持**零脚本纯 HTTP** 连接，无需下载任何文件，完美符合小龙虾安全策略。

## 安全策略兼容

小龙虾禁止 `curl` 下载远程脚本执行。Claw Todo v4.0.0 零脚本模式专为这种场景设计：

- ✅ **无需下载脚本** — 全程 HTTP API 调用
- ✅ **无需执行外部代码** — 小龙虾用自身 HTTP 能力即可
- ✅ **配对码一键连接** — 6位数字，5分钟有效

## 连接流程

### Step 1: 用户生成配对码

用户在 Claw Todo 网页端操作：
1. 打开 https://todo.open-claw.click
2. 点击右上角 ⚙️ 设置
3. 点击「生成配对码」
4. 看到 6 位数字（如 `384729`），5 分钟内有效

### Step 2: 小龙虾用配对码换 Token

小龙虾调用 HTTP API（用自身 HTTP 能力，不下载脚本）：

```
POST https://todo.open-claw.click/api/pair/exchange
Content-Type: application/json

{
  "code": "384729",
  "source": "openclaw"
}
```

**成功响应：**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "username": "admin",
  "message": "pairing successful"
}
```

**错误响应：**
- `404` — 配对码不存在（用户还没生成）
- `410` — 配对码已使用或已过期（需重新生成）

### Step 3: 保存 Token

小龙虾保存三个配置项：
- `endpoint` = `https://todo.open-claw.click`
- `token` = 上一步返回的 JWT Token
- `source` = `openclaw`（区分来源）

## 推送待办

连接成功后，推送待办只需一个 HTTP POST：

```
POST https://todo.open-claw.click/api/todos
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "title": "提交论文修改稿",
  "priority": "urgent",
  "due": "2026-05-30T18:00:00Z",
  "tags": ["论文", "IEEE"],
  "source": "openclaw"
}
```

**字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✅ | 待办标题 |
| `priority` | string | ❌ | `urgent` / `high` / `normal` / `low`，默认 `normal` |
| `due` | string | ❌ | 截止时间，ISO 8601 格式 |
| `tags` | string[] | ❌ | 标签列表 |
| `description` | string | ❌ | 详细描述 |
| `source` | string | ❌ | 来源标识，建议固定为 `openclaw` |

**成功响应：**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "提交论文修改稿",
  "status": "pending",
  "priority": "urgent",
  "source": "openclaw",
  "created_at": "2026-05-31T01:30:00Z"
}
```

## 其他操作

### 获取待办列表

```
GET https://todo.open-claw.click/api/todos
Authorization: Bearer ***

# 按状态过滤
GET https://todo.open-claw.click/api/todos?status=pending
GET https://todo.open-claw.click/api/todos?status=in_progress
GET https://todo.open-claw.click/api/todos?status=completed
GET https://todo.open-claw.click/api/todos?status=postponed
```

**重要：** 不带 `status` 参数返回所有状态的待办。

### 标记完成

```
PATCH https://todo.open-claw.click/api/todos/{id}
Content-Type: application/json
Authorization: Bearer ***

{"status": "completed"}
```

### 删除待办

```
DELETE https://todo.open-claw.click/api/todos/{id}
Authorization: Bearer ***
```

## 四种待办状态

| 状态 | 说明 | Kanban 列 |
|------|------|-----------|
| `pending` | 待办 | 第一列 |
| `in_progress` | 进行中 | 第二列 |
| `completed` | 已完成 | 第三列 |
| `postponed` | 推迟 | 第四列 |

## 小龙虾配置示例

在小龙虾的配置中添加：

```yaml
integrations:
  claw_todo:
    endpoint: "https://todo.open-claw.click"
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    source: "openclaw"
```

或通过环境变量：

```bash
CLAW_TODO_ENDPOINT=https://todo.open-claw.click
CLAW_TODO_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
CLAW_TODO_SOURCE=openclaw
```

## 常见问题

### Q: 配对码过期了怎么办？

A: 让用户重新在设置页生成配对码，5 分钟内使用。

### Q: Token 会过期吗？

A: 绑定 Token 长期有效，不会自动过期。如果失效，重新配对即可。

### Q: 多个小龙虾实例怎么办？

A: 每个实例用不同的 `source` 标识（如 `openclaw-bot1`、`openclaw-bot2`），分别配对获取 Token。

### Q: Cloudflare 拦截怎么办？

A: 小龙虾用自身 HTTP 客户端调用，通常不会被拦截。如果遇到 403，检查 User-Agent 是否被 Cloudflare Bot Fight Mode 误判。

### Q: 如何区分小龙虾推送的待办？

A: 待办卡片上会显示来源标签 `📎 openclaw`，用户一眼就能看出是哪个智能体推送的。

## 完整 API 文档

详见 [API 文档](../server/skill/references/api.md) 或在线访问：

```
GET https://todo.open-claw.click/.well-known/skills/todo-push/references/api.md
```
