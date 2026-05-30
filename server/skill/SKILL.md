---
name: todo-push
description: 推送待办事项到 Claw Todo。配对码一键连接，支持离线队列。
version: 2.0.0
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
- **pair/code 需登录Token** — 调 `/api/pair/code` 必须带 `Authorization: Bearer <jwt>`，否则返回 unauthorized
- **curl 测 pair API 可能误判** — curl 传 Authorization header 方式易出错，用 Python urllib 测试更可靠
- **Go embed 缓存** — 部署前 `touch static/*` 再编译，否则嵌入的静态文件不更新
- **Cloudflare 静态缓存** — 版本号参数 `?v=N` 必须递增，否则浏览器加载旧版
- **Steam Deck 密码框** — 用 `type="text"` + 眼睛按钮切换，`type="password"` 不弹虚拟键盘
- **WebSocket 实时同步** — CREATE/UPDATE/DELETE 秒级推送，无需刷新
- **多智能体并发安全** — 用 `source` 字段区分来源，Last-write-wins + WS 广播保证一致
- **数据库文件名** — `claw-todo.db`（不是 `claw.db`），位于 `/opt/claw-todo/data/`
- **Service Worker 缓存** — 每次前端更新必须递增 SW 中的 `CACHE_NAME` 版本号
- **新增数据库表需重启** — `initDB()` 在启动时执行，添加新表（如 `pair_codes`）后必须重启服务才能生效，不会自动迁移

## 部署实例

- 公网: https://todo.open-claw.click
- 本地端点: http://localhost:8090
- 账号: admin / admin1234
- systemd 服务: `claw-todo.service`, `cloudflared-claw-todo.service`
- 隧道 UUID: `ed67539e-2793-4adc-8f59-bffa008cd29c`

## Skill 分发

Claw Todo Skill 可通过以下方式让任意智能体安装：

### 方式 1：GitHub 仓库 Tap（推荐）
```bash
hermes skills tap add <owner>/claw-todo
hermes skills install todo-push
hermes skills update todo-push  # 获取更新
```
- 支持完整目录结构（scripts/、references/、templates/）
- 仓库中 Skill 放在 `skills/todo-push/` 目录下

### 方式 2：Well-Known Endpoint
```bash
hermes skills install todo.open-claw.click/todo-push
```
- 需在 Claw Todo 后端添加 `/.well-known/skills/index.json` 路由
- Skill 和服务同源，天然配对

### 方式 3：直接 URL
```bash
hermes skills install https://raw.githubusercontent.com/<owner>/claw-todo/main/skills/todo-push/SKILL.md --name todo-push
```
- 只下载 SKILL.md，不含附属文件

**当前状态**：Skill 仅本地安装于 `~/.hermes/skills/productivity/claw-todo/`，尚未发布到任何公开源。

## Scripts

- `scripts/setup.py` — 配对脚本：`python3 setup.py <endpoint> <pair_code> [source]`
- `scripts/push_todo.py` — 推送脚本：读取 config.json 推送待办

## References

- `references/api.md` — 完整 API 文档（含配对码端点）
- `references/hermes-skill-distribution.md` — Hermes Skill 分发体系（5种来源+安装流程+分发建议）
- `references/steam-deck-frontend-fixes.md` — Steam Deck 前端兼容性修复
- `references/kanban-layout.md` — Kanban 四列布局设计
- `references/multi-agent-setup.md` — 多智能体配置
