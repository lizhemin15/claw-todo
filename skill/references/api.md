# Claw Todo API 文档

## Base URL

```
https://todo.yourdomain.com
```

## 认证

所有 API（除 `/api/auth/*`）需要 JWT Token，通过 `Authorization: Bearer <token>` 传递。

WebSocket 通过 `?token=<token>` 查询参数传递。

## 端点

### 认证

#### POST /api/auth/setup
首次创建管理员账号（只允许一次）。

**Request:**
```json
{
  "username": "admin",
  "password": "your-password"
}
```

**Response:**
```json
{
  "message": "setup completed",
  "token": "eyJ..."
}
```

#### POST /api/auth/login
登录获取 Token。

**Request:**
```json
{
  "username": "admin",
  "password": "your-password"
}
```

**Response:**
```json
{
  "token": "eyJ..."
}
```

#### GET /api/auth/status
检查是否已初始化。

**Response:**
```json
{
  "setup": true
}
```

#### POST /api/auth/token
生成绑定 Token（需要登录 Token）。

**Response:**
```json
{
  "token": "eyJ..."
}
```

### 待办事项

#### POST /api/todos
创建待办。

**Request:**
```json
{
  "title": "提交论文",
  "description": "根据审稿意见修改",
  "priority": "urgent",
  "due": "2026-05-30T18:00:00Z",
  "tags": ["论文", "IEEE"],
  "source": "hermes",
  "metadata": {}
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "title": "提交论文",
  "description": "根据审稿意见修改",
  "priority": "urgent",
  "status": "pending",
  "due": "2026-05-30T18:00:00Z",
  "tags": ["论文", "IEEE"],
  "source": "hermes",
  "metadata": {},
  "created_at": "2026-05-30T10:00:00Z",
  "updated_at": "2026-05-30T10:00:00Z",
  "completed_at": ""
}
```

#### GET /api/todos
获取待办列表。

**Query 参数:**
- `status` - 按状态过滤 (pending/completed/postponed)
- `priority` - 按优先级过滤 (urgent/high/normal/low)
- `source` - 按来源过滤

**Response:** 返回 Todo 数组。

#### GET /api/todos/{id}
获取单个待办。

#### PATCH /api/todos/{id}
更新待办。只需传要更新的字段。

**Request:**
```json
{
  "status": "completed"
}
```

当 `status` 设为 `completed` 时，会自动创建 sync_log 条目（双向同步）。

#### DELETE /api/todos/{id}
删除待办。

### 同步

#### GET /api/sync/pending
获取待同步的变更（前端标记完成等）。

**Response:**
```json
[
  {
    "id": "sync-uuid",
    "todo_id": "todo-uuid",
    "action": "complete",
    "direction": "pull",
    "timestamp": "2026-05-30T12:00:00Z",
    "status": "pending"
  }
]
```

#### POST /api/sync/ack
确认已同步。

**Request:**
```json
{
  "ids": ["sync-uuid-1", "sync-uuid-2"]
}
```

### WebSocket

#### WS /ws?token=<token>
实时推送。

**服务端消息:**
```json
{"type": "todo_created", "payload": {...}}
{"type": "todo_updated", "payload": {...}}
{"type": "todo_deleted", "payload": {"id": "..."}}
```

## 数据结构

### TodoItem
| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | UUID |
| title | string | 标题（必填） |
| description | string | 描述 |
| priority | string | urgent/high/normal/low |
| status | string | pending/completed/postponed |
| due | string | ISO 8601 截止时间 |
| tags | string[] | 标签 |
| source | string | 来源 |
| metadata | object | 扩展元数据 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |
| completed_at | string | 完成时间 |

### SyncEntry
| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | UUID |
| todo_id | string | 关联待办ID |
| action | string | create/update/complete/delete |
| direction | string | push/pull |
| timestamp | datetime | 时间戳 |
| status | string | synced/pending/failed |
