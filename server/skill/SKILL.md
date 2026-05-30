---
name: todo-push
description: 推送待办事项到 Claw Todo。配对码一键连接，支持离线队列。
version: 3.1.0
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
  - install.py
  - scripts/setup.py
  - scripts/push_todo.py
  - references/api.md
---

# Claw Todo Skill

推送待办到 Claw Todo 看板。**配对码一键连接，无需手动复制 Token。**

## 快速开始

对智能体说：**"连接 Claw Todo"**

智能体会问你要配对码 → 你打开 Claw Todo 设置页 → 点击"生成配对码" → 告诉智能体 6 位数字 → 自动完成连接。

## 函数

### push_todo(title, priority, due, tags, description, metadata)

推送单个待办。

**参数：**
- `title` (string, 必填): 待办标题
- `priority` (string): `urgent` | `high` | `normal` | `low`，默认 `normal`
- `due` (string): 截止时间，ISO 8601 格式
- `tags` (string[]): 标签列表
- `description` (string): 详细描述
- `metadata` (object): 扩展元数据

**示例：**
```python
push_todo(
  title="提交论文修改稿",
  priority="urgent",
  due="2026-05-30T18:00:00",
  tags=["论文"]
)
```

### push_todos(items)

批量推送。

### complete_todo(id)

标记完成（双向同步）。

### sync_status()

查看队列状态。

## 配对流程

1. 用户打开 Claw Todo 设置页 → 生成 6 位配对码（5分钟有效）
2. 智能体调用 `scripts/setup.py <endpoint> <pair_code> [source]` 用配对码换 Token
3. Token 保存到 `config.json`，后续推送自动使用

**手动配对（无 setup.py 时）：**
1. `POST /api/pair/code`（需登录Token）→ 获取6位码
2. `POST /api/pair/exchange`（无需认证，body: `{code, source}`）→ 获取绑定Token
3. 写入 config.json

## 离线机制

显示端不可达时，待办写入本地队列文件，恢复后自动重试。

## Pitfalls

- **Cloudflare Tunnel 拦截脚本请求** — 必须用 `http://localhost:<port>` 而非公网域名
- **配对码 5 分钟过期** — 过期后需重新生成；用户设置页会显示倒计时
- **配对码一次性** — 用过即废（返回410），每个智能体需单独配对
- **pair/code 需登录Token** — 调 `/api/pair/code` 必须带 Authorization header
- **Go embed 缓存** — 部署前 `touch static/*` 再编译，否则嵌入的静态文件不更新
- **Steam Deck 密码框** — 用 `type="text"` + 眼睛按钮切换，`type="password"` 不弹虚拟键盘
- **WebSocket 实时同步** — CREATE/UPDATE/DELETE 秒级推送，无需刷新
- **多智能体并发安全** — 用 `source` 字段区分来源，Last-write-wins + WS 广播保证一致
- **新增数据库表需重启** — `initDB()` 在启动时执行，添加新表后必须重启服务

## 安装

### Hermes 智能体
```bash
hermes skills install "well-known:https://todo.open-claw.click/.well-known/skills/todo-push" -y --force
```

### 任意智能体（Claude Code / Codex / OpenCode / 任何能跑 Python 的）
```bash
# 方式1: 下载安装脚本（推荐）
curl -sL https://todo.open-claw.click/.well-known/skills/todo-push/install.py -o install.py
python3 install.py http://localhost:8090 <配对码> <来源名>

# 方式2: 环境变量模式
CLAW_TODO_ENDPOINT=http://localhost:8090 CLAW_TODO_PAIR_CODE=123456 python3 install.py
```

### 纯 API（无脚本，任何语言都能用）
```bash
# 1. 配对码换 Token
curl -X POST http://localhost:8090/api/pair/exchange \
  -H "Content-Type: application/json" \
  -d '{"code":"123456","source":"my-agent"}'

# 2. 推送待办
curl -X POST http://localhost:8090/api/todos \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"买牛奶","source":"my-agent"}'
```

## Scripts

- `scripts/setup.py` — 配对脚本：`python3 setup.py <endpoint> <pair_code> [source]`
- `scripts/push_todo.py` — 推送脚本：读取 config.json 推送待办

## References

- `references/api.md` — 完整 API 文档（含配对码端点）
