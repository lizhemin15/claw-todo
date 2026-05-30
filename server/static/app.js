// Claw Todo - Frontend App
// Steam Deck touch-optimized, offline-capable

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

// State
let token = localStorage.getItem('token') || '';
let ws = null;
let todos = [];
let currentFilter = 'all';
let editingTodoId = null;
let isOnline = navigator.onLine;

// DOM Elements
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Check auth status
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

// Auth
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
  const password = $('setup-password').value;
  
  if (!username || !password) {
    showError('请输入用户名和密码');
    return;
  }
  
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
    toast('账号创建成功！');
  } else {
    showError(res?.error || '创建失败');
  }
}

async function doLogin() {
  const username = $('login-username').value.trim();
  const password = $('login-password').value;
  
  if (!username || !password) {
    showError('请输入用户名和密码');
    return;
  }
  
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
    toast('登录成功！');
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

// Todos
async function loadTodos() {
  const res = await fetchJSON(`${API.todos}?status=${currentFilter === 'all' ? '' : currentFilter}`);
  if (Array.isArray(res)) {
    todos = res;
    renderTodos();
  }
}

function renderTodos() {
  const list = $('todo-list');
  const empty = $('empty-state');
  
  // Filter
  let filtered = todos;
  if (currentFilter !== 'all') {
    filtered = todos.filter(t => t.status === currentFilter);
  }
  
  if (filtered.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  
  empty.classList.add('hidden');
  
  // Sort by priority and created_at
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
  filtered.sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1;
    if (a.status !== 'completed' && b.status === 'completed') return -1;
    const pa = priorityOrder[a.priority] ?? 2;
    const pb = priorityOrder[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return new Date(b.created_at) - new Date(a.created_at);
  });
  
  list.innerHTML = filtered.map(todo => `
    <div class="todo-card ${todo.status} priority-${todo.priority}" data-id="${todo.id}">
      <div class="swipe-hint left">✅</div>
      <div class="swipe-hint right">⏰</div>
      <div class="todo-card-header">
        <div class="todo-title">${escapeHtml(todo.title)}</div>
        <span class="todo-priority">${priorityLabel(todo.priority)}</span>
      </div>
      ${todo.description ? `<div class="todo-desc">${escapeHtml(todo.description)}</div>` : ''}
      <div class="todo-meta">
        ${todo.due ? `<span>⏰ ${formatDate(todo.due)}</span>` : ''}
        ${todo.source ? `<span class="todo-source">📎 ${escapeHtml(todo.source)}</span>` : ''}
        ${todo.tags?.length ? `<span>🏷️ ${todo.tags.map(escapeHtml).join(', ')}</span>` : ''}
      </div>
      <div class="todo-actions">
        ${todo.status !== 'completed' ? `
          <button class="btn-complete" onclick="completeTodo('${todo.id}')">✓ 完成</button>
          <button class="btn-postpone" onclick="postponeTodo('${todo.id}')">⏰ 推迟</button>
        ` : ''}
        <button class="btn-delete" onclick="deleteTodo('${todo.id}')">🗑️</button>
      </div>
    </div>
  `).join('');
  
  // Setup swipe gestures
  setupSwipeGestures();
}

function priorityLabel(p) {
  return { urgent: '🔴 紧急', high: '🟡 重要', normal: '🔵 普通', low: '⚪ 低' }[p] || p;
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

// CRUD
async function completeTodo(id) {
  const res = await fetchJSON(`${API.todos}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' })
  });
  if (res?.id) {
    toast('✅ 已完成');
    await loadTodos();
  }
}

async function postponeTodo(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;
  
  // Postpone to tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(18, 0, 0, 0);
  
  const res = await fetchJSON(`${API.todos}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ 
      status: 'postponed',
      due: tomorrow.toISOString()
    })
  });
  if (res?.id) {
    toast('⏰ 已推迟到明天');
    await loadTodos();
  }
}

async function deleteTodo(id) {
  if (!confirm('确定删除？')) return;
  
  const res = await fetchJSON(`${API.todos}/${id}`, {
    method: 'DELETE'
  });
  if (res?.message) {
    toast('🗑️ 已删除');
    await loadTodos();
  }
}

// Modal
function openAddModal() {
  editingTodoId = null;
  $('modal-title').textContent = '新建待办';
  $('todo-title-input').value = '';
  $('todo-desc-input').value = '';
  $('todo-priority-input').value = 'normal';
  $('todo-due-input').value = '';
  $('todo-tags-input').value = '';
  $('todo-modal').classList.remove('hidden');
  $('todo-title-input').focus();
}

function openEditModal(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;
  
  editingTodoId = id;
  $('modal-title').textContent = '编辑待办';
  $('todo-title-input').value = todo.title;
  $('todo-desc-input').value = todo.description || '';
  $('todo-priority-input').value = todo.priority;
  $('todo-due-input').value = todo.due ? todo.due.slice(0, 16) : '';
  $('todo-tags-input').value = todo.tags?.join(', ') || '';
  $('todo-modal').classList.remove('hidden');
  $('todo-title-input').focus();
}

function closeTodoModal() {
  $('todo-modal').classList.add('hidden');
}

async function saveTodo() {
  const title = $('todo-title-input').value.trim();
  if (!title) {
    toast('请输入标题');
    return;
  }
  
  const data = {
    title,
    description: $('todo-desc-input').value.trim(),
    priority: $('todo-priority-input').value,
    due: $('todo-due-input').value ? new Date($('todo-due-input').value).toISOString() : '',
    tags: $('todo-tags-input').value.split(',').map(t => t.trim()).filter(Boolean)
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

// Settings
function openSettings() {
  $('settings-modal').classList.remove('hidden');
  updateSyncStatus();
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
  const token = $('bind-token').value;
  if (!token) {
    toast('请先生成 Token');
    return;
  }
  navigator.clipboard.writeText(token);
  toast('已复制到剪贴板');
}

async function updateSyncStatus() {
  const res = await fetchJSON(API.syncPending);
  const count = Array.isArray(res) ? res.length : 0;
  $('sync-status-text').textContent = `待同步: ${count} 条`;
}

async function doSync() {
  const pending = await fetchJSON(API.syncPending);
  if (!Array.isArray(pending) || pending.length === 0) {
    toast('没有待同步项');
    return;
  }
  
  // Ack all
  await fetchJSON(API.syncAck, {
    method: 'POST',
    body: JSON.stringify({ ids: pending.map(e => e.id) })
  });
  
  toast(`已同步 ${pending.length} 条`);
  updateSyncStatus();
}

// WebSocket
function connectWS() {
  if (!token) return;
  
  ws = new WebSocket(`${API.ws}?token=${token}`);
  
  ws.onopen = () => {
    console.log('WebSocket connected');
    setOnline(true);
  };
  
  ws.onclose = () => {
    console.log('WebSocket disconnected');
    setOnline(false);
    // Reconnect after 3s
    setTimeout(connectWS, 3000);
  };
  
  ws.onerror = err => {
    console.error('WebSocket error:', err);
  };
  
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    handleWSMessage(msg);
  };
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case 'todo_created':
      todos.unshift(msg.payload);
      renderTodos();
      break;
    case 'todo_updated':
      const idx = todos.findIndex(t => t.id === msg.payload.id);
      if (idx >= 0) todos[idx] = msg.payload;
      renderTodos();
      break;
    case 'todo_deleted':
      todos = todos.filter(t => t.id !== msg.payload.id);
      renderTodos();
      break;
  }
}

function setOnline(online) {
  isOnline = online;
  const dot = $('online-status');
  dot.className = `status-dot ${online ? 'online' : 'offline'}`;
  dot.title = online ? '在线' : '离线模式';
}

// Offline
function setupOfflineHandler() {
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
  
  // Service Worker for offline caching
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.log('SW registration failed:', err);
    });
  }
}

// Swipe Gestures
function setupSwipeGestures() {
  $$('.todo-card').forEach(card => {
    let startX = 0;
    let currentX = 0;
    
    card.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
    }, { passive: true });
    
    card.addEventListener('touchmove', e => {
      currentX = e.touches[0].clientX;
      const diff = currentX - startX;
      
      if (Math.abs(diff) > 20) {
        card.classList.toggle('swiping-left', diff < -40);
        card.classList.toggle('swiping-right', diff > 40);
      }
    }, { passive: true });
    
    card.addEventListener('touchend', e => {
      const diff = currentX - startX;
      const id = card.dataset.id;
      
      card.classList.remove('swiping-left', 'swiping-right');
      
      if (diff < -100) {
        // Swipe left = complete
        completeTodo(id);
      } else if (diff > 100) {
        // Swipe right = postpone
        postponeTodo(id);
      }
      
      startX = 0;
      currentX = 0;
    });
  });
}

// Event Listeners
function setupEventListeners() {
  // Auth
  $('setup-btn').onclick = doSetup;
  $('login-btn').onclick = doLogin;
  
  // Enter key for login
  $('setup-password').onkeydown = e => e.key === 'Enter' && doSetup();
  $('login-password').onkeydown = e => e.key === 'Enter' && doLogin();
  
  // Header buttons
  $('add-btn').onclick = openAddModal;
  $('refresh-btn').onclick = loadTodos;
  $('settings-btn').onclick = openSettings;
  
  // Filter
  $$('.filter-btn').forEach(btn => {
    btn.onclick = () => {
      $$('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderTodos();
    };
  });
  
  // Modal
  $('modal-cancel').onclick = closeTodoModal;
  $('modal-save').onclick = saveTodo;
  $('todo-modal').querySelector('.modal-backdrop').onclick = closeTodoModal;
  
  // Settings
  $('settings-close').onclick = closeSettings;
  $('gen-token-btn').onclick = generateBindToken;
  $('copy-token-btn').onclick = copyBindToken;
  $('sync-btn').onclick = doSync;
  $('settings-modal').querySelector('.modal-backdrop').onclick = closeSettings;
}

// Helpers
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
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2000);
}
