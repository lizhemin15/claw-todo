// Claw Todo - Kanban Frontend
// Steam Deck touch-optimized, offline-capable

// 密码框兼容
(function() {
  document.addEventListener('click', function(e) {
    if (!e.target.classList.contains('pwd-toggle')) return;
    const input = document.getElementById(e.target.dataset.target);
    if (input.type === 'password') {
      input.type = 'text';
      e.target.textContent = '👁';
    } else {
      input.type = 'password';
      e.target.textContent = '🔒';
    }
  });
  window.getPwdValue = function(id) { return document.getElementById(id).value || ''; };
})();

const API = {
  authStatus: '/api/auth/status',
  setup: '/api/auth/setup',
  login: '/api/auth/login',
  generateToken: '/api/auth/token',
  todos: '/api/todos',
  syncPending: '/api/sync/pending',
  syncAck: '/api/sync/ack',
  ws: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
};

let token = localStorage.getItem('token') || '';
let ws = null;
let todos = [];
let editingTodoId = null;

const $ = id => document.getElementById(id);
const $q = sel => document.querySelectorAll(sel);

// 状态映射
const COLUMNS = ['pending', 'in_progress', 'completed', 'postponed'];
const COL_NAMES = { pending: '待办', in_progress: '进行中', completed: '已完成', postponed: '推迟' };
const PRI_LABELS = { urgent: '急', high: '重', normal: '普', low: '低' };

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const status = await fetchJSON(API.authStatus);
  if (!status?.setup) {
    showSetup();
  } else if (token) {
    await loadTodos();
    connectWS();
    showApp();
  } else {
    showLogin();
  }
  setupEventListeners();
  setupOfflineHandler();
}

// === Auth ===
function showSetup() {
  $('auth-screen').classList.remove('hidden');
  $('setup-form').classList.remove('hidden');
  $('login-form').classList.add('hidden');
}

function showLogin() {
  $('auth-screen').classList.remove('hidden');
  $('setup-form').classList.add('hidden');
  $('login-form').classList.remove('hidden');
}

function showApp() {
  $('auth-screen').classList.add('hidden');
  $('app-screen').classList.remove('hidden');
}

async function doSetup() {
  const username = $('setup-username').value.trim();
  const password = getPwdValue('setup-password');
  if (!username || !password) return showError('请输入用户名和密码');
  const res = await fetchJSON(API.setup, {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  if (res?.token) {
    token = res.token;
    localStorage.setItem('token', token);
    await loadTodos();
    connectWS();
    showApp();
    toast('账号创建成功');
  } else {
    showError(res?.error || '创建失败');
  }
}

async function doLogin() {
  const username = $('login-username').value.trim();
  const password = getPwdValue('login-password');
  if (!username || !password) return showError('请输入用户名和密码');
  const res = await fetchJSON(API.login, {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  if (res?.token) {
    token = res.token;
    localStorage.setItem('token', token);
    await loadTodos();
    connectWS();
    showApp();
    toast('登录成功');
  } else {
    showError(res?.error || '登录失败');
  }
}

function showError(msg) {
  const el = $('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// === Kanban 渲染 ===
async function loadTodos() {
  const res = await fetchJSON(API.todos);
  if (Array.isArray(res)) {
    todos = res;
    renderKanban();
  }
}

function renderKanban() {
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };

  COLUMNS.forEach(status => {
    const col = $(`col-${status}`);
    const countEl = $(`count-${status}`);
    const items = todos
      .filter(t => t.status === status)
      .sort((a, b) => {
        const pa = priorityOrder[a.priority] ?? 2;
        const pb = priorityOrder[b.priority] ?? 2;
        if (pa !== pb) return pa - pb;
        return new Date(b.created_at) - new Date(a.created_at);
      });

    countEl.textContent = items.length;

    if (items.length === 0) {
      col.innerHTML = `<div class="column-empty">暂无${COL_NAMES[status]}</div>`;
      return;
    }

    col.innerHTML = items.map(t => renderCard(t)).join('');
  });
}

function renderCard(t) {
  const pri = PRI_LABELS[t.priority] || '普';
  const due = t.due ? formatDate(t.due) : '';

  let actions = '';
  if (t.status === 'pending') {
    actions = `
      <button class="q-start" onclick="moveTodo('${t.id}','in_progress')">▶</button>
      <button class="q-done" onclick="moveTodo('${t.id}','completed')">✓</button>
      <button class="q-postpone" onclick="moveTodo('${t.id}','postponed')">⏰</button>
      <button class="q-del" onclick="deleteTodo('${t.id}')">✕</button>
    `;
  } else if (t.status === 'in_progress') {
    actions = `
      <button class="q-done" onclick="moveTodo('${t.id}','completed')">✓</button>
      <button class="q-del" onclick="deleteTodo('${t.id}')">✕</button>
    `;
  } else if (t.status === 'completed') {
    actions = `
      <button class="q-start" onclick="moveTodo('${t.id}','pending')">↩</button>
      <button class="q-del" onclick="deleteTodo('${t.id}')">✕</button>
    `;
  } else if (t.status === 'postponed') {
    actions = `
      <button class="q-start" onclick="moveTodo('${t.id}','pending')">↩</button>
      <button class="q-done" onclick="moveTodo('${t.id}','completed')">✓</button>
      <button class="q-del" onclick="deleteTodo('${t.id}')">✕</button>
    `;
  }

  return `
    <div class="todo-card ${t.status} priority-${t.priority}" data-id="${t.id}" onclick="openEditModal('${t.id}')">
      <div class="todo-title">${escapeHtml(t.title)}</div>
      <div class="todo-meta">
        <span class="pri ${t.priority}">${pri}</span>
        ${due ? `<span class="due">${due}</span>` : ''}
        <span class="todo-acts" onclick="event.stopPropagation()">${actions}</span>
      </div>
    </div>
  `;
}

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  const now = new Date();
  const diff = date - now;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  if (days === -1) return '昨天';
  if (days > 0 && days <= 7) return `${days}天后`;
  if (days < 0 && days >= -7) return `${-days}天前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

// === CRUD ===
async function moveTodo(id, newStatus) {
  const patch = { status: newStatus };
  // 推迟到明天
  if (newStatus === 'postponed') {
    const tmr = new Date();
    tmr.setDate(tmr.getDate() + 1);
    tmr.setHours(18, 0, 0, 0);
    patch.due = tmr.toISOString();
  }
  const res = await fetchJSON(`${API.todos}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
  if (res?.id) {
    const labels = { completed: '已完成', in_progress: '开始进行', pending: '已恢复', postponed: '已推迟' };
    toast(labels[newStatus] || '已更新');
    await loadTodos();
  }
}

async function deleteTodo(id) {
  const res = await fetchJSON(`${API.todos}/${id}`, { method: 'DELETE' });
  if (res?.message) {
    toast('已删除');
    await loadTodos();
  }
}

// === Modal ===
function openAddModal() {
  editingTodoId = null;
  $('modal-title').textContent = '新建待办';
  $('todo-title-input').value = '';
  $('todo-desc-input').value = '';
  $('todo-priority-input').value = 'normal';
  $('todo-status-input').value = 'pending';
  $('todo-due-input').value = '';
  $('todo-modal').classList.remove('hidden');
}

function openEditModal(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;
  editingTodoId = id;
  $('modal-title').textContent = '编辑';
  $('todo-title-input').value = todo.title;
  $('todo-desc-input').value = todo.description || '';
  $('todo-priority-input').value = todo.priority;
  $('todo-status-input').value = todo.status;
  $('todo-due-input').value = todo.due ? todo.due.slice(0, 16) : '';
  $('todo-modal').classList.remove('hidden');
}

function closeTodoModal() {
  $('todo-modal').classList.add('hidden');
}

async function saveTodo() {
  const title = $('todo-title-input').value.trim();
  if (!title) return toast('请输入标题');

  const data = {
    title,
    description: $('todo-desc-input').value.trim(),
    priority: $('todo-priority-input').value,
    status: $('todo-status-input').value,
    due: $('todo-due-input').value ? new Date($('todo-due-input').value).toISOString() : '',
    tags: []
  };

  let res;
  if (editingTodoId) {
    res = await fetchJSON(`${API.todos}/${editingTodoId}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  } else {
    res = await fetchJSON(API.todos, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  if (res?.id) {
    closeTodoModal();
    toast(editingTodoId ? '已更新' : '已创建');
    await loadTodos();
  }
}

// === Settings ===
function openSettings() {
  $('settings-modal').classList.remove('hidden');
  updateBindToken();
}

function closeSettings() {
  $('settings-modal').classList.add('hidden');
}

async function generateBindToken() {
  const res = await fetchJSON(API.generateToken, { method: 'POST' });
  if (res?.token) {
    $('bind-token').value = res.token;
    toast('Token 已生成');
  }
}

function copyBindToken() {
  const t = $('bind-token').value;
  if (!t) return toast('请先生成 Token');
  navigator.clipboard.writeText(t);
  toast('已复制');
}

async function updateBindToken() {
  // 如果已有token就显示
  const el = $('bind-token');
  if (!el.value) {
    // 尝试获取
    const res = await fetchJSON(API.generateToken);
    if (res?.token) el.value = res.token;
  }
}

// === WebSocket ===
function connectWS() {
  if (!token) return;
  ws = new WebSocket(`${API.ws}?token=${token}`);
  ws.onopen = () => setOnline(true);
  ws.onclose = () => { setOnline(false); setTimeout(connectWS, 3000); };
  ws.onerror = () => {};
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'todo_created') { todos.unshift(msg.payload); renderKanban(); }
    else if (msg.type === 'todo_updated') {
      const idx = todos.findIndex(t => t.id === msg.payload.id);
      if (idx >= 0) todos[idx] = msg.payload;
      renderKanban();
    }
    else if (msg.type === 'todo_deleted') {
      todos = todos.filter(t => t.id !== msg.payload.id);
      renderKanban();
    }
  };
}

function setOnline(online) {
  const dot = $('online-status');
  dot.className = `status-dot ${online ? 'online' : 'offline'}`;
}

// === Offline ===
function setupOfflineHandler() {
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

// === Event Listeners ===
function setupEventListeners() {
  $('setup-btn').onclick = doSetup;
  $('login-btn').onclick = doLogin;
  $('setup-password').onkeydown = e => e.key === 'Enter' && doSetup();
  $('login-password').onkeydown = e => e.key === 'Enter' && doLogin();

  $('add-btn').onclick = openAddModal;
  $('settings-btn').onclick = openSettings;

  $('modal-cancel').onclick = closeTodoModal;
  $('modal-save').onclick = saveTodo;
  $('todo-modal').querySelector('.modal-backdrop').onclick = closeTodoModal;

  $('settings-close').onclick = closeSettings;
  $('gen-token-btn').onclick = generateBindToken;
  $('copy-token-btn').onclick = copyBindToken;
  $('settings-modal').querySelector('.modal-backdrop').onclick = closeSettings;

  // 键盘快捷键
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeTodoModal();
      closeSettings();
    }
  });
}

// === Helpers ===
async function fetchJSON(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers
      }
    });
    return res.json();
  } catch (err) {
    console.error('Fetch error:', err);
    return null;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2000);
}
