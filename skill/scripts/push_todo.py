#!/usr/bin/env python3
"""Claw Todo Push Script - 通用推送脚本，适用于任何智能体"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

try:
    import urllib.request
    import urllib.error
except ImportError:
    print("Error: urllib not available")
    sys.exit(1)

# Config - can be overridden via environment variables or config file
ENDPOINT = os.environ.get("CLAW_TODO_ENDPOINT", "")
TOKEN = os.environ.get("CLAW_TODO_TOKEN", "")
OFFLINE_QUEUE = os.environ.get("CLAW_TODO_QUEUE", "./todo-push-queue.jsonl")
RETRY_INTERVAL = int(os.environ.get("CLAW_TODO_RETRY_INTERVAL", "30"))
SOURCE = os.environ.get("CLAW_TODO_SOURCE", "skill")
MAX_RETRIES = 10


def load_config():
    """Load config from environment or config file"""
    global ENDPOINT, TOKEN, OFFLINE_QUEUE, RETRY_INTERVAL, SOURCE

    config_path = Path(__file__).parent.parent / "config.json"
    if config_path.exists():
        with open(config_path) as f:
            cfg = json.load(f)
            ENDPOINT = cfg.get("endpoint", ENDPOINT)
            TOKEN = cfg.get("token", TOKEN)
            OFFLINE_QUEUE = cfg.get("offline_queue", OFFLINE_QUEUE)
            RETRY_INTERVAL = cfg.get("retry_interval", RETRY_INTERVAL)
            SOURCE = cfg.get("source", SOURCE)


def api_call(path, method="GET", data=None):
    """Make API call to Claw Todo server"""
    if not ENDPOINT or not TOKEN:
        return None, "endpoint or token not configured"

    url = f"{ENDPOINT.rstrip('/')}{path}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {TOKEN}"
    }

    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read()), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.read().decode()}"
    except urllib.error.URLError as e:
        return None, f"Connection error: {e.reason}"
    except Exception as e:
        return None, str(e)


def queue_item(item):
    """Write item to offline queue"""
    queue_path = Path(OFFLINE_QUEUE)
    queue_path.parent.mkdir(parents=True, exist_ok=True)

    entry = {
        **item,
        "_queued_at": datetime.now().isoformat(),
        "_retries": 0,
        "_status": "pending"
    }

    with open(queue_path, "a") as f:
        f.write(json.dumps(entry) + "\n")


def flush_queue():
    """Try to send all pending items in queue"""
    queue_path = Path(OFFLINE_QUEUE)
    if not queue_path.exists():
        return 0

    with open(queue_path) as f:
        lines = f.readlines()

    remaining = []
    sent = 0

    for line in lines:
        if not line.strip():
            continue

        entry = json.loads(line)
        if entry.get("_status") == "failed":
            remaining.append(line)
            continue

        # Try to send
        todo_data = {k: v for k, v in entry.items() if not k.startswith("_")}
        result, err = api_call("/api/todos", method="POST", data=todo_data)

        if result:
            sent += 1
        else:
            entry["_retries"] = entry.get("_retries", 0) + 1
            if entry["_retries"] >= MAX_RETRIES:
                entry["_status"] = "failed"
            remaining.append(json.dumps(entry) + "\n")

    # Rewrite queue with remaining items
    with open(queue_path, "w") as f:
        f.writelines(remaining)

    return sent


def push_todo(title, priority="normal", due="", tags=None, description="", metadata=None, source=None):
    """Push a single todo item"""
    # First, try to flush existing queue
    flush_queue()

    item = {
        "title": title,
        "priority": priority,
        "due": due,
        "tags": tags or [],
        "description": description,
        "metadata": metadata or {},
        "source": source or SOURCE
    }

    result, err = api_call("/api/todos", method="POST", data=item)

    if result:
        return result
    else:
        # Queue for later
        queue_item(item)
        return {"queued": True, "error": err}


def push_todos(items):
    """Push multiple todo items"""
    results = []
    for item in items:
        title = item.pop("title", "Untitled")
        result = push_todo(title=title, **item)
        results.append(result)
    return results


def complete_todo(todo_id):
    """Mark a todo as completed"""
    result, err = api_call(f"/api/todos/{todo_id}", method="PATCH", data={"status": "completed"})
    if err:
        queue_item({"action": "complete", "todo_id": todo_id})
        return {"queued": True, "error": err}
    return result


def sync_status():
    """Check sync status"""
    # Count queue items
    queue_path = Path(OFFLINE_QUEUE)
    queue_count = 0
    if queue_path.exists():
        with open(queue_path) as f:
            for line in f:
                if line.strip():
                    entry = json.loads(line)
                    if entry.get("_status") != "failed":
                        queue_count += 1

    # Check pending sync from server
    pending, err = api_call("/api/sync/pending")
    pending_count = len(pending) if pending else 0

    return {
        "queue_pending": queue_count,
        "server_pending": pending_count,
        "online": err is None
    }


# CLI interface
if __name__ == "__main__":
    load_config()

    if len(sys.argv) < 2:
        print("Usage: push_todo.py <command> [args]")
        print("Commands:")
        print("  push <title> [priority] [due]  - Push a todo")
        print("  sync                           - Check sync status")
        print("  flush                          - Flush offline queue")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "push":
        title = sys.argv[2] if len(sys.argv) > 2 else "Untitled"
        priority = sys.argv[3] if len(sys.argv) > 3 else "normal"
        due = sys.argv[4] if len(sys.argv) > 4 else ""
        result = push_todo(title=title, priority=priority, due=due)
        print(json.dumps(result, indent=2, ensure_ascii=False))

    elif cmd == "sync":
        status = sync_status()
        print(json.dumps(status, indent=2, ensure_ascii=False))

    elif cmd == "flush":
        sent = flush_queue()
        print(f"Flushed {sent} items from queue")

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
