#!/usr/bin/env python3
"""Claw Todo 配对脚本 - 用配对码换绑定 Token"""
import json
import os
import sys
import urllib.request
import urllib.error

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(SKILL_DIR, "config.json")

def load_config():
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH) as f:
            return json.load(f)
    return {}

def save_config(cfg):
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)

def pair(endpoint, code, source):
    """用配对码换绑定 Token"""
    url = f"{endpoint.rstrip('/')}/api/pair/exchange"
    data = json.dumps({"code": code, "source": source}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
        if result.get("token"):
            return result
        else:
            print(f"ERROR: {result.get('error', 'unknown error')}", file=sys.stderr)
            return None
    except urllib.error.HTTPError as e:
        body = json.loads(e.read())
        print(f"ERROR: {body.get('error', f'HTTP {e.code}')}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return None

def test_push(endpoint, token, source):
    """测试推送一条待办"""
    url = f"{endpoint.rstrip('/')}/api/todos"
    data = json.dumps({
        "title": "✅ 配对成功！这是测试待办",
        "priority": "normal",
        "source": source
    }).encode()
    req = urllib.request.Request(url, data=data, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
        return result.get("id") is not None
    except Exception as e:
        print(f"WARNING: push test failed: {e}", file=sys.stderr)
        return False

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: setup.py <endpoint> <pair_code> [source]")
        sys.exit(1)

    endpoint = sys.argv[1]
    code = sys.argv[2]
    source = sys.argv[3] if len(sys.argv) > 3 else "hermes"

    result = pair(endpoint, code, source)
    if not result:
        sys.exit(1)

    # Save config
    cfg = load_config()
    cfg["endpoint"] = endpoint
    cfg["token"] = result["token"]
    cfg["source"] = source
    save_config(cfg)

    # Test push
    ok = test_push(endpoint, result["token"], source)

    print(json.dumps({
        "status": "paired",
        "username": result.get("username"),
        "push_test": "ok" if ok else "failed",
        "config_saved": CONFIG_PATH
    }))
