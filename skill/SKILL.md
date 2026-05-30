---
name: todo-push
description: 推送待办事项到 Claw Todo 显示端。支持离线队列、双向同步，适用于 Hermes/小龙虾/Open-Claw 等智能体。
version: 1.0.0
tags: [todo, push, claw-todo, productivity]
config:
  endpoint:
    required: true
    description: "显示端地址，如 https://todo.yourdomain.com"
  token:
    required: true
    description: "绑定 Token，从显示端设置页生成"
  offline_queue:
    default: "./todo-push-queue.jsonl"
    description: "离线时待办写入的本地队列文件路径"
  retry_interval:
    default: 30
    description: "离线重试间隔（秒）"
---

# Todo-Push Skill

推送待办事项到 Claw Todo 显示端，支持离线队列和双向同步。

## 配置

```yaml
todo_push:
  endpoint: "https://todo.yourdomain.com"
  token: "eyJxxx..."
  offline_queue: "./todo-push-queue.jsonl"
  retry_interval: 30
```

## 函数

### push_todo(title, priority, due, tags, description, metadata)

推送单个待办事项。

**参数：**
- `title` (string, 必填): 待办标题
- `priority` (string, 可选): 优先级 `urgent` | `high` | `normal` | `low`，默认 `normal`
- `due` (string, 可选): 截止时间，ISO 8601 格式
- `tags` (string[], 可选): 标签列表
- `description` (string, 可选): 详细描述
- `metadata` (object, 可选): 扩展元数据

**返回：**
```json
{
  "id": "uuid",
  "title": "...",
  "status": "pending",
  ...
}
```

**示例：**
```python
push_todo(
  title="提交IEEE论文修改稿",
  priority="urgent",
  due="2026-05-30T18:00:00",
  tags=["论文", "IEEE"],
  description="根据审稿意见修改后提交"
)
```

### push_todos(items)

批量推送多个待办事项。

**参数：**
- `items` (array): 待办对象数组，每个对象包含上述字段

**示例：**
```python
push_todos([
  {"title": "任务1", "priority": "high"},
  {"title": "任务2", "priority": "normal", "due": "2026-05-31"}
])
```

### complete_todo(id)

标记待办为已完成（用于双向同步确认）。

### sync_status()

查看同步状态，返回队列中待发送的条目数。

## 离线机制

当显示端不可达时：
1. 待办写入本地 `offline_queue` 文件（JSONL 格式）
2. 每次调用前尝试清空队列（FIFO）
3. 队列条目带重试计数，超过 10 次标记 `failed`

## 双向同步

显示端前端标记完成 → 存入 `sync_log` → Skill 端定期 `GET /api/sync/pending` 拉取 → `POST /api/sync/ack` 确认。

Skill 端可选择将完成事件反馈给 Agent。

## 绑定流程

1. 部署 Claw Todo 显示端
2. 浏览器首次访问 → 创建账号 → 设置页生成绑定 Token
3. 配置 Skill 的 `endpoint` 和 `token`
4. 完事 🎉
