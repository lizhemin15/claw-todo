# Claw Todo API 文档

## Base URL

```
# 公网（浏览器访问）
https://todo.open-claw.click

# 本地（脚本/API调用，绕过 Cloudflare 拦截）
http://localhost:8090
```

## 认证

所有 API（除 `/api/auth/*` 和 `/api/pair/exchange`）需要 JWT Token，通过 `Authorization: Bearer <token>` 传递。

WebSocket 通过 `?token=<token>` 查询参数传递。

## 端点

### 认证

#### POST /api/auth/setup
首次创建管理员账号（只允许一次）。

#### POST /api/auth/login
登录获取 Token。

#### GET /api/auth/status
检查是否已初始化。

#### POST /api/auth/token
生成绑定 Token（需要登录 Token）。高级用途，推荐用配对码代替。

### 配对

#### POST /api/pair/code
生成 6 位配对码（需要登录 Token）。

**Headers:**
```
Authorization: Bearer <login-jwt-token>
```

**Response:**
```json
{
  "code": "384729",
  "expires_in": 300
}
```

- 配对码 5 分钟有效
- 每次生成新码会使旧码失效
- 同一用户同时只有一个有效配对码

#### POST /api/pair/exchange
用配对码换绑定 Token（**无需登录**）。

**Request:**
```json
{
  "code": "384729",
  "source": "hermes"
}
```

**Response:**
```json
{
  "token": "eyJ...",
  "username": "admin",
  "message": "pairing successful"
}
```

**错误码：**
- `404` — 配对码不存在
- `410` — 配对码已使用或已过期

### 待办事项

#### POST /api/todos
创建待办。支持登录 Token 和绑定 Token。

**Request:**
```json
{
  "title": "提交论文",
  "priority": "urgent",
  "due": "2026-05-30T18:00:00Z",
  "tags": ["论文"],
  "source": "hermes"
}
```

#### GET /api/todos
获取待办列表。支持 `status`/`priority`/`source` 查询参数。

#### GET /api/todos/{id}
获取单个待办。

#### PATCH /api/todos/{id}
更新待办。只需传要更新的字段。

#### DELETE /api/todos/{id}
删除待办。

### 同步

#### GET /api/sync/pending
获取待同步的变更。

#### POST /api/sync/ack
确认已同步。

### WebSocket

#### WS /ws?token=<token>
实时推送。

**消息类型:**
- `todo_created` / `todo_updated` / `todo_deleted`
