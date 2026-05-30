# 🦞 Claw Todo

Steam Deck 触摸屏优化的待办事项显示端 + 通用推送 Skill。

任何智能体（Hermes/小龙虾/Open-Claw）安装 Skill 后即可推送待办到显示端。

## 特性

- 🎮 **Steam Deck 优化** - 触摸友好，深色主题，左滑完成/右滑推迟
- 🔗 **多智能体推送** - Hermes、小龙虾、Open-Claw 都能推送待办
- 🔄 **双向同步** - 前端标记完成，Skill 端自动感知
- 📶 **离线支持** - 断网也能用，重连后自动同步
- 🚀 **单二进制** - Go 编译，下载即跑，零依赖
- 🔐 **JWT 认证** - 账号密码登录 + 绑定 Token

## 快速开始

### 1. 下载并运行

```bash
# 下载（从 GitHub Release）
wget https://github.com/jamily/claw-todo/releases/latest/download/claw-todo-linux-amd64
chmod +x claw-todo-linux-amd64

# 运行
./claw-todo-linux-amd64 --port 8080 --data ./data
```

### 2. 首次设置

浏览器打开 `http://localhost:8080`，创建管理员账号。

### 3. 生成绑定 Token

进入设置页 → 生成绑定 Token → 复制。

### 4. 智能体安装 Skill

```bash
# 复制 skill/ 目录到你的智能体的 skills 目录
cp -r skill/ ~/.hermes/skills/productivity/todo-push/

# 编辑配置
vim skill/config.json
# 填入 endpoint 和 token
```

### 5. Cloudflare 隧道（可选）

```bash
# 在 cloudflared 配置中添加
cloudflared tunnel route your-tunnel localhost:8080
```

## 编译

需要 Go 1.22+ 和 CGO（go-sqlite3 依赖）。

```bash
cd server
go build -o claw-todo .
```

### 交叉编译

go-sqlite3 需要 CGO，交叉编译需要对应平台的 C 交叉编译器：

```bash
# Linux amd64
CGO_ENABLED=1 GOOS=linux GOARCH=amd64 go build -o claw-todo-linux-amd64 .

# Linux arm64 (需要 aarch64-linux-gnu-gcc)
CGO_ENABLED=1 CC=aarch64-linux-gnu-gcc GOOS=linux GOARCH=arm64 go build -o claw-todo-linux-arm64 .

# macOS (需要 osxcross)
CGO_ENABLED=1 CC=o64-clang GOOS=darwin GOARCH=amd64 go build -o claw-todo-darwin-amd64 .
```

## API

详见 [skill/references/api.md](skill/references/api.md)

### 认证

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/setup` | POST | 首次创建账号 |
| `/api/auth/login` | POST | 登录获取 Token |
| `/api/auth/status` | GET | 检查是否已初始化 |
| `/api/auth/token` | POST | 生成绑定 Token |

### 待办 CRUD

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/todos` | POST | 创建待办 |
| `/api/todos` | GET | 列表（支持过滤） |
| `/api/todos/:id` | GET | 获取单个 |
| `/api/todos/:id` | PATCH | 更新 |
| `/api/todos/:id` | DELETE | 删除 |

### 同步

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sync/pending` | GET | 拉取未同步变更 |
| `/api/sync/ack` | POST | 确认已同步 |

### WebSocket

`WS /ws?token=<token>` - 实时推送待办变更

## 技术栈

- **服务端**: Go + net/http + gorilla/websocket + go-sqlite3 + golang-jwt
- **前端**: 原生 HTML/CSS/JS + Service Worker（embed.FS 嵌入二进制）
- **部署**: GitHub Actions 交叉编译 → Release 下载单二进制
- **隧道**: Cloudflare 固定隧道

## 项目结构

```
claw-todo/
├── server/                    # Go 服务端
│   ├── main.go                # 入口，embed 前端，路由
│   ├── auth.go                # JWT 认证
│   ├── database.go            # SQLite 操作
│   ├── handler.go             # API handlers
│   ├── hub.go                 # WebSocket hub
│   └── static/                # 前端（编译时 embed）
│       ├── index.html
│       ├── style.css
│       ├── app.js
│       ├── sw.js
│       └── manifest.json
├── skill/                     # 推送 Skill
│   ├── SKILL.md               # Skill 定义
│   ├── scripts/push_todo.py   # 推送脚本
│   ├── templates/config.json  # 配置模板
│   └── references/api.md      # API 文档
├── .github/workflows/         # CI/CD
│   └── release.yml
└── README.md
```

## License

MIT
