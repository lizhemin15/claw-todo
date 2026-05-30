#!/usr/bin/env python3
"""Claw Todo 通用安装脚本 - 适用于任何智能体

用法:
  1. 从 Claw Todo 设置页生成配对码
  2. python3 install.py http://localhost:8090 <配对码> <来源名>
  3. 完成！后续用 push_todo.py 推送待办

也支持 curl 一键安装:
  curl -sL https://todo.open-claw.click/.well-known/skills/todo-push/install.py | python3 - http://localhost:8090 <配对码> <来源名>
"""

import json
import os
import sys
import urllib.request
import urllib.error

def download_file(url):
    """Download a file from URL"""
    headers = {"User-Agent": "ClawTodo-Installer/1.0"}
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.read().decode()
    except Exception as e:
        print(f"ERROR: Failed to download {url}: {e}", file=sys.stderr)
        return None

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

def main():
    # Support env vars for curl | python3 - mode
    endpoint = os.environ.get("CLAW_TODO_ENDPOINT", sys.argv[1] if len(sys.argv) > 1 else "")
    code = os.environ.get("CLAW_TODO_PAIR_CODE", sys.argv[2] if len(sys.argv) > 2 else "")
    source = os.environ.get("CLAW_TODO_SOURCE", sys.argv[3] if len(sys.argv) > 3 else "agent")

    if not endpoint or not code:
        print("Claw Todo 通用安装脚本")
        print()
        print("用法:")
        print("  python3 install.py <endpoint> <pair_code> [source]")
        print("  CLAW_TODO_ENDPOINT=http://localhost:8090 CLAW_TODO_PAIR_CODE=123456 python3 install.py")
        print()
        print("curl 一键安装:")
        print("  curl -sL https://todo.open-claw.click/.well-known/skills/todo-push/install.py -o install.py")
        print("  python3 install.py http://localhost:8090 <配对码> <来源名>")
        print()
        print("步骤:")
        print("  1. 打开 Claw Todo → ⚙️ 设置 → 生成配对码")
        print("  2. 运行本脚本，传入配对码")
        print("  3. 完成！")
        sys.exit(1)

    # Step 1: Pair
    print(f"🔗 正在配对 {endpoint} ...")
    result = pair(endpoint, code, source)
    if not result:
        sys.exit(1)

    token = result["token"]
    username = result.get("username", "unknown")
    print(f"✅ 配对成功！用户: {username}")

    # Step 2: Download skill files
    # Determine base URL for skill files
    # If endpoint is localhost, use it directly; otherwise try well-known
    skill_base = f"{endpoint.rstrip('/')}/.well-known/skills/todo-push"

    # Create skill directory
    skill_dir = os.path.join(os.path.expanduser("~"), ".claw-todo")
    os.makedirs(skill_dir, exist_ok=True)

    # Save config
    config = {
        "endpoint": endpoint,
        "token": token,
        "source": source
    }
    config_path = os.path.join(skill_dir, "config.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    print(f"📝 配置已保存: {config_path}")

    # Download push script
    push_script_url = f"{skill_base}/scripts/push_todo.py"
    push_script = download_file(push_script_url)
    if push_script:
        push_path = os.path.join(skill_dir, "push_todo.py")
        with open(push_path, "w") as f:
            f.write(push_script)
        os.chmod(push_path, 0o755)
        print(f"📦 推送脚本已下载: {push_path}")
    else:
        print("⚠️  推送脚本下载失败（可能 Cloudflare 拦截），可手动下载")

    # Step 3: Test push
    ok = test_push(endpoint, token, source)
    if ok:
        print("🧪 测试推送成功！检查你的 Claw Todo 看板")
    else:
        print("⚠️  测试推送失败，但配置已保存，稍后可重试")

    # Print usage
    print()
    print("=" * 50)
    print("🎉 安装完成！")
    print()
    print("推送待办:")
    print(f"  python3 {skill_dir}/push_todo.py push \"买牛奶\" normal")
    print()
    print("或直接用 API:")
    print(f"  curl -X POST {endpoint}/api/todos \\")
    print(f'    -H "Authorization: Bearer {token[:8]}..." \\')
    print(f'    -H "Content-Type: application/json" \\')
    print(f'    -d \'{{"title":"买牛奶","source":"{source}"}}\'')
    print()
    print("配置文件:", config_path)

if __name__ == "__main__":
    main()
