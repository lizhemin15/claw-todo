---
name: todo-push
description: 推送待办事项到 Claw Todo 看板。配对码一键连接，无需下载脚本。
version: 4.0.0
tags: [todo, push, claw-todo, productivity]
config:
  endpoint:
    required: true
    description: "Claw Todo 地址，如 http://localhost:8090"
  token:
    required: true
    description: "绑定 Token（配对后自动获取）"
  source:
    default: "hermes"
    description: "来源标识，区分不同智能体"
files:
  - SKILL.md
  - scripts/push_todo.py
  - references/api.md
---

# Claw Todo Skill

推送待办到 Claw Todo 看板。**配对码一键连接，无需下载任何脚本。**

## 快速开始

对智能体说：**"连接 Claw Todo"**

智能体会问你要配对码 → 你打开 Claw Todo 设置页 → 点击"生成配对码" → 告诉智能体 6 位数字 → 自动完成连接。

## 配对流程（零脚本，纯 HTTP）

**不需要下载任何文件！** 智能体用自身 HTTP 能力即可完成：

### Step 1: 用户生成配对码
用户在 Claw Todo 网页 → ⚙️ 设置 → 点击"生成配对码" → 看到 6 位数字（5分钟有效）

### Step 2: 智能体用配对码换 Token
```
POST {endpoint}/api/pair/exchange
Content-Type: application/json

{"code": "123456", "source": "my-agent"}
```
返回：
```json
{"token": "eyJhbG...", "username": "admin"}
```

### Step 3: 保存 Token，后续推送使用
把 `endpoint`、`token`、`source` 记住，推送待办时带上 Token。

## 推送待办（纯 HTTP）

```
POST {endpoint}/api/todos
Content-Type: application/json
Authorization: Bearer {token}

{
  "title": "提交论文修改稿",
  "priority": "urgent",
  "due": "2026-05-30T18:00:00",
  "tags": ["论文"],
  "source": "my-agent"
}
```

**参数：**
- `title` (string, 必填): 待办标题
- `priority` (string): `urgent` | `high` | `normal` | `low`，默认 `normal`
- `due` (string): 截止时间，ISO 8601 格式
- `tags` (string[]): 标签列表
- `description` (string): 详细描述
- `metadata` (object): 扩展元数据
- `source` (string): 来源标识，区分不同智能体

## 其他操作

### 标记完成
```
PATCH {endpoint}/api/todos/{id}
Authorization: Bearer {token}
Content-Type: application/json

{"status": "completed"}
```

### 获取待办列表
```
GET {endpoint}/api/todos?status=pending
Authorization: Bearer {token}
```

### 删除待办
```
DELETE {endpoint}/api/todos/{id}
Authorization: Bearer {token}
```

## 安装

### Hermes 智能体
```bash
hermes skills install "well-known:https://todo.open-claw.click/.well-known/skills/todo-push" -y --force
```

### 任意智能体（零下载）
不需要安装任何脚本！只需：
1. 把本 SKILL.md 的内容告诉智能体（或指向 Well-Known 端点）
2. 智能体按上面的 HTTP 接口直接调用
3. 配对码换 Token → 推送待办，全程零下载

### 有 Python 环境的智能体（可选脚本）
```bash
# 下载推送脚本（可选，提供离线队列等高级功能）
curl -sL https://todo.open-claw.click/.well-known/skills/todo-push/scripts/push_todo.py -o push_todo.py
python3 push_todo.py push "买牛奶" normal
```

## Pitfalls

- **Cloudflare Tunnel 拦截脚本请求** — 必须用 `http://localhost:<port>` 而非公网域名
- **配对码 5 分钟过期** — 过期后需重新生成；用户设置页会显示倒计时
- **配对码一次性** — 用过即废（返回410），每个智能体需单独配对
- **pair/code 需登录Token** — 调 `/api/pair/code` 必须带 Authorization header（用户在网页操作，智能体不需要调这个）
- **pair/exchange 无需认证** — 只需配对码，任何智能体都能调
- **Go embed 缓存** — 部署前 `touch static/*` 再编译，否则嵌入的静态文件不更新
- **Steam Deck 密码框** — 用 `type="text"` + 眼睛按钮切换，`type="password"` 不弹虚拟键盘
- **WebSocket 实时同步** — CREATE/UPDATE/DELETE 秒级推送，无需刷新
- **多智能体并发安全** — 用 `source` 字段区分来源，Last-write-wins + WS 广播保证一致
- **新增数据库表需重启** — `initDB()` 在启动时执行，添加新表后必须重启服务
- **安全策略限制** — 部分智能体不允许 curl 下载远程脚本，此时用纯 HTTP 方式（配对码换 Token + POST 推送），无需下载任何文件

## Scripts

- `scripts/push_todo.py` — 可选推送脚本：提供离线队列、自动重试等高级功能（非必需）

## References

- `references/api.md` — 完整 API 文档（含配对码端点）
