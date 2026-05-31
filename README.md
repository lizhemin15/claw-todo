# 🦞 Claw Todo

Steam Deck 触摸屏优化的待办事项 Kanban 看板 + 多智能体推送。

任何智能体安装 Skill 后即可推送待办到看板，配对码一键连接。

## 特性

- 🎮 **Steam Deck 优化** — 触摸友好，深色主题，四列 Kanban 看板
- 🔗 **多智能体推送** — Hermes / OpenClaw / 任意智能体都能推送
- 🔑 **配对码连接** — 6位配对码，一键配对，无需手动复制 Token
- 🌐 **Well-Known 自发现** — 智能体从域名自动发现和安装 Skill
- 🔄 **实时同步** — WebSocket 双向推送，多端秒级同步
- 📶 **离线支持** — 断网队列，重连自动推送
- 🚀 **单二进制** — Go 编译，下载即跑，零依赖（前端+Skill 全部嵌入）
- 🔐 **JWT 认证** — 账号密码 + 绑定 Token + 配对码
- 📋 **四种状态** — 待办 / 进行中 / 已完成 / 推迟

## 快速开始

### 1. 下载并运行

```bash
# 从 GitHub Release 下载
wget https://github.com/lizhemin15/claw-todo/releases/latest/download/claw-todo-linux-amd64
chmod +x claw-todo-linux-amd64

# 运行
./claw-todo-linux-amd64 --port 8090 --data ./data
```

### 2. 首次设置

浏览器打开 `http://localhost:8090`，创建管理员账号。

### 3. 智能体连接

#### Hermes 智能体（一行命令）
```bash
hermes skills install "well-known:https://todo.open-claw.click/.well-known/skills/todo-push" -y --force
```

#### 任意智能体（零脚本，纯 HTTP）
不需要下载任何文件！只需 HTTP 调用：

```bash
# 1. 在 Claw Todo 设置页生成配对码（6位数字，5分钟有效）

# 2. 用配对码换 Token
curl -X POST https://todo.open-claw.click/api/pair/exchange \
  -H "Content-Type: application/json" \
  -d '{"code":"123456","source":"my-agent"}'

# 3. 推送待办
curl -X POST https://todo.open-claw.click/api/todos \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"买牛奶","priority":"normal","source":"my-agent"}'
```

**四种待办状态：** `pending`(待办) / `in_progress`(进行中) / `completed`(已完成) / `postponed`(推迟)

**获取待办列表：** `GET /api/todos`（不带 status 参数返回所有状态）

#### 有 Python 环境的智能体（可选脚本）
```bash
# 下载推送脚本（可选，提供离线队列等高级功能）
curl -sL https://todo.open-claw.click/.well-known/skills/todo-push/scripts/push_todo.py -o push_todo.py
python3 push_todo.py push "买牛奶" normal
```

### 4. Cloudflare 隧道（可选）

```bash
cloudflared tunnel route your-tunnel localhost:8090
```

## 编译

需要 Go 1.22+ 和 CGO（go-sqlite3 依赖）。

```bash
cd server
go build -o claw-todo .
```

### 交叉编译

```bash
# Linux amd64
CGO_ENABLED=1 GOOS=linux GOARCH=amd64 go build -o claw-todo-linux-amd64 .

# Linux arm64 (需要交叉编译器)
CGO_ENABLED=1 CC=aarch64-linux-gnu-gcc GOOS=linux GOARCH=arm64 go build -o claw-todo-linux-arm64 .
```

## API

详见 [server/skill/references/api.md](server/skill/references/api.md)

### 认证

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/setup` | POST | 首次创建账号 |
| `/api/auth/login` | POST | 登录获取 Token |
| `/api/auth/status` | GET | 检查是否已初始化 |
| `/api/auth/token` | POST | 生成绑定 Token |

### 配对码

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/pair/code` | POST | 生成6位配对码（5分钟有效） |
| `/api/pair/exchange` | POST | 用配对码换绑定 Token |

### 待办 CRUD

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/todos` | POST | 创建待办 |
| `/api/todos` | GET | 列表（支持 `?status=pending` 过滤） |
| `/api/todos/:id` | PATCH | 更新（含状态变更） |
| `/api/todos/:id` | DELETE | 删除 |

### Well-Known Skill 发现

| 端点 | 方法 | 说明 |
|------|------|------|
| `/.well-known/skills/index.json` | GET | Skill 列表 |
| `/.well-known/skills/todo-push/<path>` | GET | Skill 文件内容 |

### WebSocket

`WS /ws?token=<token>` — 实时推送待办变更

## 技术栈

- **服务端**: Go + net/http + gorilla/websocket + go-sqlite3 + golang-jwt
- **前端**: 原生 HTML/CSS/JS + Service Worker（embed.FS 嵌入二进制）
- **Skill**: 零脚本模式（纯 HTTP）+ 可选 Python 推送脚本 + Well-Known 自发现 + 配对码
- **部署**: GitHub Actions 交叉编译 → Release 单二进制

## 项目结构

```
claw-todo/
├── server/                        # Go 服务端
│   ├── main.go                    # 入口，embed 前端+Skill，路由
│   ├── auth.go                    # JWT 认证
│   ├── database.go                # SQLite 操作 + 配对码
│   ├── handler.go                 # API handlers + Well-Known
│   ├── hub.go                     # WebSocket hub
│   ├── skill/                     # Skill 文件（编译时 embed）
│   │   ├── SKILL.md               # Skill 定义 (v4.0.0 零脚本模式)
│   │   ├── scripts/push_todo.py   # 推送脚本（可选，离线队列）
│   │   └── references/api.md      # API 文档
│   └── static/                    # 前端（编译时 embed）
│       ├── index.html             # Kanban 看板 + 设置模态框
│       ├── style.css              # 深色主题 + 触摸优化
│       ├── app.js                 # 前端逻辑 + WS
│       ├── sw.js                  # Service Worker
│       └── manifest.json          # PWA manifest
├── .github/workflows/release.yml  # CI/CD
└── README.md
```

## License

MIT
