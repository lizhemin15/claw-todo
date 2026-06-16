// Claw Todo - 游戏化双栏聚焦 + 番茄钟 | Steam Deck 5-key navigation
// ↑↓←→ + Enter 全键盘操作 + 音效 + 动画 + 🍅

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
  pairCode: '/api/pair/code',
  pairExchange: '/api/pair/exchange',
  todos: '/api/todos',
  syncPending: '/api/sync/pending',
  syncAck: '/api/sync/ack',
  ws: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
};

let token = localStorage.getItem('token') || '';
let ws = null;
let todos = [];
let editingTodoId = null;

// === 导航状态 ===
let viewOffset = 0;
let activeCol = 0;
let currentRow = 0;
let focusMode = 'kanban';  // 'kanban' | 'modal' | 'settings' | 'auth' | 'action-menu' | 'pomodoro' | 'celebrate'
let focusZone = 'kanban';  // 'header' | 'kanban' | 'statusbar' — 大区域焦点
let headerBtnIndex = 0;    // header按钮索引：0=音效, 1=新建, 2=设置
let modalFocusIndex = 0;
let soundEnabled = true;

// === 番茄钟状态 ===
let pomoState = {
  active: false,
  paused: false,
  todoId: null,
  todoTitle: '',
  totalSeconds: 25 * 60,
  remainingSeconds: 25 * 60,
  intervalId: null
};

// === 游戏化状态 ===
let gameState = {
  level: 1,
  xp: 0,
  totalPomo: 0,        // 总番茄数
  todayPomo: 0,        // 今日番茄
  todayWorkouts: 0,    // 今日运动
  todayMeditations: 0, // 今日冥想
  todayDate: new Date().toDateString(),
  achievements: [],    // 已解锁成就ID
  streak: 0,           // 连续番茄
  // === Combo 连击 ===
  combo: 0,            // 当前连击数
  lastPomoTime: 0,     // 上次番茄完成时间戳
  // === Boss 战 ===
  bossId: null,        // 当前 Boss 关联的 todo ID
  bossHP: 0,           // Boss 当前 HP
  bossMaxHP: 0,        // Boss 最大 HP
  // === 每日挑战 ===
  dailyChallenge: null, // { type, target, progress, reward, date }
  // === Lobster 协议 ===
  lobsterMails: [],    // 未读龙虾信件
  lobsterGifts: [],    // 未领取龙虾礼物
  lobsterBounty: null, // 当前悬赏
  // === Buff ===
  activeBuffs: [],     // [{ type, expires, data }]
};

// XP计算：番茄=25XP，完成任务=50XP，紧急任务=100XP
const XP_REWARDS = {
  pomo: 25,
  complete: 50,
  urgent: 100,
  high: 75
};

// 等级XP需求（指数增长）
function xpForLevel(lvl) {
  return Math.floor(100 * Math.pow(1.5, lvl - 1));
}

// 等级称号
const LEVEL_TITLES = {
  1: '新手小虾', 2: '勤奋学徒', 3: '熟练工兵', 4: '专注达人',
  5: '时间大师', 6: '效率专家', 7: '番茄宗师', 8: '龙虾王者',
  9: '传说龙虾', 10: '神话龙虾'
};

// 列定义
const COLUMNS = ['pending', 'in_progress', 'completed', 'postponed'];
const COL_META = {
  pending:      { icon: '📋', name: '待办' },
  in_progress:  { icon: '🔄', name: '进行中' },
  completed:    { icon: '✅', name: '已完成' },
  postponed:    { icon: '⏰', name: '推迟' }
};
const PRI_LABELS = { urgent: '急', high: '重', normal: '普', low: '低' };
const POMO_DURATION = 25 * 60; // 25 分钟
const MINI_POMO_DURATION = 5 * 60; // 5 分钟起手式

// === 起手式状态 ===
let pomoModeIndex = 0; // 模式选择：0=标准, 1=起手式
let miniPomoOptionIndex = 0; // 起手式完成选择：0=继续, 1=停止
let pendingPomoTodo = null; // 等待模式选择的任务
let isMiniPomo = false; // 当前是否为5分钟起手式
let starterBuff = false; // 起手buff（继续做完时XP+50%）

// === 成就系统 ===
const ACHIEVEMENTS = [
  { id: 'first_pomo', name: '初试番茄', desc: '完成第一个番茄钟', icon: '🍅', check: gs => gs.totalPomo >= 1 },
  { id: 'pomo_5', name: '番茄新手', desc: '累计完成5个番茄', icon: '🌱', check: gs => gs.totalPomo >= 5 },
  { id: 'pomo_10', name: '番茄达人', desc: '累计完成10个番茄', icon: '🔥', check: gs => gs.totalPomo >= 10 },
  { id: 'pomo_25', name: '番茄大师', desc: '累计完成25个番茄', icon: '⭐', check: gs => gs.totalPomo >= 25 },
  { id: 'pomo_50', name: '番茄宗师', desc: '累计完成50个番茄', icon: '👑', check: gs => gs.totalPomo >= 50 },
  { id: 'streak_3', name: '三连击', desc: '连续完成3个番茄', icon: '⚡', check: gs => gs.streak >= 3 },
  { id: 'streak_5', name: '五连斩', desc: '连续完成5个番茄', icon: '💥', check: gs => gs.streak >= 5 },
  { id: 'level_3', name: '初出茅庐', desc: '达到3级', icon: '🗡️', check: gs => gs.level >= 3 },
  { id: 'level_5', name: '独当一面', desc: '达到5级', icon: '🛡️', check: gs => gs.level >= 5 },
  { id: 'level_8', name: '龙虾王者', desc: '达到8级', icon: '🦞', check: gs => gs.level >= 8 },
  { id: 'today_5', name: '今日五番茄', desc: '一天完成5个番茄', icon: '📅', check: gs => gs.todayPomo >= 5 },
  { id: 'first_complete', name: '首战告捷', desc: '完成第一个任务', icon: '✅', check: gs => gs.totalCompleted >= 1 },
  { id: 'clear_col', name: '清道夫', desc: '清空一列所有任务', icon: '🧹', check: gs => gs.hasClearedCol },
  // === Combo 成就 ===
  { id: 'combo_3', name: '三连击', desc: 'Combo达到3', icon: '⚡', check: gs => gs.combo >= 3 },
  { id: 'combo_5', name: '五连斩', desc: 'Combo达到5', icon: '💥', check: gs => gs.combo >= 5 },
  { id: 'combo_10', name: '十连破', desc: 'Combo达到10', icon: '🔥', check: gs => gs.combo >= 10 },
  // === Boss 成就 ===
  { id: 'boss_slayer', name: '屠龙者', desc: '击败第一个Boss', icon: '🐉', check: gs => gs.bossSlain >= 1 },
  { id: 'boss_master', name: '魔王克星', desc: '击败3个Boss', icon: '⚔️', check: gs => gs.bossSlain >= 3 },
  // === 每日挑战成就 ===
  { id: 'daily_done', name: '日课达人', desc: '完成3次每日挑战', icon: '📅', check: gs => gs.dailiesDone >= 3 },
];

// ═══════════════════ Combo 连击系统 ═══════════════════
const COMBO_WINDOW = 30 * 60 * 1000; // 30分钟内完成下一个番茄算连击
const COMBO_MULTIPLIERS = [1.0, 1.0, 1.2, 1.5, 1.8, 2.0, 2.2, 2.5, 2.8, 3.0]; // index=combo数

function getComboMultiplier() {
  const idx = Math.min(gameState.combo, COMBO_MULTIPLIERS.length - 1);
  return COMBO_MULTIPLIERS[idx];
}

function updateCombo() {
  const now = Date.now();
  if (gameState.lastPomoTime && (now - gameState.lastPomoTime) < COMBO_WINDOW) {
    gameState.combo++;
  } else {
    gameState.combo = 1;
  }
  gameState.lastPomoTime = now;
  saveGameState();
  showComboDisplay();
}

function showComboDisplay() {
  const el = $('combo-display');
  if (!el) return;
  if (gameState.combo >= 2) {
    const mult = getComboMultiplier();
    el.textContent = `×${gameState.combo} COMBO`;
    el.className = `combo-display combo-${Math.min(gameState.combo, 10)}`;
    el.classList.remove('hidden');
    // 连击越高动画越猛
    if (gameState.combo >= 5) {
      el.classList.add('combo-fire');
    } else {
      el.classList.remove('combo-fire');
    }
  } else {
    el.classList.add('hidden');
  }
}

// ═══════════════════ Boss 战系统 ═══════════════════
// Boss 从 urgent 任务自动生成，HP = 番茄数 × 系数
const BOSS_NAMES = [
  '拖延魔王', '分心巨兽', '焦虑恶龙', '完美主义幽灵', 'DDL暴食者',
  '自我怀疑巫妖', '手机诱惑妖', '沙发陷阱怪', '多线程混乱体', '无限修改兽'
];
const BOSS_ICONS = ['🐉', '👹', '👿', '👻', '🫠', '🧙', '📱', '🛋️', '🌀', '🦠'];

// ═══════════════════ 截止时间选择器 ═══════════════════
let dpState = { month: 6, day: 7, hour: 14, min: 30, activeField: 'month' };
const DP_FIELDS = ['month', 'day', 'hour', 'min'];
const WEEKDAYS = ['日','一','二','三','四','五','六'];

function dpInit(date) {
  const d = date || new Date();
  // 向上取整到30分钟
  const m = d.getMinutes();
  const rounded = m <= 15 ? 0 : m <= 45 ? 30 : 0;
  const addHour = m > 45 ? 1 : 0;
  dpState.month = d.getMonth() + 1;
  dpState.day = d.getDate() + addHour;
  dpState.hour = d.getHours() + addHour;
  dpState.min = rounded;
  dpState.activeField = 'month';
  // 修正溢出
  dpNormalize();
  dpRender();
}

function dpNormalize() {
  const year = new Date().getFullYear();
  const maxDay = new Date(year, dpState.month, 0).getDate();
  if (dpState.day > maxDay) dpState.day = maxDay;
  if (dpState.day < 1) dpState.day = 1;
  if (dpState.hour > 23) { dpState.hour = 0; dpState.day++; }
  if (dpState.hour < 0) { dpState.hour = 23; dpState.day--; }
  if (dpState.min > 30) dpState.min = 0;
  if (dpState.min < 0) dpState.min = 30;
  if (dpState.day > maxDay) dpState.day = maxDay;
  if (dpState.day < 1) dpState.day = 1;
  if (dpState.month > 12) dpState.month = 12;
  if (dpState.month < 1) dpState.month = 1;
}

function dpRender() {
  const pad = n => String(n).padStart(2, '0');
  $('dp-month').textContent = pad(dpState.month);
  $('dp-day').textContent = pad(dpState.day);
  $('dp-hour').textContent = pad(dpState.hour);
  $('dp-min').textContent = pad(dpState.min);
  // 星期
  const year = new Date().getFullYear();
  const wd = new Date(year, dpState.month - 1, dpState.day).getDay();
  $('dp-weekday').textContent = WEEKDAYS[wd];
  // 高亮active字段
  document.querySelectorAll('.dp-part').forEach(el => {
    el.classList.toggle('active', el.dataset.field === dpState.activeField);
  });
  // 同步到hidden input
  const iso = `${year}-${pad(dpState.month)}-${pad(dpState.day)}T${pad(dpState.hour)}:${pad(dpState.min)}:00.000Z`;
  const local = new Date(iso);
  // 用本地时间构造ISO
  const d = new Date(year, dpState.month - 1, dpState.day, dpState.hour, dpState.min);
  $('todo-deadline-input').value = d.toISOString();
}

function dpAdjust(field, dir) {
  const steps = { month: 1, day: 1, hour: 1, min: 30 };
  dpState[field] += dir * steps[field];
  dpNormalize();
  dpRender();
  playSound('move');
}

function dpClickInit() {
  const picker = $('deadline-picker');
  if (!picker) return;
  // 获得焦点时选中第一个字段
  picker.addEventListener('focus', () => {
    if (!DP_FIELDS.includes(dpState.activeField)) dpState.activeField = 'month';
    dpRender();
  });
  // 失去焦点时取消高亮
  picker.addEventListener('blur', () => {
    document.querySelectorAll('.dp-part').forEach(el => el.classList.remove('active'));
  });
  // 点击字段区域切换active
  picker.querySelectorAll('.dp-part').forEach(part => {
    part.addEventListener('click', () => {
      dpState.activeField = part.dataset.field;
      dpRender();
      playSound('move');
    });
  });
  // 点击◀▶按钮
  picker.querySelectorAll('.dp-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const part = btn.closest('.dp-part');
      const field = part.dataset.field;
      const dir = parseInt(btn.dataset.dir);
      dpState.activeField = field;
      dpAdjust(field, dir);
    });
  });
}

// 从ISO字符串回填picker
function dpFromISO(isoStr) {
  if (!isoStr) { dpInit(); return; }
  const d = new Date(isoStr);
  dpState.month = d.getMonth() + 1;
  dpState.day = d.getDate();
  dpState.hour = d.getHours();
  dpState.min = d.getMinutes() >= 30 ? 30 : 0;
  dpState.activeField = 'month';
  dpNormalize();
  dpRender();
}

// picker转ISO（供saveTodo使用）
function dpToISO() {
  const year = new Date().getFullYear();
  const pad = n => String(n).padStart(2, '0');
  const d = new Date(year, dpState.month - 1, dpState.day, dpState.hour, dpState.min);
  return d.toISOString();
}

// 兼容旧函数
function deadlineOptionToValue(opt) {
  // 不再使用select，直接从picker获取
  return dpToISO();
}

function deadlineToDateOption(dueStr) {
  // 不再使用select，直接回填picker
  dpFromISO(dueStr);
  return '';
}
// Boss头像图片（优先使用图片，fallback到emoji）
const BOSS_IMAGES = Array.from({length: 10}, (_, i) => `/img/boss/boss_${i}.jpg`);
function getBossIcon(idx) {
  return `<img src="${BOSS_IMAGES[idx]}" class="boss-icon-img" onerror="this.style.display='none';this.parentElement.textContent=BOSS_ICONS[${idx}]" alt="${BOSS_NAMES[idx]}">`;
}

function scanForBoss() {
  // 找到第一个 in_progress 的 urgent/high 任务作为 Boss
  const bossTodo = todos.find(t => 
    (t.priority === 'urgent' || t.priority === 'high') && 
    t.status === 'in_progress'
  );
  if (!bossTodo) {
    // 没有 urgent/high 进行中，清除 Boss
    if (gameState.bossId) {
      gameState.bossId = null;
      gameState.bossHP = 0;
      gameState.bossMaxHP = 0;
      saveGameState();
      updateBossDisplay();
    }
    return;
  }
  
  // 同一个 Boss 不重复生成
  if (gameState.bossId === bossTodo.id) return;
  
  // 生成新 Boss
  const pomoCount = getPomoCount(bossTodo);
  const bossHP = Math.max(5, 10 + pomoCount * 2); // 基础10 + 已有番茄×2
  const bossIdx = Math.abs(bossTodo.title.charCodeAt(0)) % BOSS_NAMES.length;
  
  gameState.bossId = bossTodo.id;
  gameState.bossHP = bossHP;
  gameState.bossMaxHP = bossHP;
  gameState.bossName = BOSS_NAMES[bossIdx];
  gameState.bossIcon = BOSS_ICONS[bossIdx];
  gameState.bossSlain = gameState.bossSlain || 0;
  saveGameState();
  updateBossDisplay();
  
  // Boss 出现动画
  showBossAppear(gameState.bossIcon, gameState.bossName, bossHP);
}

function hitBoss() {
  if (!gameState.bossId || gameState.bossHP <= 0) return;
  
  gameState.bossHP--;
  saveGameState();
  updateBossDisplay();
  
  // Boss 受击动画
  const bossEl = $('boss-bar');
  if (bossEl) {
    bossEl.classList.add('boss-hit');
    setTimeout(() => bossEl.classList.remove('boss-hit'), 300);
  }
  playSound('hit');
  
  if (gameState.bossHP <= 0) {
    // Boss 被击败！
    gameState.bossSlain = (gameState.bossSlain || 0) + 1;
    gameState.bossId = null;
    saveGameState();
    showBossDefeated(gameState.bossName);
    addXP(150, '🐉 击败Boss');
    checkAchievements();
    spawnFireworks();
  }
}

function updateBossDisplay() {
  const container = $('boss-container');
  if (!container) return;
  
  if (!gameState.bossId || gameState.bossHP <= 0) {
    container.classList.add('hidden');
    return;
  }
  
  container.classList.remove('hidden');
  const pct = (gameState.bossHP / gameState.bossMaxHP) * 100;
  const bossIdx = BOSS_NAMES.indexOf(gameState.bossName);
  $('boss-icon').innerHTML = bossIdx >= 0 ? getBossIcon(bossIdx) : (gameState.bossIcon || '🐉');
  $('boss-name').textContent = gameState.bossName || '未知Boss';
  $('boss-hp-text').textContent = `HP ${gameState.bossHP}/${gameState.bossMaxHP}`;
  $('boss-hp-bar').style.width = pct + '%';
  
  // HP 低时变红
  const bar = $('boss-hp-bar');
  if (pct <= 30) bar.className = 'boss-hp-fill boss-hp-critical';
  else if (pct <= 60) bar.className = 'boss-hp-fill boss-hp-low';
  else bar.className = 'boss-hp-fill';
}

function showBossAppear(icon, name, hp) {
  const overlay = document.createElement('div');
  overlay.className = 'boss-appear-overlay';
  overlay.innerHTML = `
    <div class="boss-appear-card">
      <div class="boss-appear-icon">${icon}</div>
      <div class="boss-appear-text">⚠️ BOSS 出现！</div>
      <div class="boss-appear-name">${name}</div>
      <div class="boss-appear-hp">HP ${hp}</div>
      <div class="boss-appear-hint">每完成1个番茄 = 攻击1HP<br>击败Boss = +150 XP</div>
    </div>
  `;
  document.body.appendChild(overlay);
  playSound('boss-appear');
  setTimeout(() => {
    overlay.classList.add('fade-out');
    setTimeout(() => overlay.remove(), 600);
  }, 3000);
}

function showBossDefeated(name) {
  const overlay = document.createElement('div');
  overlay.className = 'boss-defeated-overlay';
  overlay.innerHTML = `
    <div class="boss-defeated-card">
      <div class="boss-defeated-text">🎉 BOSS 击败！</div>
      <div class="boss-defeated-name">${name}</div>
      <div class="boss-defeated-reward">+150 XP</div>
    </div>
  `;
  document.body.appendChild(overlay);
  playSound('boss-defeated');
  setTimeout(() => {
    overlay.classList.add('fade-out');
    setTimeout(() => overlay.remove(), 600);
  }, 2500);
}

// ═══════════════════ 随机事件系统 ═══════════════════
// ═══════════════════ 盲盒奖励系统 ═══════════════════
const LOOTBOX_REWARDS = [
  // 运动 (30%) - 随机新手挑战，一键跳转
  { rarity: 'epic', name: '活力药水', icon: '💪', desc: '随机新手运动挑战', prob: 0.30, effect: { type: 'workout', bonus: 50 } },
  // 冥想 (20%) - 5分钟专注呼吸，一键跳转
  { rarity: 'legendary', name: '宁静之书', icon: '🧘', desc: '5分钟专注呼吸', prob: 0.20, effect: { type: 'meditate', bonus: 80 } },
  // 普通 (20%)
  { rarity: 'common', name: '铜币', icon: '🪙', desc: '基础奖励', prob: 0.20, effect: { type: 'xp', value: [10, 30] } },
  // 稀有 (15%)
  { rarity: 'rare', name: '幸运草', icon: '🍀', desc: '双倍XP', prob: 0.15, effect: { type: 'double_xp' } },
  // 神话 (2%)
  { rarity: 'mythic', name: '龙虾之眼', icon: '👁️', desc: 'XP×3 + 成就进度', prob: 0.02, effect: { type: 'jackpot', xp_mult: 3, achievement: true } },
  // 无 (13%)
  { rarity: 'common', name: '', icon: '', desc: '', prob: 0.13, effect: null },
];

const RARITY_COLORS = {
  common: { bg: '#3a3a3a', border: '#555', glow: 'none' },
  rare: { bg: '#1a3a5c', border: '#4a9eff', glow: '0 0 20px rgba(74,158,255,0.5)' },
  epic: { bg: '#3a1a5c', border: '#a855f7', glow: '0 0 30px rgba(168,85,247,0.6)' },
  legendary: { bg: '#5c4a1a', border: '#fbbf24', glow: '0 0 40px rgba(251,191,36,0.7)' },
  mythic: { bg: '#5c1a2a', border: '#ef4444', glow: '0 0 60px rgba(239,68,68,0.8), 0 0 100px rgba(251,191,36,0.5)' },
};

const RARITY_SOUNDS = {
  common: 'hit',
  rare: 'select',
  epic: 'workout-start',
  legendary: 'pomo-complete',
  mythic: 'levelup',
};

let currentLootboxReward = null;

function rollLootbox() {
  const roll = Math.random();
  let cumulative = 0;
  for (const reward of LOOTBOX_REWARDS) {
    cumulative += reward.prob;
    if (roll < cumulative) return reward;
  }
  // 返回空奖励而不是fallback
  return { rarity: 'common', name: '', icon: '', desc: '', prob: 0, effect: null };
}

function showLootbox() {
  currentLootboxReward = rollLootbox();
  
  // 空奖励不弹盲盒
  if (!currentLootboxReward.effect) return;
  
  // 运动/冥想奖励：预选挑战/冥想，显示具体名称
  let rewardDesc = currentLootboxReward.desc;
  let rewardSubtext = '';
  if (currentLootboxReward.effect?.type === 'workout') {
    const easyChallenges = WORKOUT_CHALLENGES.filter(c => c.difficulty === 'easy');
    currentLootboxReward._selectedChallenge = easyChallenges[Math.floor(Math.random() * easyChallenges.length)];
    if (currentLootboxReward._selectedChallenge) {
      rewardDesc = currentLootboxReward._selectedChallenge.name;
      rewardSubtext = `<div class="lootbox-reward-sub">即将开始 · ${currentLootboxReward._selectedChallenge.duration}分钟</div>`;
    }
  } else if (currentLootboxReward.effect?.type === 'meditate') {
    currentLootboxReward._selectedSession = MEDITATE_SESSIONS.find(s => s.id === 'focus5');
    if (currentLootboxReward._selectedSession) {
      rewardDesc = currentLootboxReward._selectedSession.name;
      rewardSubtext = `<div class="lootbox-reward-sub">即将开始 · 5分钟</div>`;
    }
  }
  
  let panel = $('lootbox-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'lootbox-panel';
    panel.className = 'lootbox-panel hidden';
    document.body.appendChild(panel);
  }
  
  panel.innerHTML = `
    <div class="lootbox-backdrop"></div>
    <div class="lootbox-container">
      <div class="lootbox-card" id="lootbox-card" tabindex="0">
        <div class="lootbox-card-inner">
          <div class="lootbox-card-front">
            <div class="lootbox-mystery-icon">🎁</div>
            <div class="lootbox-hint">按 Enter / 点击开启</div>
          </div>
          <div class="lootbox-card-back">
            <div class="lootbox-reward-icon">${currentLootboxReward.icon}</div>
            <div class="lootbox-reward-name">${currentLootboxReward.name}</div>
            <div class="lootbox-reward-desc">${rewardDesc}</div>
            ${rewardSubtext}
            <div class="lootbox-reward-rarity ${currentLootboxReward.rarity}">${getRarityLabel(currentLootboxReward.rarity)}</div>
          </div>
        </div>
      </div>
      <div class="lootbox-particles" id="lootbox-particles"></div>
    </div>
  `;
  
  // 点击/触屏支持
  $('lootbox-card').addEventListener('click', () => openLootbox());
  
  panel.classList.remove('hidden');
  focusMode = 'lootbox';
  playSound('select');
}

function getRarityLabel(rarity) {
  const labels = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说', mythic: '神话' };
  return labels[rarity] || rarity;
}

let lootboxJumpPending = false; // 跳转等待中，禁止关闭

function openLootbox() {
  const card = $('lootbox-card');
  if (!card || card.classList.contains('opened')) return;
  
  card.classList.add('opened');
  playSound(RARITY_SOUNDS[currentLootboxReward.rarity]);
  
  // 运动/冥想奖励标记跳转等待
  const isJumpReward = currentLootboxReward.effect?.type === 'workout' || currentLootboxReward.effect?.type === 'meditate';
  if (isJumpReward) lootboxJumpPending = true;
  
  // 延迟显示奖励详情
  setTimeout(() => {
    applyLootboxReward(currentLootboxReward);
    spawnLootboxParticles(currentLootboxReward.rarity);
  }, 800);
  
  // 非跳转奖励3.5秒后自动关闭
  if (!isJumpReward) {
    setTimeout(() => {
      closeLootbox();
    }, 3500);
  }
}

function applyLootboxReward(reward) {
  const effect = reward.effect;
  
  switch (effect.type) {
    case 'xp':
      const xp = effect.value[0] + Math.floor(Math.random() * (effect.value[1] - effect.value[0]));
      addXP(xp, `${reward.icon} ${reward.name}`);
      break;
    case 'double_xp':
      addXP(XP_REWARDS.pomo, '🍀 幸运');
      break;
    case 'pomo_short':
      gameState.activeBuffs.push({ type: 'pomo_short', expires: Date.now() + 30*60*1000 });
      saveGameState();
      break;
    case 'workout':
      addXP(effect.bonus, '💪 活力');
      // 使用预选的新手挑战直接跳转
      {
        const ch = currentLootboxReward._selectedChallenge;
        if (ch) {
          setTimeout(() => {
            lootboxJumpPending = false;
            // 直接关闭盲盒面板（不走closeLootbox的guard）
            const panel = $('lootbox-panel');
            if (panel) panel.classList.add('hidden');
            currentLootboxReward = null;
            startWorkout(ch);
          }, 1500);
          return;
        }
      }
      break;
    case 'meditate':
      addXP(effect.bonus, '🧘 宁静');
      // 使用预选的5分钟专注呼吸直接跳转
      {
        const s = currentLootboxReward._selectedSession;
        if (s) {
          setTimeout(() => {
            lootboxJumpPending = false;
            const panel = $('lootbox-panel');
            if (panel) panel.classList.add('hidden');
            currentLootboxReward = null;
            startMeditate(s);
          }, 1500);
          return;
        }
      }
      break;
    case 'jackpot':
      const jackpotXP = Math.floor(XP_REWARDS.pomo * effect.xp_mult);
      addXP(jackpotXP, '👁️ 神话大奖');
      updateDailyProgress('pomo_3', 2);
      updateDailyProgress('pomo_5', 2);
      break;
  }
}

function spawnLootboxParticles(rarity) {
  const container = $('lootbox-particles');
  if (!container) return;
  
  const colors = {
    common: ['#666'],
    rare: ['#4a9eff', '#60a5fa'],
    epic: ['#a855f7', '#c084fc'],
    legendary: ['#fbbf24', '#fcd34d'],
    mythic: ['#ef4444', '#fbbf24', '#a855f7'],
  };
  
  const particleCount = rarity === 'mythic' ? 40 : rarity === 'legendary' ? 25 : 15;
  const particleColors = colors[rarity] || colors.common;
  
  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'lootbox-particle';
    particle.style.background = particleColors[Math.floor(Math.random() * particleColors.length)];
    const angle = Math.random() * Math.PI * 2;
    const distance = 100 + Math.random() * 200;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    particle.style.left = '50%';
    particle.style.top = '50%';
    particle.style.animationDelay = (Math.random() * 0.3) + 's';
    particle.style.setProperty('--dx', dx + 'px');
    particle.style.setProperty('--dy', dy + 'px');
    container.appendChild(particle);
    
    setTimeout(() => particle.remove(), 1500);
  }
}

function closeLootbox() {
  if (lootboxJumpPending) return; // 跳转等待中，禁止关闭
  const panel = $('lootbox-panel');
  if (panel) panel.classList.add('hidden');
  focusMode = 'kanban';
  currentLootboxReward = null;
  document.title = '🦞 Claw Todo';
  updateFocus();
  updateStatusBar();
}

function handleLootboxNav(e) {
  if (e.repeat) return;
  if (lootboxJumpPending) { e.preventDefault(); return; } // 跳转等待中，忽略所有按键
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openLootbox();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeLootbox();
  }
}

// ═══════════════════ 随机事件系统（保留兼容） ═══════════════════
const RANDOM_EVENTS = [
  { id: 'lucky',     name: '🍀 幸运番茄',  desc: '双倍XP！',        prob: 0.20, effect: 'double_xp' },
  { id: 'speed',     name: '⚡ 闪电冲刺',  desc: '下个番茄15分钟',  prob: 0.10, effect: 'pomo_short' },
  { id: 'gift',      name: '🎁 神秘宝箱',  desc: '额外50XP！',      prob: 0.05, effect: 'bonus_xp' },
  { id: 'rest',      name: '😴 休息一下',  desc: '下次休息10分钟',  prob: 0.15, effect: 'long_rest' },
  { id: 'nothing',   name: '',              desc: '',                prob: 0.50, effect: null },
];

function rollRandomEvent() {
  const roll = Math.random();
  let cumulative = 0;
  for (const evt of RANDOM_EVENTS) {
    cumulative += evt.prob;
    if (roll < cumulative) {
      if (evt.effect) {
        applyRandomEvent(evt);
        return evt;
      }
      return null;
    }
  }
  return null;
}

function applyRandomEvent(evt) {
  switch (evt.effect) {
    case 'double_xp':
      // 已经在 completePomodoro 里处理 combo，这里额外加一倍基础XP
      addXP(XP_REWARDS.pomo, '🍀 幸运');
      break;
    case 'pomo_short':
      gameState.activeBuffs.push({ type: 'pomo_short', expires: Date.now() + 30*60*1000, data: {} });
      saveGameState();
      break;
    case 'bonus_xp':
      addXP(50, '🎁 宝箱');
      break;
    case 'long_rest':
      gameState.activeBuffs.push({ type: 'long_rest', expires: Date.now() + 60*60*1000, data: {} });
      saveGameState();
      break;
  }
  showRandomEventPopup(evt);
}

function showRandomEventPopup(evt) {
  const el = document.createElement('div');
  el.className = 'random-event-popup';
  el.innerHTML = `
    <div class="random-event-icon">${evt.name.split(' ')[0]}</div>
    <div class="random-event-name">${evt.name}</div>
    <div class="random-event-desc">${evt.desc}</div>
  `;
  document.body.appendChild(el);
  playSound('event');
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 500);
  }, 2500);
}

// ═══════════════════ 每日挑战系统 ═══════════════════
const DAILY_TYPES = [
  { type: 'pomo_3',   desc: '完成3个番茄',     target: 3, reward: 75,  icon: '🍅' },
  { type: 'pomo_5',   desc: '完成5个番茄',     target: 5, reward: 150, icon: '🍅' },
  { type: 'complete_1', desc: '完成1个任务',   target: 1, reward: 100, icon: '✅' },
  { type: 'combo_3',  desc: '达成3连击',       target: 3, reward: 100, icon: '⚡' },
];

function generateDailyChallenge() {
  const today = new Date().toDateString();
  if (gameState.dailyChallenge?.date === today) return; // 今天已生成
  
  // 用日期做种子，每天固定同一个挑战
  const seed = new Date().getDate() + new Date().getMonth() * 31;
  const daily = DAILY_TYPES[seed % DAILY_TYPES.length];
  gameState.dailyChallenge = { ...daily, progress: 0, date: today };
  gameState.dailiesDone = gameState.dailiesDone || 0;
  saveGameState();
}

function updateDailyProgress(type, value) {
  if (!gameState.dailyChallenge) return;
  if (gameState.dailyChallenge.type === type) {
    gameState.dailyChallenge.progress = Math.min(
      gameState.dailyChallenge.progress + value,
      gameState.dailyChallenge.target
    );
    if (gameState.dailyChallenge.progress >= gameState.dailyChallenge.target) {
      // 挑战完成！
      addXP(gameState.dailyChallenge.reward, '📅 日课');
      gameState.dailiesDone = (gameState.dailiesDone || 0) + 1;
      gameState.dailyChallenge.completed = true;
      checkAchievements();
      showDailyComplete(gameState.dailyChallenge);
    }
    saveGameState();
    updateDailyDisplay();
  }
}

function updateDailyDisplay() {
  const el = $('daily-display');
  if (!el) return;
  const dc = gameState.dailyChallenge;
  if (!dc) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const pct = dc.completed ? 100 : Math.floor((dc.progress / dc.target) * 100);
  el.innerHTML = `
    <span class="daily-icon">${dc.icon}</span>
    <span class="daily-desc">${dc.desc}</span>
    <span class="daily-progress">${dc.progress}/${dc.target}</span>
    <div class="daily-bar"><div class="daily-bar-fill" style="width:${pct}%"></div></div>
  `;
  if (dc.completed) el.classList.add('daily-done');
  else el.classList.remove('daily-done');
}

function showDailyComplete(dc) {
  const el = document.createElement('div');
  el.className = 'daily-complete-popup';
  el.innerHTML = `
    <div class="daily-complete-icon">📅</div>
    <div class="daily-complete-text">日课完成！</div>
    <div class="daily-complete-desc">${dc.desc}</div>
    <div class="daily-complete-reward">+${dc.reward} XP</div>
  `;
  document.body.appendChild(el);
  playSound('achievement');
  spawnParticles('📅', 12);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 500);
  }, 2500);
}

// ═══════════════════ Lobster 协议 ═══════════════════
// 小龙虾通过 metadata._lobster_* 字段与网页端通信
// 网页端 loadTodos 时自动扫描处理

function processLobsterProtocol() {
  for (const todo of todos) {
    const meta = todo.metadata || {};
    
    // 处理信件 _lobster_mail
    if (meta._lobster_mail && !meta._lobster_mail_read) {
      const mail = meta._lobster_mail;
      gameState.lobsterMails.push({ ...mail, todoId: todo.id });
      showLobsterMail(mail);
      // 标记已读（PATCH 回服务器）
      const newMeta = { ...meta, _lobster_mail_read: true };
      fetchJSON(`${API.todos}/${todo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ metadata: newMeta })
      });
    }
    
    // 处理礼物 _lobster_gift
    if (meta._lobster_gift && !meta._lobster_gift_claimed) {
      const gift = meta._lobster_gift;
      gameState.lobsterGifts.push({ ...gift, todoId: todo.id });
      showLobsterGift(gift, todo.id);
    }
    
    // 处理悬赏 _lobster_bounty
    if (meta._lobster_bounty && !meta._lobster_bounty_completed) {
      const bounty = meta._lobster_bounty;
      if (!gameState.lobsterBounty || gameState.lobsterBounty.id !== bounty.title) {
        gameState.lobsterBounty = {
          id: bounty.title,
          desc: bounty.desc,
          target: bounty.target,
          progress: 0,
          reward_xp: bounty.reward_xp || 100,
          reward_achievement: bounty.reward_achievement,
          expires: bounty.expires,
          todoId: todo.id
        };
        showLobsterBounty(bounty);
      }
    }
  }
  saveGameState();
}

function showLobsterMail(mail) {
  const el = document.createElement('div');
  el.className = 'lobster-mail-popup';
  el.innerHTML = `
    <div class="lobster-avatar">🦞</div>
    <div class="lobster-mail-bubble">
      <div class="lobster-mail-from">${mail.from || '小龙虾'}</div>
      <div class="lobster-mail-msg">${mail.message}</div>
    </div>
  `;
  document.body.appendChild(el);
  playSound('event');
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 500);
  }, 4000);
}

function showLobsterGift(gift, todoId) {
  const el = document.createElement('div');
  el.className = 'lobster-gift-popup';
  el.innerHTML = `
    <div class="lobster-avatar">🦞</div>
    <div class="lobster-gift-content">
      <div class="lobster-gift-label">小龙虾送你一份礼物！</div>
      <div class="lobster-gift-item">${gift.item}</div>
      <div class="lobster-gift-desc">${gift.desc}</div>
      <button class="lobster-gift-claim" onclick="claimLobsterGift('${todoId}')">领取</button>
    </div>
  `;
  document.body.appendChild(el);
  playSound('event');
}

function claimLobsterGift(todoId) {
  const todo = todos.find(t => t.id === todoId);
  if (!todo) return;
  const meta = { ...todo.metadata };
  const gift = meta._lobster_gift;
  
  // 激活效果
  if (gift.effect === 'pomo_short') {
    gameState.activeBuffs.push({ type: 'pomo_short', expires: Date.now() + 60*60*1000, data: {} });
  } else if (gift.effect === 'double_xp') {
    gameState.activeBuffs.push({ type: 'double_xp', expires: Date.now() + 60*60*1000, data: {} });
  }
  
  // 标记已领取
  meta._lobster_gift_claimed = true;
  fetchJSON(`${API.todos}/${todoId}`, {
    method: 'PATCH',
    body: JSON.stringify({ metadata: meta })
  });
  
  // 移除弹窗
  document.querySelectorAll('.lobster-gift-popup').forEach(el => el.remove());
  toast(`已领取 ${gift.item}！`);
  playSound('success');
  saveGameState();
}

function showLobsterBounty(bounty) {
  const el = document.createElement('div');
  el.className = 'lobster-bounty-popup';
  el.innerHTML = `
    <div class="lobster-avatar">🦞</div>
    <div class="lobster-bounty-content">
      <div class="lobster-bounty-label">⚔️ 悬赏任务</div>
      <div class="lobster-bounty-title">${bounty.title}</div>
      <div class="lobster-bounty-desc">${bounty.desc}</div>
      <div class="lobster-bounty-reward">奖励: +${bounty.reward_xp || 100}XP</div>
    </div>
  `;
  document.body.appendChild(el);
  playSound('boss-appear');
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 500);
  }, 3500);
}

// ═══════════════════ Buff 检查 ═══════════════════
function getActivePomoDuration() {
  // 检查是否有 pomo_short buff
  const now = Date.now();
  gameState.activeBuffs = gameState.activeBuffs.filter(b => b.expires > now);
  if (gameState.activeBuffs.some(b => b.type === 'pomo_short')) {
    return 15 * 60; // 15分钟
  }
  return POMO_DURATION;
}

// 游戏化核心函数
function addXP(amount, reason) {
  // 检查buff（活力+20% / 禅定+30%）
  let bonus = 0;
  let bonusTag = '';
  if (gameState.activeBuffs) {
    gameState.activeBuffs = gameState.activeBuffs.filter(b => !b.expires || b.expires > Date.now());
    const vitalityBuff = gameState.activeBuffs.find(b => b.type === 'vitality');
    if (vitalityBuff && vitalityBuff.data && vitalityBuff.data.xpBonus) {
      bonus += Math.round(amount * vitalityBuff.data.xpBonus);
      bonusTag = '💪';
    }
    const zenBuff = gameState.activeBuffs.find(b => b.type === 'zen');
    if (zenBuff && zenBuff.data && zenBuff.data.xpBonus) {
      bonus += Math.round(amount * zenBuff.data.xpBonus);
      bonusTag = bonusTag ? '💪🧘' : '🧘';
    }
  }
  const total = amount + bonus;
  gameState.xp += total;
  const needed = xpForLevel(gameState.level);
  
  // 升级检测
  while (gameState.xp >= needed && gameState.level < 10) {
    gameState.xp -= xpForLevel(gameState.level);
    gameState.level++;
    showLevelUp(gameState.level); // 内部已含playSound('levelup')
  }
  
  saveGameState();
  updateGameUI();
  showXPFloat(total, reason + (bonus > 0 ? ` (+${bonus}${bonusTag})` : '')); // 内部无音效
  playSound('xp');
}

function checkAchievements(extraState = {}) {
  const gs = { ...gameState, ...extraState };
  for (const ach of ACHIEVEMENTS) {
    if (!gameState.achievements.includes(ach.id) && ach.check(gs)) {
      gameState.achievements.push(ach.id);
      showAchievementUnlocked(ach); // 内部已含playSound('achievement')
      saveGameState();
    }
  }
}

let _gameStateSaveTimer = null;
function saveGameState() {
  localStorage.setItem('clawGameState', JSON.stringify(gameState));
  // 防抖同步到服务端（3秒内只发一次，避免频繁请求）
  clearTimeout(_gameStateSaveTimer);
  _gameStateSaveTimer = setTimeout(async () => {
    try {
      await fetchJSON('/api/game-state', {
        method: 'POST',
        body: JSON.stringify({ state: gameState })
      });
    } catch(e) { /* 静默失败，本地已保存 */ }
  }, 3000);
}

async function loadGameState() {
  try {
    // 优先从服务端加载（多端同步）
    const res = await fetchJSON('/api/game-state');
    if (res.state) {
      gameState = { ...gameState, ...res.state };
    } else {
      // 服务端无数据，用 localStorage
      const saved = JSON.parse(localStorage.getItem('clawGameState'));
      if (saved) gameState = { ...gameState, ...saved };
    }
  } catch(e) {
    // 离线时回退到 localStorage
    const saved = JSON.parse(localStorage.getItem('clawGameState'));
    if (saved) gameState = { ...gameState, ...saved };
  }
  // 重置今日番茄计数
  const today = new Date().toDateString();
  if (gameState.todayDate !== today) {
    gameState.todayPomo = 0;
    gameState.todayWorkouts = 0;
    gameState.todayMeditations = 0;
    gameState.todayDate = today;
    gameState.streak = 0;
  }
  // 同步到本地
  localStorage.setItem('clawGameState', JSON.stringify(gameState));
}

// 卡片稀有度（基于番茄数和优先级）
function getCardRarity(todo) {
  const pomo = getPomoCount(todo);
  if (todo.priority === 'urgent') return 'legendary';
  if (todo.priority === 'high' || pomo >= 5) return 'epic';
  if (pomo >= 3) return 'rare';
  return 'common';
}

const RARITY_STYLES = {
  common:   { border: '#3b82f6', glow: 'rgba(59,130,246,0.3)',  label: '普通', stars: '★' },
  rare:     { border: '#8b5cf6', glow: 'rgba(139,92,246,0.4)',  label: '稀有', stars: '★★' },
  epic:     { border: '#f59e0b', glow: 'rgba(245,158,11,0.4)',  label: '史诗', stars: '★★★' },
  legendary:{ border: '#ef4444', glow: 'rgba(239,68,68,0.5)',   label: '传说', stars: '★★★★' }
};

const $ = id => document.getElementById(id);
const $q = sel => document.querySelectorAll(sel);

// ═══════════════════ 音效系统 ═══════════════════
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playSound(type) {
  if (!soundEnabled) return;
  ensureAudio();
  const now = audioCtx.currentTime;

  switch(type) {
    case 'move': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.05);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.08);
      break;
    }
    case 'select': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1200, now + 0.06);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.12);
      break;
    }
    case 'confirm': {
      [880, 1320].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.15);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + i * 0.08); osc.stop(now + i * 0.08 + 0.15);
      });
      break;
    }
    case 'cancel': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.12);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.15);
      break;
    }
    case 'slide': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.15);
      break;
    }
    case 'error': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = 200;
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.2);
      break;
    }
    case 'success': {
      [660, 880, 1100].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.2);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + i * 0.1); osc.stop(now + i * 0.1 + 0.2);
      });
      break;
    }
    case 'pomo-tick': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.05);
      break;
    }
    case 'pomo-complete': {
      // 番茄完成 - 华丽的三连音 + 和弦
      const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = now + i * 0.15;
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t); osc.stop(t + 0.4);
      });
      break;
    }
    case 'pomo-pause': {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(500, now);
      osc.frequency.exponentialRampToValueAtTime(350, now + 0.15);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.2);
      break;
    }
    case 'levelup': {
      // 升级！华丽的上升音阶
      const notes = [262, 330, 392, 523, 659, 784, 1047]; // C4到C6
      notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = now + i * 0.08;
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t); osc.stop(t + 0.3);
      });
      break;
    }
    case 'achievement': {
      // 成就解锁 - 闪亮叮咚
      [880, 1100, 1320, 1760].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = now + i * 0.1;
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t); osc.stop(t + 0.25);
      });
      break;
    }
    case 'xp': {
      // XP获得 - 小叮
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1200;
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.1);
      break;
    }
    case 'hit': {
      // Boss受击 - 短促打击感
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.12);
      break;
    }
    case 'boss-appear': {
      // Boss出现 - 低沉警告
      [150, 120, 100].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.12, now + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.2);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + i * 0.15); osc.stop(now + i * 0.15 + 0.2);
      });
      break;
    }
    case 'boss-defeated': {
      // Boss击败 - 胜利号角
      [523, 659, 784, 1047].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.1, now + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.25);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + i * 0.12); osc.stop(now + i * 0.12 + 0.25);
      });
      break;
    }
    case 'event': {
      // 随机事件 - 神秘叮
      [660, 880, 1100].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.08, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.15);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + i * 0.08); osc.stop(now + i * 0.08 + 0.15);
      });
      break;
    }
    case 'workout-start': {
      // 运动开始 - 充满能量的三连升
      [440, 554, 659, 880].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        const t = now + i * 0.1;
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t); osc.stop(t + 0.2);
      });
      break;
    }
    case 'workout-exercise': {
      // 动作开始 - 清脆叮
      [880, 1320].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = now + i * 0.08;
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t); osc.stop(t + 0.15);
      });
      break;
    }
    case 'workout-rest': {
      // 休息开始 - 柔和下降
      [660, 440].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = now + i * 0.12;
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t); osc.stop(t + 0.2);
      });
      break;
    }
    case 'workout-countdown': {
      // 倒计时3-2-1 - 短促嘟
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 700;
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.08);
      break;
    }
    case 'workout-complete': {
      // 运动完成 - 激昂凯旋
      [523, 659, 784, 1047, 1319, 1568].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        const t = now + i * 0.08;
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t); osc.stop(t + 0.35);
      });
      break;
    }
    case 'workout-half': {
      // 过半提示 - 两声叮
      [880, 1100].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = now + i * 0.15;
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t); osc.stop(t + 0.2);
      });
      break;
    }
    case 'meditate-bowl': {
      // 颂钵音 - 低频基音+丰富泛音+超长衰减（8-10秒，先保持再衰减）
      const bowlFreqs = [
        { f: 110, v: 0.25, hold: 2.0, dur: 10.0, type: 'sine' },     // A2 基音，最持久
        { f: 220, v: 0.20, hold: 1.5, dur: 9.0, type: 'sine' },      // A3
        { f: 330, v: 0.15, hold: 1.0, dur: 8.0, type: 'sine' },      // E4
        { f: 440, v: 0.12, hold: 0.8, dur: 7.0, type: 'sine' },      // A4
        { f: 660, v: 0.08, hold: 0.5, dur: 5.5, type: 'sine' },      // E5
        { f: 880, v: 0.05, hold: 0.3, dur: 4.0, type: 'sine' },      // A6 高泛音，先消
        { f: 165, v: 0.06, hold: 1.2, dur: 8.5, type: 'triangle' },  // 不谐和泛音，金属质感
        { f: 277, v: 0.04, hold: 0.8, dur: 7.0, type: 'triangle' },  // C#4 不谐和
      ];
      bowlFreqs.forEach((p, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = p.type;
        osc.frequency.value = p.f;
        const t = now + i * 0.03;
        // 先保持音量，再线性衰减
        gain.gain.setValueAtTime(p.v, t);
        gain.gain.setValueAtTime(p.v, t + p.hold); // 保持阶段
        gain.gain.linearRampToValueAtTime(0.001, t + p.dur); // 线性衰减
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t); osc.stop(t + p.dur);
      });
      // 拍频效果（双频叠加，2Hz缓慢脉动）
      const beat1 = audioCtx.createOscillator();
      const beat2 = audioCtx.createOscillator();
      const beatGain = audioCtx.createGain();
      beat1.type = 'sine'; beat1.frequency.value = 110;
      beat2.type = 'sine'; beat2.frequency.value = 112; // 2Hz拍频
      beatGain.gain.setValueAtTime(0.10, now);
      beatGain.gain.setValueAtTime(0.10, now + 2.0);
      beatGain.gain.linearRampToValueAtTime(0.001, now + 8.0);
      beat1.connect(beatGain).connect(audioCtx.destination);
      beat2.connect(beatGain);
      beat1.start(now); beat1.stop(now + 8.0);
      beat2.start(now); beat2.stop(now + 8.0);
      break;
    }
    case 'meditate-breathe': {
      // 呼吸切换提示 - 柔和钟声
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 528; // C5 治愈频率
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.8);
      break;
    }
    case 'meditate-gong': {
      // 冥想完成 - 深沉铜锣（8-10秒，先保持再衰减）
      const gongFreqs = [
        { f: 82,  v: 0.22, hold: 2.5, dur: 10.0, type: 'sine' },     // E2 超低频震动
        { f: 110, v: 0.18, hold: 2.0, dur: 9.5, type: 'sine' },      // A2
        { f: 165, v: 0.12, hold: 1.5, dur: 8.5, type: 'triangle' },  // E3
        { f: 220, v: 0.10, hold: 1.0, dur: 7.5, type: 'sine' },      // A3
        { f: 330, v: 0.06, hold: 0.8, dur: 6.0, type: 'triangle' },  // E4
        { f: 440, v: 0.04, hold: 0.5, dur: 5.0, type: 'sine' },      // A4
      ];
      gongFreqs.forEach((p, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = p.type;
        osc.frequency.value = p.f;
        const t = now + i * 0.05;
        gain.gain.setValueAtTime(p.v, t);
        gain.gain.setValueAtTime(p.v, t + p.hold);
        gain.gain.linearRampToValueAtTime(0.001, t + p.dur);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t); osc.stop(t + p.dur);
      });
      break;
    }
  }
}

// ═══════════════════ 初始化 ═══════════════════
document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadGameState(); // 加载游戏进度（含服务端同步）
  const status = await fetchJSON(API.authStatus);
  if (!status?.setup) {
    showSetup();
    focusMode = 'auth';
  } else if (token) {
    await loadTodos();
    connectWS();
    showApp();
    focusMode = 'kanban';
    renderView();
  } else {
    showLogin();
    focusMode = 'auth';
  }
  setupEventListeners();
  setupOfflineHandler();
  setupKeyboardNav();
  initVoiceInput();
  // 预加载语音引擎（某些浏览器需要用户交互后才能用）
  if (window.speechSynthesis) {
    speechSynthesis.getVoices(); // 触发加载
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  }
  // 初始化自定义选择器
  initCustomSelects();
  // 初始化BGM UI（默认静音，防止刷新后显示旧状态）
  bgmUpdateUI();
}

// ═══════════════════ Auth ═══════════════════
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
    focusMode = 'kanban';
    renderView();
    playSound('success');
  } else {
    showError(res?.error || '创建失败');
    playSound('error');
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
    focusMode = 'kanban';
    renderView();
    playSound('success');
  } else {
    showError(res?.error || '登录失败');
    playSound('error');
  }
}

function showError(msg) {
  const el = $('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// ═══════════════════ 数据 ═══════════════════
async function loadTodos() {
  const res = await fetchJSON(API.todos);
  if (Array.isArray(res)) {
    todos = res;
    // === 游戏化系统集成 ===
    scanForBoss();           // Boss 战扫描
    processLobsterProtocol(); // Lobster 协议处理
    generateDailyChallenge(); // 每日挑战生成
    renderView();
  }
}

function getColItems(status) {
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
  return todos
    .filter(t => t.status === status)
    .sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 2;
      const pb = priorityOrder[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at) - new Date(a.created_at);
    });
}

function getPomoCount(todo) {
  if (!todo.metadata || typeof todo.metadata !== 'object') return 0;
  return parseInt(todo.metadata.pomodoro_count || 0, 10);
}

// ═══════════════════ 双栏视图渲染 ═══════════════════
function renderView() {
  const leftStatus = COLUMNS[viewOffset];
  const rightStatus = COLUMNS[viewOffset + 1];
  const leftMeta = COL_META[leftStatus];
  const rightMeta = COL_META[rightStatus];

  $('left-icon').textContent = leftMeta.icon;
  $('left-title').textContent = leftMeta.name;
  $('left-count').textContent = getColItems(leftStatus).length;
  $('right-icon').textContent = rightMeta.icon;
  $('right-title').textContent = rightMeta.name;
  $('right-count').textContent = getColItems(rightStatus).length;

  renderColumnCards('col-left', leftStatus);
  renderColumnCards('col-right', rightStatus);

  updateFocus();
  updateStatusBar();
}

function renderColumnCards(containerId, status) {
  const container = $(containerId);
  const items = getColItems(status);

  if (items.length === 0) {
    container.innerHTML = `<div class="column-empty">暂无${COL_META[status].name}</div>`;
    return;
  }

  container.innerHTML = items.map((t, idx) => renderCard(t, status, idx)).join('');
}

function renderCard(t, status, rowIdx) {
  const pri = PRI_LABELS[t.priority] || '普';
  const due = t.due ? formatDate(t.due) : '';
  const isOverdue = t.due && new Date(t.due) < new Date(new Date().toDateString());
  const isFocused = isCardFocused(status, rowIdx);
  const pomoCount = getPomoCount(t);
  const pomoHtml = pomoCount > 0
    ? `<span class="pomo-count">🍅×${pomoCount}</span>`
    : '';
  
  // 稀有度系统
  const rarity = getCardRarity(t);
  const rs = RARITY_STYLES[rarity];
  
  return `
    <div class="todo-card ${t.status} priority-${t.priority} rarity-${rarity} ${isFocused ? 'focused' : ''}"
         data-id="${t.id}"
         data-status="${status}"
         data-row="${rowIdx}"
         onclick="onCardClick('${t.id}', '${status}', ${rowIdx})">
      <div class="rarity-badge" style="color:${rs.border}">${rs.stars}</div>
      <div class="todo-title">${escapeHtml(t.title)}</div>
      <div class="todo-meta">
        <span class="pri ${t.priority}">${pri}</span>
        ${pomoHtml}
        ${due ? `<span class="due${isOverdue ? ' overdue' : ''}">${isOverdue ? '⚠' : ''}${due}</span>` : ''}
      </div>
    </div>
  `;
}

function isCardFocused(status, rowIdx) {
  if (focusMode !== 'kanban') return false;
  const focusedStatus = COLUMNS[viewOffset + activeCol];
  return status === focusedStatus && currentRow === rowIdx;
}

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  const now = new Date();
  const diff = date - now;
  const days = Math.floor(diff / 86400000);
  const hasTime = d.length > 10 && d.includes('T');
  const timeStr = hasTime ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
  if (days === 0) return timeStr ? `今天 ${timeStr}` : '今天';
  if (days === 1) return timeStr ? `明天 ${timeStr}` : '明天';
  if (days === -1) return '昨天';
  if (days > 0 && days <= 7) return timeStr ? `${days}天后 ${timeStr}` : `${days}天后`;
  if (days < 0 && days >= -7) return `${-days}天前`;
  const dateStr = date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  return timeStr ? `${dateStr} ${timeStr}` : dateStr;
}

// ═══════════════════ 键盘导航 ═══════════════════
function setupKeyboardNav() {
  document.addEventListener('keydown', (e) => {
    // 首次按键时初始化音频（浏览器要求用户交互）
    ensureAudioCtx();
    handleKeyNav(e);
  });
}

function ensureAudioCtx() {
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) audioCtx = new AudioCtx();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// ═══════════════════ 通用列表导航框架 ═══════════════════
// 所有子界面共享同一套：聚焦/选择/滚动/音效/退出
class ListNav {
  constructor(opts) {
    this.containerId = opts.container;  // 列表容器 DOM id
    this.itemSelector = opts.item || '.nav-item';  // 列表项选择器
    this.focusedClass = opts.focusedClass || 'nav-focused';
    this.idx = 0;          // 当前选中索引
    this.onSelect = opts.onSelect || (() => {});   // Enter回调
    this.onEscape = opts.onEscape || (() => {});   // Esc回调
    this.onFilter = opts.onFilter || null;          // ←→ 过滤回调
    this.vertical = opts.vertical !== false;         // 默认垂直列表
  }

  handleKey(e) {
    const prev = opts => opts; // dummy for chaining
    const container = $(this.containerId);
    if (!container) return false;
    const items = container.querySelectorAll(this.itemSelector);
    const max = items.length - 1;
    if (max < 0) return false;

    const prevKey = this.vertical ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = this.vertical ? 'ArrowDown' : 'ArrowRight';

    switch(e.key) {
      case prevKey:
        e.preventDefault();
        if (this.idx > 0) { this.idx--; playSound('move'); }
        else { playSound('error'); }
        this.updateFocus(items);
        return true;

      case nextKey:
        e.preventDefault();
        if (this.idx < max) { this.idx++; playSound('move'); }
        else { playSound('error'); }
        this.updateFocus(items);
        return true;

      case 'Enter':
      case ' ':
        e.preventDefault();
        playSound('select');
        this.onSelect(this.idx, items[this.idx]);
        return true;

      case 'Escape':
        e.preventDefault();
        playSound('cancel');
        this.onEscape();
        return true;

      // ←→ 在垂直列表中用于过滤
      case 'ArrowLeft':
        if (this.vertical && this.onFilter) {
          e.preventDefault();
          this.onFilter('left');
          return true;
        }
        break;
      case 'ArrowRight':
        if (this.vertical && this.onFilter) {
          e.preventDefault();
          this.onFilter('right');
          return true;
        }
        break;
    }
    return false; // 未处理
  }

  updateFocus(items) {
    if (!items) {
      const container = $(this.containerId);
      if (!container) return;
      items = container.querySelectorAll(this.itemSelector);
    }
    items.forEach((el, i) => {
      el.classList.toggle(this.focusedClass, i === this.idx);
    });
    // 滚动到选中项
    if (items[this.idx]) {
      items[this.idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  reset() { this.idx = 0; }
}

function handleKeyNav(e) {
  // modal + input 焦点时，只允许导航键和语音键通过，其他字符键正常输入
  if (focusMode === 'modal' && isInputFocused()) {
    const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Escape', ' '];
    if (!navKeys.includes(e.key)) return; // 字符键直接输入，不进handleModalNav
  }

  const key = e.key;

  // 全局模式路由（非kanban区域直接走各模式handler）
  if (focusMode === 'voice-recording') { handleVoiceRecordingNav(e); return; }
  if (focusMode === 'pomo-mode-select') { handlePomoModeSelectNav(e); return; }
  if (focusMode === 'mini-pomo-done') { handleMiniPomoDoneNav(e); return; }
  if (focusMode === 'roulette') { handleRouletteNav(e); return; }
  if (focusMode === 'modal') { handleModalNav(e); return; }
  if (focusMode === 'settings') { handleSettingsNav(e); return; }
  if (focusMode === 'action-menu') { handleActionMenuNav(e); return; }
  if (focusMode === 'pomodoro') { handlePomodoroNav(e); return; }
  if (focusMode === 'celebrate') { handleCelebrateNav(e); return; }
  if (focusMode === 'lootbox') { handleLootboxNav(e); return; }
  if (focusMode === 'workout-select') { handleWorkoutSelectNav(e); return; }
  if (focusMode === 'workout') { handleWorkoutNav(e); return; }
  if (focusMode === 'workout-complete') { handleWorkoutCompleteNav(e); return; }
  if (focusMode === 'meditate-select') { handleMeditateSelectNav(e); return; }
  if (focusMode === 'meditate') { handleMeditateNav(e); return; }
  if (focusMode === 'meditate-complete') { handleMeditateCompleteNav(e); return; }
  if (focusMode === 'xp-panel' || focusMode === 'achieve-panel') { handleInfoPanelNav(e); return; }
  if (focusMode === 'auth') return; // 登录页用原生tab

  // focusMode === 'kanban' 时，按 focusZone 路由
  if (focusZone === 'header') {
    handleHeaderNav(e);
  } else if (focusZone === 'kanban') {
    handleKanbanNav(e);
  } else if (focusZone === 'statusbar') {
    handleStatusBarNav(e);
  }
}

function isInputFocused() {
  const active = document.activeElement;
  return active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
}

// ═══════════════════ Header 导航 ═══════════════════
const HEADER_BTNS = ['sound-btn', 'add-btn', 'settings-btn']; // 0=音效, 1=新建, 2=设置

function handleHeaderNav(e) {
  const key = e.key;
  const maxIdx = HEADER_BTNS.length - 1;

  switch(key) {
    case 'ArrowLeft':
      e.preventDefault();
      if (headerBtnIndex > 0) { headerBtnIndex--; playSound('move'); }
      else { playSound('error'); }
      updateHeaderFocus();
      break;

    case 'ArrowRight':
      e.preventDefault();
      if (headerBtnIndex < maxIdx) { headerBtnIndex++; playSound('move'); }
      else { playSound('error'); }
      updateHeaderFocus();
      break;

    case 'ArrowDown':
      e.preventDefault();
      // 回到 kanban 区域
      focusZone = 'kanban';
      playSound('slide');
      updateHeaderFocus();
      updateFocus(); updateStatusBar();
      break;

    case 'Enter':
    case ' ':
      e.preventDefault();
      // 执行按钮动作
      playSound('select');
      $(HEADER_BTNS[headerBtnIndex])?.click();
      break;

    case 'Escape':
      e.preventDefault();
      focusZone = 'kanban';
      playSound('cancel');
      updateHeaderFocus();
      updateFocus(); updateStatusBar();
      break;
  }
}

function updateHeaderFocus() {
  // 清除所有 header 按钮焦点
  HEADER_BTNS.forEach((id, idx) => {
    const btn = $(id);
    if (btn) btn.classList.toggle('header-focused', focusZone === 'header' && idx === headerBtnIndex);
  });
}

// ═══════════════════ 状态栏导航 ═══════════════════
let statusBarIndex = -1; // -1=等级, 0=成就, 1=运动, 2=冥想

function handleStatusBarNav(e) {
  const key = e.key;
  // -1=等级区域, 0=成就, 1=运动, 2=冥想
  const minIdx = -1, maxIdx = 2;

  switch(key) {
    case 'ArrowLeft':
      e.preventDefault();
      if (statusBarIndex > minIdx) { statusBarIndex--; playSound('move'); }
      else { playSound('error'); }
      updateStatusBarFocus();
      break;

    case 'ArrowRight':
      e.preventDefault();
      if (statusBarIndex < maxIdx) { statusBarIndex++; playSound('move'); }
      else { playSound('error'); }
      updateStatusBarFocus();
      break;

    case 'ArrowUp':
      e.preventDefault();
      // 回到 kanban 区域
      focusZone = 'kanban';
      currentRow = 0;
      playSound('slide');
      updateStatusBarFocus();
      updateFocus(); updateStatusBar();
      break;

    case 'Enter':
    case ' ':
      e.preventDefault();
      playSound('select');
      if (statusBarIndex === -1) {
        openXPPanel();
      } else if (statusBarIndex === 0) {
        openAchievementsPanel();
      } else if (statusBarIndex === 1) {
        openWorkoutSelect();
      } else if (statusBarIndex === 2) {
        openMeditateSelect();
      }
      break;

    case 'Escape':
      e.preventDefault();
      focusZone = 'kanban';
      playSound('cancel');
      updateStatusBarFocus();
      updateFocus(); updateStatusBar();
      break;
  }
}

function updateStatusBarFocus() {
  const sb = $('status-bar');
  if (!sb) return;
  sb.classList.toggle('sb-focused', focusZone === 'statusbar');
  // 等级区域高亮
  const gameArea = $('sb-game-area');
  if (gameArea) gameArea.classList.toggle('sb-item-focused', focusZone === 'statusbar' && statusBarIndex === -1);
  // 成就/运动/冥想按钮高亮
  const items = sb.querySelectorAll('.sb-action-item');
  items.forEach((item, idx) => {
    item.classList.toggle('sb-item-focused', focusZone === 'statusbar' && idx === statusBarIndex);
  });
}

function handleKanbanNav(e) {
  const key = e.key;
  const focusedStatus = COLUMNS[viewOffset + activeCol];
  const colItems = getColItems(focusedStatus);
  const maxRow = Math.max(0, colItems.length - 1);

  switch(key) {
    case 'ArrowUp':
      e.preventDefault();
      if (currentRow > 0) { currentRow--; playSound('move'); }
      else {
        // 到顶了，跳到 header
        focusZone = 'header';
        headerBtnIndex = 2; // 从设置按钮开始
        playSound('slide');
      }
      updateFocus(); updateStatusBar();
      break;

    case 'ArrowDown':
      e.preventDefault();
      if (currentRow < maxRow) { currentRow++; playSound('move'); }
      else {
        // 到底了，跳到状态栏
        focusZone = 'statusbar';
        playSound('slide');
      }
      updateFocus(); updateStatusBar();
      break;

    case 'ArrowLeft':
      e.preventDefault();
      if (activeCol > 0) {
        activeCol = 0; currentRow = 0; playSound('move');
        // 3D倾斜效果
        const cardL = document.querySelector('.todo-card.focused');
        if (cardL) { cardL.classList.add('tilt-left'); setTimeout(() => cardL.classList.remove('tilt-left'), 250); }
      } else if (viewOffset > 0) {
        viewOffset -= 2; activeCol = 1; currentRow = 0;
        playSound('slide'); renderView(); animateSlide('left');
      } else { playSound('error'); }
      updateFocus(); updateStatusBar();
      break;

    case 'ArrowRight':
      e.preventDefault();
      if (activeCol < 1) {
        activeCol = 1; currentRow = 0; playSound('move');
        // 3D倾斜效果
        const cardR = document.querySelector('.todo-card.focused');
        if (cardR) { cardR.classList.add('tilt-right'); setTimeout(() => cardR.classList.remove('tilt-right'), 250); }
      } else if (viewOffset < 2) {
        viewOffset += 2; activeCol = 0; currentRow = 0;
        playSound('slide'); renderView(); animateSlide('right');
      } else { playSound('error'); }
      updateFocus(); updateStatusBar();
      break;

    case 'Enter':
      e.preventDefault();
      if (colItems.length > 0 && currentRow < colItems.length) {
        playSound('select');
        openActionMenu(colItems[currentRow]);
      } else { playSound('error'); }
      break;

    case ' ':  // Space(Y键) — 快速开始番茄 / 盲盒轮盘
      e.preventDefault();
      if (colItems.length > 0 && currentRow < colItems.length) {
        const todo = colItems[currentRow];
        if (todo.status !== 'completed') {
          playSound('select');
          startPomodoro(todo.id, todo.title);
        } else { playSound('error'); }
      } else {
        // 没有任务或空列 → 盲盒轮盘
        playSound('select');
        startRoulette();
      }
      break;

    case 's':
    case 'S':
      // S 键：快速设置（键盘用户，Steam Deck 用顶栏导航）
      e.preventDefault();
      playSound('select'); openSettings();
      break;

    case 'w':
    case 'W':
      // W 键：运动挑战
      e.preventDefault();
      playSound('select'); openWorkoutSelect();
      break;
  }
}

function animateSlide(direction) {
  const leftCol = $('view-left');
  const rightCol = $('view-right');
  const cls = direction === 'right' ? 'slide-in-right' : 'slide-in-left';

  leftCol.classList.add(cls);
  rightCol.classList.add(cls);
  setTimeout(() => {
    leftCol.classList.remove(cls);
    rightCol.classList.remove(cls);
  }, 300);

  showColIndicator();
}

function showColIndicator() {
  const leftMeta = COL_META[COLUMNS[viewOffset]];
  const rightMeta = COL_META[COLUMNS[viewOffset + 1]];
  const indicator = $('col-indicator');
  $('ci-icon').textContent = activeCol === 0 ? leftMeta.icon : rightMeta.icon;
  $('ci-name').textContent = activeCol === 0 ? leftMeta.name : rightMeta.name;
  indicator.classList.add('show');
  setTimeout(() => indicator.classList.remove('show'), 600);
}

function handleModalNav(e) {
  const key = e.key;
  const modal = $('todo-modal');
  if (modal.classList.contains('hidden')) return;

  // 字段列表：标题 → 描述 → 优先级 → 状态 → 取消 → 保存
  // 自定义选择器用 .custom-select 容器代替隐藏的 select
  const allInputs = modal.querySelectorAll('input:not([type="hidden"]):not(.cs-hidden), textarea, .custom-select, .deadline-picker, .modal-actions button');
  const inputArr = Array.from(allInputs).filter(el => !el.classList.contains('hidden') && !el.closest('.hidden') && !el.classList.contains('cs-hidden'));
  const maxIdx = inputArr.length - 1;

  // 同步 modalFocusIndex 到当前焦点元素
  const activeIdx = inputArr.indexOf(document.activeElement);
  if (activeIdx >= 0) modalFocusIndex = activeIdx;

  switch(key) {
    case 'Enter': {
      const focused = document.activeElement;
      // Shift+Enter 在 textarea 里换行
      if (focused?.tagName === 'TEXTAREA' && e.shiftKey) break;
      // 在按钮上 → 点击
      if (focused?.tagName === 'BUTTON') { e.preventDefault(); focused.click(); break; }
      // 在自定义选择器上 → 跳到下一个字段
      if (focused?.classList?.contains('custom-select')) { e.preventDefault(); if (modalFocusIndex < maxIdx) { modalFocusIndex++; inputArr[modalFocusIndex]?.focus(); playSound('confirm'); } break; }
      // 在deadline-picker上 → 跳到下一个字段
      if (focused?.closest?.('.deadline-picker')) { e.preventDefault(); if (modalFocusIndex < maxIdx) { modalFocusIndex++; inputArr[modalFocusIndex]?.focus(); playSound('confirm'); } break; }
      // 在 select 上 → 不做任何事（让浏览器原生处理）
      if (focused?.tagName === 'SELECT') break;
      // 在 input/textarea 上 → 确认当前字段，跳到下一个
      e.preventDefault();
      if (modalFocusIndex < maxIdx) {
        modalFocusIndex++;
        inputArr[modalFocusIndex]?.focus();
        // 如果跳到 custom-select，给个视觉反馈
        if (inputArr[modalFocusIndex]?.classList?.contains('custom-select')) playSound('move');
        else playSound('confirm');
      }
      break;
    }
    case 'ArrowUp':
      e.preventDefault();
      // deadline-picker: 上键切换到上一个字段
      if (document.activeElement?.closest('.deadline-picker')) {
        const idx = DP_FIELDS.indexOf(dpState.activeField);
        if (idx > 0) { dpState.activeField = DP_FIELDS[idx - 1]; dpRender(); playSound('move'); }
        else playSound('error');
        break;
      }
      if (modalFocusIndex > 0) { modalFocusIndex--; playSound('move'); }
      else playSound('error');
      inputArr[modalFocusIndex]?.focus();
      break;
    case 'ArrowDown':
      e.preventDefault();
      // deadline-picker: 下键切换到下一个字段
      if (document.activeElement?.closest('.deadline-picker')) {
        const idx = DP_FIELDS.indexOf(dpState.activeField);
        if (idx < DP_FIELDS.length - 1) { dpState.activeField = DP_FIELDS[idx + 1]; dpRender(); playSound('move'); }
        else playSound('error');
        break;
      }
      if (modalFocusIndex < maxIdx) { modalFocusIndex++; playSound('move'); }
      else playSound('error');
      inputArr[modalFocusIndex]?.focus();
      break;
    case 'ArrowLeft':
    case 'ArrowRight': {
      // deadline-picker: ◀▶调整数值
      const picker = document.activeElement?.closest('.deadline-picker');
      if (picker) {
        const dir = key === 'ArrowRight' ? 1 : -1;
        dpAdjust(dpState.activeField, dir);
        break;
      }
      // 自定义选择器：←→切换选项
      const cs = document.activeElement?.closest('.custom-select');
      if (cs) {
        const select = cs.querySelector('select');
        if (select) {
          const currentIdx = select.selectedIndex;
          if (key === 'ArrowLeft' && currentIdx > 0) {
            e.preventDefault(); select.selectedIndex = currentIdx - 1;
            syncCustomSelect(cs); playSound('move');
          } else if (key === 'ArrowRight' && currentIdx < select.options.length - 1) {
            e.preventDefault(); select.selectedIndex = currentIdx + 1;
            syncCustomSelect(cs); playSound('move');
          }
        }
        break;
      }
      // 原生 select 回退
      if (document.activeElement?.tagName === 'SELECT') {
        const select = document.activeElement;
        const currentIdx = select.selectedIndex;
        if (key === 'ArrowLeft' && currentIdx > 0) {
          e.preventDefault(); select.selectedIndex = currentIdx - 1; playSound('move');
        } else if (key === 'ArrowRight' && currentIdx < select.options.length - 1) {
          e.preventDefault(); select.selectedIndex = currentIdx + 1; playSound('move');
        }
      }
      break;
    }
    case 'Escape':
      e.preventDefault(); closeTodoModal(); playSound('cancel');
      break;
    case 'v':
    case 'V':
      // V 键触发语音输入（键盘用户快捷键）
      e.preventDefault();
      voiceTargetInput = document.activeElement === $('todo-desc-input') ? 'desc' : 'title';
      startVoiceRecording();
      focusMode = 'voice-recording';
      break;
    case ' ':
      // Space(Y键) — 标题/描述输入框为空时触发语音，有内容时正常输入空格
      if (document.activeElement === $('todo-title-input') && !$('todo-title-input').value.trim()) {
        e.preventDefault();
        voiceTargetInput = 'title';
        startVoiceRecording();
        focusMode = 'voice-recording';
      } else if (document.activeElement === $('todo-desc-input') && !$('todo-desc-input').value.trim()) {
        e.preventDefault();
        voiceTargetInput = 'desc';
        startVoiceRecording();
        focusMode = 'voice-recording';
      } else if (document.activeElement?.tagName === 'BUTTON') {
        e.preventDefault();
        document.activeElement.click();
      } else if (document.activeElement?.tagName === 'SELECT') {
        // Space 在 select 上也切换选项（和 ←→ 一样）
        const sel = document.activeElement;
        e.preventDefault();
        sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
        playSound('move');
      }
      // 其他情况（input/textarea有内容）不 preventDefault，正常输入空格
      break;
  }
}

function handleSettingsNav(e) {
  const key = e.key;
  const modal = $('settings-modal');
  if (modal.classList.contains('hidden')) return;

  const buttons = modal.querySelectorAll('button:not(.hidden)');
  const btnArr = Array.from(buttons);
  const maxIdx = btnArr.length - 1;

  switch(key) {
    case 'ArrowUp':
      e.preventDefault();
      if (modalFocusIndex > 0) { modalFocusIndex--; playSound('move'); }
      else playSound('error');
      btnArr[modalFocusIndex]?.focus();
      btnArr[modalFocusIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      break;
    case 'ArrowDown':
    case 'Tab':
      e.preventDefault();
      if (modalFocusIndex < maxIdx) { modalFocusIndex++; playSound('move'); }
      else playSound('error');
      btnArr[modalFocusIndex]?.focus();
      btnArr[modalFocusIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      break;
    case 'Enter':
      const focused = document.activeElement;
      if (focused?.tagName === 'BUTTON') { e.preventDefault(); playSound('select'); focused.click(); }
      break;
    case 'Escape':
      e.preventDefault(); closeSettings(); playSound('cancel');
      break;
  }
}

function handleActionMenuNav(e) {
  const menu = $('action-menu');
  if (!menu || menu.classList.contains('hidden')) return;
  // 复用 ListNav 逻辑：↑↓移动，Enter选择，Esc关闭，←→快速移动状态
  const items = menu.querySelectorAll('.action-item:not([disabled])');
  const max = items.length - 1;
  if (max < 0) return;
  const key = e.key;
  switch(key) {
    case 'ArrowUp':
      e.preventDefault();
      if (modalFocusIndex > 0) { modalFocusIndex--; playSound('move'); }
      else playSound('error');
      updateActionMenuFocus(items);
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (modalFocusIndex < max) { modalFocusIndex++; playSound('move'); }
      else playSound('error');
      updateActionMenuFocus(items);
      if (items[modalFocusIndex]) items[modalFocusIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      break;
    case 'ArrowLeft':
      e.preventDefault();
      quickMoveStatus(-1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      quickMoveStatus(1);
      break;
    case 'Enter':
      e.preventDefault();
      playSound('select');
      executeAction(modalFocusIndex);
      break;
    case 'Escape':
      e.preventDefault();
      closeActionMenu();
      playSound('cancel');
      break;
  }
}

function updateActionMenuFocus(items) {
  items.forEach((item, idx) => {
    const isFocused = idx === modalFocusIndex;
    item.classList.toggle('focused', isFocused);
    if (isFocused) {
      item.setAttribute('tabindex', '0');
      item.focus();
    } else {
      item.removeAttribute('tabindex');
    }
  });
}

// ═══════════════════ 番茄钟导航 ═══════════════════
function handlePomodoroNav(e) {
  const key = e.key;
  switch(key) {
    case 'Enter':
      e.preventDefault();
      togglePomoPause();
      break;
    case ' ':
      e.preventDefault();
      // Space 键（Steam Deck Y）：启动随笔录音
      if (!voiceRecording) {
        voiceTargetInput = 'pomo-note';  // 标记：语音回填到随笔
        focusMode = 'voice-recording';
        startVoiceRecording();
      }
      break;
    case 'ArrowLeft':
      e.preventDefault();
      bgmSwitch(-1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      bgmSwitch(1);
      break;
    case 'Escape':
      e.preventDefault();
      abandonPomo();
      break;
  }
}

function handleCelebrateNav(e) {
  const key = e.key;
  switch(key) {
    case 'Enter':
    case ' ':
    case 'Escape':
      e.preventDefault();
      playSound('select');
      closeCelebrate();
      break;
  }
}

// ═══════════════════ 番茄模式选择导航 ═══════════════════
function handlePomoModeSelectNav(e) {
  const key = e.key;
  switch(key) {
    case 'ArrowUp':
    case 'ArrowLeft':
      e.preventDefault();
      if (pomoModeIndex !== 0) { pomoModeIndex = 0; playSound('move'); }
      else playSound('error');
      updatePomoModeFocus();
      break;
    case 'ArrowDown':
    case 'ArrowRight':
      e.preventDefault();
      if (pomoModeIndex !== 1) { pomoModeIndex = 1; playSound('move'); }
      else playSound('error');
      updatePomoModeFocus();
      break;
    case 'Enter':
      e.preventDefault();
      playSound('select');
      confirmPomoMode();
      break;
    case 'Escape':
      e.preventDefault();
      $('pomo-mode-select').classList.add('hidden');
      pendingPomoTodo = null;
      focusMode = 'kanban';
      playSound('cancel');
      break;
  }
}

// ═══════════════════ 起手式完成导航 ═══════════════════
function handleMiniPomoDoneNav(e) {
  const key = e.key;
  switch(key) {
    case 'ArrowUp':
    case 'ArrowLeft':
      e.preventDefault();
      if (miniPomoOptionIndex !== 0) { miniPomoOptionIndex = 0; playSound('move'); }
      else playSound('error');
      updateMiniPomoFocus();
      break;
    case 'ArrowDown':
    case 'ArrowRight':
      e.preventDefault();
      if (miniPomoOptionIndex !== 1) { miniPomoOptionIndex = 1; playSound('move'); }
      else playSound('error');
      updateMiniPomoFocus();
      break;
    case 'Enter':
      e.preventDefault();
      playSound('select');
      confirmMiniPomoChoice();
      break;
  }
}

// ═══════════════════ 盲盒轮盘 ═══════════════════
let rouletteTimer = null;

function startRoulette() {
  // 收集所有未完成任务
  const candidates = todos.filter(t => t.status !== 'completed');
  if (candidates.length === 0) {
    playSound('error');
    return;
  }
  
  $('roulette-overlay').classList.remove('hidden');
  focusMode = 'roulette';
  const spinner = $('roulette-spinner');
  const taskName = $('roulette-task-name');
  const hint = $('roulette-hint');
  
  spinner.classList.add('spinning');
  spinner.classList.remove('landed');
  hint.textContent = '命运正在选择...';
  taskName.textContent = '???';
  
  // 快速滚动显示任务名
  let rollCount = 0;
  const totalRolls = 15 + Math.floor(Math.random() * 10);
  clearInterval(rouletteTimer);
  
  rouletteTimer = setInterval(() => {
    const random = candidates[Math.floor(Math.random() * candidates.length)];
    taskName.textContent = random.title;
    rollCount++;
    
    if (rollCount >= totalRolls) {
      clearInterval(rouletteTimer);
      // 最终选中（权重：高优先级+临近deadline更容易）
      const selected = weightedRandomTodo(candidates);
      taskName.textContent = selected.title;
      spinner.classList.remove('spinning');
      spinner.classList.add('landed');
      hint.textContent = '按 Enter 开始命运之番茄！';
      playSound('pomo-complete');
      
      // 记住选中的任务
      rouletteTimer = null;
      pendingPomoTodo = { id: selected.id, title: selected.title };
    }
  }, 80 + rollCount * 8); // 逐渐减速
}

function weightedRandomTodo(candidates) {
  const now = Date.now();
  const weights = candidates.map(t => {
    let w = 1;
    // 高优先级权重
    if (t.priority === 'urgent') w += 4;
    else if (t.priority === 'high') w += 2;
    // 临近deadline权重
    if (t.due) {
      const daysLeft = (new Date(t.due) - now) / 86400000;
      if (daysLeft < 0) w += 5; // 过期了！
      else if (daysLeft < 1) w += 3; // 今天到期
      else if (daysLeft < 3) w += 1; // 3天内
    }
    return w;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function handleRouletteNav(e) {
  const key = e.key;
  switch(key) {
    case 'Enter':
      e.preventDefault();
      playSound('select');
      if (pendingPomoTodo) {
        // 开始番茄（带模式选择）
        $('roulette-overlay').classList.add('hidden');
        const todoId = pendingPomoTodo.id;
        const todoTitle = pendingPomoTodo.title;
        pendingPomoTodo = null;
        startPomodoro(todoId, todoTitle);
      }
      break;
    case 'Escape':
      e.preventDefault();
      clearInterval(rouletteTimer);
      rouletteTimer = null;
      $('roulette-overlay').classList.add('hidden');
      pendingPomoTodo = null;
      focusMode = 'kanban';
      playSound('cancel');
      break;
  }
}

// ═══════════════════ 焦点更新 ═══════════════════
function updateFocus() {
  // 清除卡片焦点
  $q('.todo-card.focused').forEach(el => {
    el.classList.remove('focused');
    el.classList.remove('idle-wobble');
    el.classList.remove('tilt-left');
    el.classList.remove('tilt-right');
  });

  // 更新 header 和 statusbar 焦点视觉
  updateHeaderFocus();
  updateStatusBarFocus();

  // 非 kanban 区域不聚焦卡片
  if (focusZone !== 'kanban') return;

  const focusedStatus = COLUMNS[viewOffset + activeCol];
  const colItems = getColItems(focusedStatus);
  if (colItems.length > 0 && currentRow < colItems.length) {
    const todoId = colItems[currentRow].id;
    const card = document.querySelector(`.todo-card[data-id="${todoId}"]`);
    if (card) {
      card.classList.add('focused');
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      // 延迟添加微晃，避免和聚焦动画冲突
      setTimeout(() => card.classList.add('idle-wobble'), 500);
    }
  }
}

function updateStatusBar() {
  const focusedStatus = COLUMNS[viewOffset + activeCol];
  const meta = COL_META[focusedStatus];
  const colItems = getColItems(focusedStatus);
  const todo = colItems[currentRow];

  $('sb-col').textContent = `${meta.icon} ${meta.name}`;

  if (todo) {
    const pomo = getPomoCount(todo);
    const pomoStr = pomo > 0 ? ` 🍅×${pomo}` : '';
    $('sb-title').textContent = (todo.title.length > 22 ? todo.title.substring(0, 22) + '…' : todo.title) + pomoStr;
  } else {
    $('sb-title').textContent = '(空)';
  }

  // 根据 focusZone 显示不同提示
  let hints = [];
  if (focusZone === 'header') {
    hints = ['←→ 切换按钮', '↓ 返回任务', 'Enter 执行'];
  } else if (focusZone === 'kanban') {
    hints.push('↑↓ 选择');
    if (viewOffset > 0 || activeCol > 0) hints.push('← 上一列');
    if (viewOffset < 2 || activeCol < 1) hints.push('→ 下一列');
    if (colItems.length > 0) {
      hints.push('Enter 操作');
      hints.push('Space 番茄');
    }
    hints.push('↑ 顶栏');
    hints.push('↓ 状态栏');
  } else if (focusZone === 'statusbar') {
    hints = ['←→ 经验/成就', '↑ 返回任务', 'Space 打开'];
  }
  $('sb-hint').textContent = hints.join(' | ');
  
  // 更新RPG状态栏
  updateGameUI();
}

function updateGameUI() {
  // 等级和XP条
  const levelEl = $('game-level');
  const xpBarEl = $('game-xp-bar');
  const xpTextEl = $('game-xp-text');
  const todayEl = $('game-today');
  const titleEl = $('game-title');
  
  if (!levelEl) return; // DOM还没准备好
  
  // totalPomo 从服务器数据实时计算（所有任务的 pomodoro_count 求和）
  const serverTotalPomo = todos.reduce((sum, t) => sum + getPomoCount(t), 0);
  if (serverTotalPomo !== gameState.totalPomo) {
    gameState.totalPomo = serverTotalPomo;
    // 同步推算 XP 和 level：每个番茄25XP
    gameState.xp = serverTotalPomo * XP_REWARDS.pomo;
    // 重建 level（不扣已完成等级的XP）
    let lvl = 1, xpSpent = 0;
    while (xpSpent + xpForLevel(lvl) <= gameState.xp) {
      xpSpent += xpForLevel(lvl);
      lvl++;
    }
    gameState.level = lvl;
    gameState.xp -= xpSpent; // 当前等级的剩余XP
    saveGameState();
  }
  
  const title = LEVEL_TITLES[gameState.level] || `Lv.${gameState.level}`;
  const needed = xpForLevel(gameState.level);
  const pct = Math.min(100, (gameState.xp / needed) * 100);
  
  levelEl.textContent = `Lv.${gameState.level}`;
  titleEl.textContent = title;
  xpBarEl.style.width = `${pct}%`;
  xpTextEl.textContent = `${gameState.xp}/${needed}`;
  todayEl.textContent = `🍅${gameState.todayPomo}`;
  
  // 状态栏运动/冥想/成就当日计数
  const achEl = $('sb-ach');
  const wkEl = $('sb-workout');
  const mdEl = $('sb-meditate');
  if (achEl) achEl.textContent = `🏆×${gameState.achievements.length}`;
  if (wkEl) wkEl.textContent = `🤸×${gameState.todayWorkouts || 0}`;
  if (mdEl) mdEl.textContent = `🧘×${gameState.todayMeditations || 0}`;
  
  // === Buff 显示 ===
  const buffsEl = $('game-buffs');
  if (buffsEl && gameState.activeBuffs) {
    gameState.activeBuffs = gameState.activeBuffs.filter(b => !b.expires || b.expires > Date.now());
    const tags = gameState.activeBuffs.map(b => {
      if (b.type === 'vitality') return '💪';
      if (b.type === 'zen') return '🧘';
      return '';
    }).filter(Boolean);
    buffsEl.textContent = tags.join('');
  }
  
  // === Combo 显示 ===
  showComboDisplay();
  // === Boss 显示 ===
  updateBossDisplay();
  // === 每日挑战显示 ===
  updateDailyDisplay();
}

// ═══════════════════ 经验详情面板 ═══════════════════
function openXPPanel() {
  let panel = $('xp-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'xp-panel';
    panel.className = 'info-panel hidden';
    document.body.appendChild(panel);
  }

  const needed = xpForLevel(gameState.level);
  const nextNeeded = xpForLevel(gameState.level + 1);
  const pct = Math.min(100, (gameState.xp / needed) * 100);

  panel.innerHTML = `
    <div class="info-panel-backdrop"></div>
    <div class="info-panel-content">
      <h2>📊 个人统计</h2>
      <div class="xp-detail-row">
        <span class="xp-label">等级</span>
        <span class="xp-value">Lv.${gameState.level} ${LEVEL_TITLES[gameState.level] || ''}</span>
      </div>
      <div class="xp-detail-row">
        <span class="xp-label">经验值</span>
        <span class="xp-value">${gameState.xp} / ${needed} XP</span>
      </div>
      <div class="xp-detail-row">
        <span class="xp-label">升级进度</span>
        <span class="xp-value">${pct.toFixed(1)}%</span>
      </div>
      <div class="xp-detail-row">
        <span class="xp-label">下一级需要</span>
        <span class="xp-value">${nextNeeded} XP</span>
      </div>
      <div class="xp-detail-row">
        <span class="xp-label">总番茄数</span>
        <span class="xp-value">🍅 ${gameState.totalPomo}</span>
      </div>
      <div class="xp-detail-row">
        <span class="xp-label">今日番茄</span>
        <span class="xp-value">🍅 ${gameState.todayPomo}</span>
      </div>
      <div class="xp-detail-row">
        <span class="xp-label">今日运动</span>
        <span class="xp-value">🤸 ${gameState.todayWorkouts || 0}</span>
      </div>
      <div class="xp-detail-row">
        <span class="xp-label">今日冥想</span>
        <span class="xp-value">🧘 ${gameState.todayMeditations || 0}</span>
      </div>
      <div class="xp-detail-row">
        <span class="xp-label">连续番茄</span>
        <span class="xp-value">🔥 ${gameState.streak}</span>
      </div>
      <div class="xp-detail-row">
        <span class="xp-label">连击</span>
        <span class="xp-value">⚡ ${gameState.combo}</span>
      </div>
      <div class="xp-detail-row">
        <span class="xp-label">成就</span>
        <span class="xp-value">🏆 ${gameState.achievements.length}</span>
      </div>
      <div class="xp-detail-section">
        <h3>XP 获取规则</h3>
        <div class="xp-rule">🍅 完成番茄 +25 XP</div>
        <div class="xp-rule">✅ 完成任务 +50 XP</div>
        <div class="xp-rule">🔴 紧急任务 +100 XP</div>
        <div class="xp-rule">🟠 重要任务 +75 XP</div>
      </div>
      <button class="btn-primary info-panel-close">关闭</button>
    </div>
  `;

  panel.classList.remove('hidden');
  focusMode = 'xp-panel';
  playSound('select');

  // 绑定关闭
  panel.querySelector('.info-panel-close').onclick = () => closeInfoPanel('xp-panel');
  panel.querySelector('.info-panel-backdrop').onclick = () => closeInfoPanel('xp-panel');
}

// ═══════════════════ 成就面板 ═══════════════════
function openAchievementsPanel() {
  let panel = $('achievements-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'achievements-panel';
    panel.className = 'info-panel hidden';
    document.body.appendChild(panel);
  }

  const ACHIEVEMENTS = [
    { id: 'first_pomo', icon: '🍅', name: '初尝番茄', desc: '完成第一个番茄' },
    { id: 'pomo_5', icon: '🍅×5', name: '番茄新手', desc: '累计完成5个番茄' },
    { id: 'pomo_10', icon: '🍅×10', name: '番茄达人', desc: '累计完成10个番茄' },
    { id: 'pomo_25', icon: '🍅×25', name: '番茄专家', desc: '累计完成25个番茄' },
    { id: 'pomo_50', icon: '🍅×50', name: '番茄大师', desc: '累计完成50个番茄' },
    { id: 'streak_3', icon: '🔥×3', name: '三连击', desc: '连续完成3个番茄' },
    { id: 'streak_5', icon: '🔥×5', name: '五连击', desc: '连续完成5个番茄' },
    { id: 'level_3', icon: '⭐', name: '小有所成', desc: '达到3级' },
    { id: 'level_5', icon: '⭐⭐', name: '渐入佳境', desc: '达到5级' },
    { id: 'level_8', icon: '⭐⭐⭐', name: '龙虾之路', desc: '达到8级' },
    { id: 'first_complete', icon: '✅', name: '首战告捷', desc: '完成第一个任务' },
    { id: 'clear_col', icon: '🧹', name: '一清二楚', desc: '清空一个列' },
  ];

  const unlocked = gameState.achievements || [];
  const items = ACHIEVEMENTS.map(a => {
    const isUnlocked = unlocked.includes(a.id);
    return `<div class="ach-item ${isUnlocked ? 'ach-unlocked' : 'ach-locked'}">
      <span class="ach-icon">${isUnlocked ? a.icon : '🔒'}</span>
      <div class="ach-info">
        <span class="ach-name">${isUnlocked ? a.name : '???'}</span>
        <span class="ach-desc">${a.desc}</span>
      </div>
    </div>`;
  }).join('');

  const unlockCount = unlocked.length;
  const totalCount = ACHIEVEMENTS.length;

  panel.innerHTML = `
    <div class="info-panel-backdrop"></div>
    <div class="info-panel-content">
      <h2>🏆 成就系统</h2>
      <div class="ach-progress">${unlockCount} / ${totalCount} 已解锁</div>
      <div class="ach-grid">${items}</div>
      <button class="btn-primary info-panel-close">关闭</button>
    </div>
  `;

  panel.classList.remove('hidden');
  focusMode = 'achieve-panel';
  playSound('select');

  // 初始化成就面板 ListNav
  achievePanelNav.reset();
  achievePanelNav.updateFocus();

  panel.querySelector('.info-panel-close').onclick = () => closeInfoPanel('achievements-panel');
  panel.querySelector('.info-panel-backdrop').onclick = () => closeInfoPanel('achievements-panel');
}

function closeInfoPanel(panelId) {
  const panel = $(panelId);
  if (panel) panel.classList.add('hidden');
  focusMode = 'kanban';
  playSound('cancel');
  updateFocus(); updateStatusBar();
}

// 成就面板 ListNav（逐项聚焦，SteamDeck可操控）
const achievePanelNav = new ListNav({
  container: 'achievements-panel',
  item: '.ach-item',
  focusedClass: 'focused',
  vertical: true,
  onSelect: (idx, el) => {
    playSound('move');
  },
  onEscape: () => {
    closeInfoPanel('achievements-panel');
  }
});

// XP面板也用 ListNav
const xpPanelNav = new ListNav({
  container: 'xp-panel',
  item: '.xp-detail-row',
  focusedClass: 'focused',
  vertical: true,
  onSelect: (idx, el) => {
    playSound('move');
  },
  onEscape: () => { closeInfoPanel('xp-panel'); }
});

function handleInfoPanelNav(e) {
  const key = e.key;
  
  switch(key) {
    case 'Escape':
      e.preventDefault();
      playSound('cancel');
      if (focusMode === 'xp-panel') closeInfoPanel('xp-panel');
      else if (focusMode === 'achieve-panel') closeInfoPanel('achievements-panel');
      break;
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
      e.preventDefault();
      if (focusMode === 'achieve-panel') {
        // 成就2列grid：真正的2D导航
        const cols = 2;
        const items = $('achievements-panel')?.querySelectorAll('.ach-item') || [];
        const maxIdx = items.length - 1;
        let idx = achievePanelNav.idx;
        
        if (key === 'ArrowUp') {
          idx -= cols; // 上移一行
        } else if (key === 'ArrowDown') {
          idx += cols; // 下移一行
        } else if (key === 'ArrowLeft') {
          if (idx % cols > 0) idx--; // 不在左列，左移
        } else if (key === 'ArrowRight') {
          if (idx % cols < cols - 1 && idx < maxIdx) idx++; // 不在右列且不是最后一个，右移
        }
        
        // 边界检查
        if (idx < 0) idx = 0;
        if (idx > maxIdx) idx = maxIdx;
        
        if (idx !== achievePanelNav.idx) {
          achievePanelNav.idx = idx;
          achievePanelNav.updateFocus(items);
          playSound('move');
        }
      } else if (focusMode === 'xp-panel') {
        xpPanelNav.handleKey(e);
      }
      break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      playSound('select');
      if (focusMode === 'achieve-panel') achievePanelNav.handleKey(e);
      else if (focusMode === 'xp-panel') xpPanelNav.handleKey(e);
      break;
  }
}

// ═══════════════════ 卡片点击 ═══════════════════
function onCardClick(id, status, rowIdx) {
  const leftStatus = COLUMNS[viewOffset];
  activeCol = (status === leftStatus) ? 0 : 1;
  currentRow = rowIdx;
  updateFocus(); updateStatusBar();
  playSound('select');
  const todo = todos.find(t => t.id === id);
  if (todo) openActionMenu(todo);
}

// ═══════════════════ 操作菜单 ═══════════════════
function openActionMenu(todo) {
  let menu = $('action-menu');
  if (!menu) {
    menu = document.createElement('div');
    menu.id = 'action-menu';
    menu.className = 'action-menu hidden';
    document.body.appendChild(menu);
  }

  const currentStatusIdx = COLUMNS.indexOf(todo.status);
  const canMoveLeft = currentStatusIdx > 0;
  const canMoveRight = currentStatusIdx < 3;
  const pomoCount = getPomoCount(todo);

  const leftTarget = canMoveLeft ? COL_META[COLUMNS[currentStatusIdx - 1]].name : '';
  const rightTarget = canMoveRight ? COL_META[COLUMNS[currentStatusIdx + 1]].name : '';

  menu.innerHTML = `
    <div class="action-menu-content">
      <h3>${(todo.title || '任务操作').substring(0, 20)}</h3>
      <div class="action-item" data-action="pomodoro">
        <span class="ai-icon">🍅</span>
        <span class="ai-text">番茄专注</span>
        <span class="ai-hint">${pomoCount > 0 ? pomoCount + '个已完成' : ''}</span>
      </div>
      <div class="action-item" data-action="edit">
        <span class="ai-icon">✏️</span>
        <span class="ai-text">编辑</span>
        <span class="ai-hint">Enter</span>
      </div>
      <div class="action-item" data-action="left" ${!canMoveLeft ? 'disabled' : ''}>
        <span class="ai-icon">⬅️</span>
        <span class="ai-text">移到${canMoveLeft ? leftTarget : '首列'}</span>
        <span class="ai-hint">←</span>
      </div>
      <div class="action-item" data-action="right" ${!canMoveRight ? 'disabled' : ''}>
        <span class="ai-icon">➡️</span>
        <span class="ai-text">移到${canMoveRight ? rightTarget : '末列'}</span>
        <span class="ai-hint">→</span>
      </div>
      <div class="action-item danger" data-action="delete">
        <span class="ai-icon">🗑️</span>
        <span class="ai-text">删除</span>
        <span class="ai-hint">Del</span>
      </div>
      <div class="action-item" data-action="cancel">
        <span class="ai-icon">↩️</span>
        <span class="ai-text">取消</span>
        <span class="ai-hint">Esc</span>
      </div>
    </div>
  `;

  // 给每个 action-item 绑定点击事件
  const actionItems = menu.querySelectorAll('.action-item');
  actionItems.forEach((item, idx) => {
    item.addEventListener('click', () => {
      const enabledItems = menu.querySelectorAll('.action-item:not([disabled])');
      const enabledIdx = Array.from(enabledItems).indexOf(item);
      if (enabledIdx >= 0) executeAction(enabledIdx);
    });
  });

  menu.classList.remove('hidden');
  focusMode = 'action-menu';
  modalFocusIndex = 0;
  const enabledItems = menu.querySelectorAll('.action-item:not([disabled])');
  updateActionMenuFocus(enabledItems);
  // 自动聚焦第一个 item（Steam Deck 键盘可操作）
  if (enabledItems[0]) {
    enabledItems[0].setAttribute('tabindex', '0');
    enabledItems[0].focus();
  }
}

function closeActionMenu() {
  const menu = $('action-menu');
  if (menu) menu.classList.add('hidden');
  focusMode = 'kanban';
  updateFocus();
}

function executeAction(idx) {
  const menu = $('action-menu');
  const items = menu.querySelectorAll('.action-item:not([disabled])');
  const item = items[idx];
  if (!item) return;

  const action = item.dataset.action;
  const focusedStatus = COLUMNS[viewOffset + activeCol];
  const colItems = getColItems(focusedStatus);
  const todo = colItems[currentRow];

  closeActionMenu();

  switch(action) {
    case 'pomodoro':
      playSound('confirm');
      startPomodoro(todo.id, todo.title);
      break;
    case 'edit':
      playSound('confirm');
      openEditModal(todo.id);
      break;
    case 'left':
      playSound('confirm');
      moveTodo(todo.id, COLUMNS[COLUMNS.indexOf(todo.status) - 1]);
      break;
    case 'right':
      playSound('confirm');
      moveTodo(todo.id, COLUMNS[COLUMNS.indexOf(todo.status) + 1]);
      break;
    case 'delete':
      playSound('confirm');
      deleteTodo(todo.id);
      break;
    case 'cancel':
      playSound('cancel');
      break;
  }
}

function quickMoveStatus(direction) {
  const focusedStatus = COLUMNS[viewOffset + activeCol];
  const colItems = getColItems(focusedStatus);
  const todo = colItems[currentRow];
  const currentStatusIdx = COLUMNS.indexOf(todo.status);
  const newStatusIdx = currentStatusIdx + direction;

  if (newStatusIdx >= 0 && newStatusIdx <= 3) {
    closeActionMenu();
    playSound('confirm');
    moveTodo(todo.id, COLUMNS[newStatusIdx]);
  } else {
    playSound('error');
  }
}

// ═══════════════════ 番茄钟 BGM 引擎 ═══════════════════
const BGM_LIST = [
  { id: 'off',    name: '静音', icon: '🔇' },
  { id: 'rain',   name: '雨声', icon: '🌧️' },
  { id: 'ocean',  name: '海浪', icon: '🌊' },
  { id: 'fire',   name: '篝火', icon: '🔥' },
  { id: 'forest', name: '森林', icon: '🌲' },
  { id: 'stream', name: '溪流', icon: '💧' },
];
let bgmIndex = 0;
let bgmCtx = null;
let bgmNodes = null;
let bgmIntervalId = null;  // 事件调度器

function bgmCurrent() { return BGM_LIST[bgmIndex]; }

function bgmUpdateUI() {
  const cur = bgmCurrent();
  $('bgm-label').textContent = cur.icon;
  $('bgm-name').textContent = cur.name;
  const bar = document.querySelector('.pomo-bgm-bar');
  if (bar) bar.classList.toggle('active', cur.id !== 'off');
  // 更新 BGM 视觉效果
  updateBgmVisual(cur.id);
}

// BGM 视觉效果：给 pomo-card 切换 CSS 类 + 效果层动画
function updateBgmVisual(bgmId) {
  const card = document.querySelector('.pomo-card');
  if (!card) return;
  // 清除旧的
  card.classList.remove('bgm-rain', 'bgm-ocean', 'bgm-fire', 'bgm-forest', 'bgm-stream', 'bgm-off');
  if (bgmId !== 'off') {
    card.classList.add('bgm-' + bgmId);
  } else {
    card.classList.add('bgm-off');
  }
  // 管理效果层
  let fxLayer = document.getElementById('bgm-fx-layer');
  if (bgmId === 'off') {
    if (fxLayer) { fxLayer.innerHTML = ''; fxLayer.classList.add('hidden'); }
    return;
  }
  if (!fxLayer) {
    fxLayer = document.createElement('div');
    fxLayer.id = 'bgm-fx-layer';
    fxLayer.className = 'bgm-fx-layer';
    card.insertBefore(fxLayer, card.firstChild);
  }
  fxLayer.classList.remove('hidden');
  fxLayer.innerHTML = '';
  switch (bgmId) {
    case 'rain': spawnRainDrops(fxLayer); break;
    case 'ocean': spawnOceanWaves(fxLayer); break;
    case 'fire': spawnFireEmbers(fxLayer); break;
    case 'forest': spawnLeaves(fxLayer); break;
    case 'stream': spawnBubbles(fxLayer); break;
  }
}

// 雨滴效果
function spawnRainDrops(container) {
  for (let i = 0; i < 30; i++) {
    const drop = document.createElement('div');
    drop.className = 'bgm-rain-drop';
    drop.style.left = (Math.random() * 100) + '%';
    drop.style.animationDelay = (Math.random() * 0.8) + 's';
    drop.style.animationDuration = (0.4 + Math.random() * 0.4) + 's';
    container.appendChild(drop);
  }
}

// 海浪效果
function spawnOceanWaves(container) {
  for (let i = 0; i < 3; i++) {
    const wave = document.createElement('div');
    wave.className = 'bgm-ocean-wave';
    wave.style.top = (30 + i * 25) + '%';
    wave.style.animationDelay = (i * 0.6) + 's';
    container.appendChild(wave);
  }
}

// 篝火粒子
function spawnFireEmbers(container) {
  for (let i = 0; i < 20; i++) {
    const ember = document.createElement('div');
    ember.className = 'bgm-fire-ember';
    ember.style.left = (30 + Math.random() * 40) + '%';
    ember.style.bottom = (20 + Math.random() * 30) + '%';
    ember.style.animationDelay = (Math.random() * 1.5) + 's';
    ember.style.animationDuration = (1.5 + Math.random() * 2) + 's';
    container.appendChild(ember);
  }
}

// 落叶效果
function spawnLeaves(container) {
  for (let i = 0; i < 15; i++) {
    const leaf = document.createElement('div');
    leaf.className = 'bgm-forest-leaf';
    leaf.style.left = (Math.random() * 80 + 10) + '%';
    leaf.style.animationDelay = (Math.random() * 3) + 's';
    leaf.style.animationDuration = (3 + Math.random() * 4) + 's';
    container.appendChild(leaf);
  }
}

// 溪流气泡
function spawnBubbles(container) {
  for (let i = 0; i < 12; i++) {
    const bubble = document.createElement('div');
    bubble.className = 'bgm-stream-bubble';
    bubble.style.left = (Math.random() * 80 + 10) + '%';
    bubble.style.bottom = Math.random() * 20 + '%';
    bubble.style.animationDelay = (Math.random() * 2) + 's';
    bubble.style.animationDuration = (1.5 + Math.random() * 2) + 's';
    container.appendChild(bubble);
  }
}

function bgmStop() {
  if (bgmIntervalId) { clearInterval(bgmIntervalId); bgmIntervalId = null; }
  if (bgmNodes) {
    // 立即停止，不延迟（防止快速切换时叠加）
    try { bgmNodes.gain.gain.setValueAtTime(0, bgmCtx.currentTime); } catch(e) {}
    try { if (bgmNodes.lfo) bgmNodes.lfo.stop(); } catch(e) {}
    try { if (bgmNodes.filterLfo) bgmNodes.filterLfo.stop(); } catch(e) {}
    try { bgmNodes.source.stop(); } catch(e) {}
    bgmNodes = null;
  }
}

// 暂停BGM（立即停止）
function bgmPause() {
  bgmStop();
}

// 恢复BGM（淡入）
function bgmResume() {
  if (!bgmCtx || bgmCurrent().id === 'off') return;
  // 直接重新启动当前BGM
  bgmStart(bgmCurrent().id);
}

// 兼容旧调用名
function bgmPauseForRecording() { bgmPause(); }
function bgmResumeAfterRecording() { bgmResume(); }

// ═══════════ 噪音生成器 ═══════════
// 粉噪音 (Voss-McCartney算法) — 比白噪音更自然
function createPinkNoiseBuffer(ctx, duration) {
  const len = ctx.sampleRate * duration;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886*b0 + white*0.0555179;
      b1 = 0.99332*b1 + white*0.0750759;
      b2 = 0.96900*b2 + white*0.1538520;
      b3 = 0.86650*b3 + white*0.3104856;
      b4 = 0.55000*b4 + white*0.5329522;
      b5 = -0.7616*b5 - white*0.0168980;
      data[i] = (b0+b1+b2+b3+b4+b5+b6 + white*0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }
  return buf;
}

// 棕噪音 — 低频更丰富，适合深度专注
function createBrownNoiseBuffer(ctx, duration) {
  const len = ctx.sampleRate * duration;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lastOut = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + (0.02 * white)) / 1.02;
      lastOut = data[i];
      data[i] *= 3.5;
    }
  }
  return buf;
}

// ═══════════ 混响 ═══════════
function createReverb(ctx, duration=1.2) {
  const len = ctx.sampleRate * duration;
  const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random()*2-1) * Math.pow(1 - i/len, 2.5);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = impulse;
  return conv;
}

// ═══════════ 立体声展宽 ═══════════
function createStereoSpread(ctx, input, output, width=0.6) {
  const panL = ctx.createStereoPanner();
  const panR = ctx.createStereoPanner();
  const gainL = ctx.createGain();
  const gainR = ctx.createGain();
  panL.pan.value = -width;
  panR.pan.value = width;
  gainL.gain.value = 0.7;
  gainR.gain.value = 0.7;
  input.connect(panL).connect(gainL).connect(output);
  input.connect(panR).connect(gainR).connect(output);
}

// ═══════════ BGM 启动 ═══════════
function bgmStart(id) {
  bgmStop();
  if (id === 'off') return;

  if (!bgmCtx) bgmCtx = new (window.AudioContext || window.webkitAudioContext)();
  const ctx = bgmCtx;
  const master = ctx.createGain();
  master.gain.value = 0;

  let source, events, lfoNode = null, filterLfoNode = null;

  switch(id) {
    case 'rain': {
      // 雨声：粉噪音基底 + 雨滴事件层
      source = ctx.createBufferSource();
      source.buffer = createPinkNoiseBuffer(ctx, 8);  // 加长buffer确保循环平滑
      source.loop = true;
      
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2500;
      bp.Q.value = 0.4;
      
      const reverb = createReverb(ctx, 0.8);
      const dry = ctx.createGain();
      dry.gain.value = 0.6;
      const wet = ctx.createGain();
      wet.gain.value = 0.4;
      
      source.connect(bp);
      bp.connect(dry).connect(master);
      bp.connect(reverb).connect(wet).connect(master);
      
      // 雨滴事件层
      events = () => {
        const now = ctx.currentTime;
        for (let i = 0; i < 8; i++) {
          const t = now + Math.random() * 0.5;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          const pan = ctx.createStereoPanner();
          osc.frequency.setValueAtTime(1500 + Math.random()*2000, t);
          osc.frequency.exponentialRampToValueAtTime(600, t + 0.02);
          g.gain.setValueAtTime(0.015, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
          pan.pan.value = (Math.random()*2-1) * 0.8;
          osc.connect(g).connect(pan).connect(master);
          osc.start(t);
          osc.stop(t + 0.06);
        }
      };
      break;
    }
    
    case 'ocean': {
      // 海浪：棕噪音 + 潮汐LFO
      source = ctx.createBufferSource();
      source.buffer = createBrownNoiseBuffer(ctx, 8);  // 加长buffer确保循环平滑
      source.loop = true;
      
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 800;
      bp.Q.value = 0.3;
      
      // 潮汐LFO — 快涨慢落
      lfoNode = ctx.createOscillator();
      lfoNode.frequency.value = 0.08; // 12秒周期
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.35;
      lfoNode.connect(lfoGain).connect(master.gain);
      lfoNode.start();
      
      // 滤波器也随潮汐变化
      filterLfoNode = ctx.createOscillator();
      filterLfoNode.frequency.value = 0.08;
      const filterLfoGain = ctx.createGain();
      filterLfoGain.gain.value = 600;
      filterLfoNode.connect(filterLfoGain).connect(bp.frequency);
      filterLfoNode.start();
      
      const reverb = createReverb(ctx, 1.5);
      source.connect(bp);
      bp.connect(master);
      bp.connect(reverb).connect(master);
      master.connect(ctx.destination);  // 必须连接输出！
      bgmNodes = { source, gain: master, lfo: lfoNode, filterLfo: filterLfoNode };
      master.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 2);
      source.start();
      return;  // ocean 有独立的连接逻辑，提前返回
    }
    
    case 'fire': {
      // 篝火：棕噪音 + 柴火爆裂事件
      source = ctx.createBufferSource();
      source.buffer = createBrownNoiseBuffer(ctx, 8);  // 加长buffer确保循环平滑
      source.loop = true;
      
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 600;
      bp.Q.value = 0.5;
      
      // 火焰闪烁LFO
      lfoNode = ctx.createOscillator();
      lfoNode.frequency.value = 0.3;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 200;
      lfoNode.connect(lfoGain).connect(bp.frequency);
      lfoNode.start();
      
      source.connect(bp).connect(master);
      
      // 柴火爆裂事件
      events = () => {
        const now = ctx.currentTime;
        const count = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
          const t = now + i * 0.02 + Math.random() * 0.01;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          const res = ctx.createBiquadFilter();
          res.type = 'bandpass';
          res.frequency.value = 2000 + Math.random() * 3000;
          res.Q.value = 8;
          g.gain.setValueAtTime(0.08, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
          osc.connect(res).connect(g).connect(master);
          osc.start(t);
          osc.stop(t + 0.02);
        }
      };
      break;
    }
    
    case 'forest': {
      // 森林：粉噪音 + 鸟鸣事件
      source = ctx.createBufferSource();
      source.buffer = createPinkNoiseBuffer(ctx, 8);  // 加长buffer确保循环平滑
      source.loop = true;
      
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200;
      bp.Q.value = 0.3;
      
      // 风拂树叶LFO
      lfoNode = ctx.createOscillator();
      lfoNode.frequency.value = 0.2;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 400;
      lfoNode.connect(lfoGain).connect(bp.frequency);
      lfoNode.start();
      
      source.connect(bp).connect(master);
      
      // 鸟鸣事件
      events = () => {
        const now = ctx.currentTime;
        if (Math.random() > 0.7) { // 30%概率触发鸟鸣
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          const pan = ctx.createStereoPanner();
          const baseFreq = 2000 + Math.random() * 2000;
          const dur = 0.1 + Math.random() * 0.3;
          
          osc.frequency.setValueAtTime(baseFreq, now);
          osc.frequency.linearRampToValueAtTime(baseFreq * 1.3, now + dur * 0.3);
          osc.frequency.linearRampToValueAtTime(baseFreq * 0.9, now + dur);
          
          g.gain.setValueAtTime(0, now);
          g.gain.linearRampToValueAtTime(0.04, now + 0.01);
          g.gain.setValueAtTime(0.04, now + dur * 0.7);
          g.gain.exponentialRampToValueAtTime(0.001, now + dur);
          
          pan.pan.value = (Math.random()*2-1) * 0.6;
          osc.connect(g).connect(pan).connect(master);
          osc.start(now);
          osc.stop(now + dur + 0.01);
        }
      };
      break;
    }
    
    case 'stream': {
      // 溪流：粉噪音 + 水花事件
      source = ctx.createBufferSource();
      source.buffer = createPinkNoiseBuffer(ctx, 8);  // 加长buffer确保循环平滑
      source.loop = true;
      
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 3000;
      bp.Q.value = 0.4;
      
      lfoNode = ctx.createOscillator();
      lfoNode.frequency.value = 0.4;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 800;
      lfoNode.connect(lfoGain).connect(bp.frequency);
      lfoNode.start();
      
      source.connect(bp).connect(master);
      
      // 微水花事件
      events = () => {
        const now = ctx.currentTime;
        for (let i = 0; i < 3; i++) {
          const t = now + Math.random() * 0.3;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.frequency.value = 3000 + Math.random() * 2000;
          g.gain.setValueAtTime(0.008, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
          osc.connect(g).connect(master);
          osc.start(t);
          osc.stop(t + 0.04);
        }
      };
      break;
    }
    
    default:
      source = ctx.createBufferSource();
      source.buffer = createPinkNoiseBuffer(ctx, 8);  // 加长buffer确保循环平滑
      source.loop = true;
      source.connect(master);
  }

  master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 1.5);
  source.start();
  // 保存所有节点（含LFO），确保bgmStop能正确清理
  bgmNodes = { source, gain: master, lfo: lfoNode, filterLfo: filterLfoNode };
  
  // 启动事件调度器（降低频率到2秒，减少CPU占用）
  if (events) {
    events();
    bgmIntervalId = setInterval(events, 2000);
  }
}

function bgmSwitch(direction) {
  bgmIndex = (bgmIndex + direction + BGM_LIST.length) % BGM_LIST.length;
  const cur = bgmCurrent();
  bgmStart(cur.id);
  bgmUpdateUI();
  playSound('move');
}

// ═══════════════════ 番茄钟 ═══════════════════
function startPomodoro(todoId, todoTitle) {
  // 先弹出模式选择
  pendingPomoTodo = { id: todoId, title: todoTitle };
  pomoModeIndex = 0;
  updatePomoModeFocus();
  $('pomo-mode-select').classList.remove('hidden');
  focusMode = 'pomo-mode-select';
  playSound('select');
  
  // 绑定鼠标点击事件
  document.querySelectorAll('#pomo-mode-select .pomo-mode-option').forEach((el, idx) => {
    el.onclick = () => {
      pomoModeIndex = idx;
      updatePomoModeFocus();
      confirmPomoMode();
    };
  });
}

function updatePomoModeFocus() {
  const options = ['pomo-mode-normal', 'pomo-mode-mini'];
  options.forEach((id, idx) => {
    $(id)?.classList.toggle('focused', idx === pomoModeIndex);
  });
}

function confirmPomoMode() {
  if (!pendingPomoTodo) return;
  const todoId = pendingPomoTodo.id;
  const todoTitle = pendingPomoTodo.title;
  
  // 隐藏模式选择
  $('pomo-mode-select').classList.add('hidden');
  
  // 确定时长
  isMiniPomo = pomoModeIndex === 1;
  const duration = isMiniPomo ? MINI_POMO_DURATION : getActivePomoDuration();
  starterBuff = false;
  
  pomoState = {
    active: true,
    paused: false,
    todoId: todoId,
    todoTitle: todoTitle,
    totalSeconds: duration,
    remainingSeconds: duration,
    intervalId: null
  };

  // 重置番茄飞出动画（避免第二次看不到番茄）
  const tomatoEmoji = $('pomo-tomato-emoji');
  if (tomatoEmoji) tomatoEmoji.classList.remove('fly-out');

  // 显示番茄钟界面
  $('pomo-task-name').textContent = todoTitle + (isMiniPomo ? ' 🚀' : '');
  $('pomodoro-overlay').classList.remove('hidden');
  $('pomo-pause-btn').textContent = '⏸ 暂停';
  focusMode = 'pomodoro';
  updatePomoDisplay();

  // 加载当前任务的随笔
  const todo = todos.find(t => t.id === todoId);
  const existingNotes = todo?.metadata?.pomo_notes || [];
  updatePomoNotesUI(existingNotes);

  // 更新页面标题
  const mins = Math.floor(duration / 60);
  document.title = `🍅 ${mins}:00 - ${todoTitle}`;

  // 启动计时器
  pomoState.intervalId = setInterval(pomoTick, 1000);

  playSound('confirm');
  pendingPomoTodo = null;
}

function pomoTick() {
  if (pomoState.paused) return;

  pomoState.remainingSeconds--;

  if (pomoState.remainingSeconds <= 0) {
    // 番茄完成！
    if (isMiniPomo) {
      // 5分钟起手式完成 → 弹选择
      showMiniPomoDone();
    } else {
      completePomodoro();
    }
    return;
  }

  updatePomoDisplay();

  // 最后 30 秒每秒提示音
  if (pomoState.remainingSeconds <= 30 && pomoState.remainingSeconds % 5 === 0) {
    playSound('pomo-tick');
  }
}

function updatePomoDisplay() {
  const mins = Math.floor(pomoState.remainingSeconds / 60);
  const secs = pomoState.remainingSeconds % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  $('pomo-timer').textContent = timeStr;

  // 更新圆环进度
  const progress = (pomoState.totalSeconds - pomoState.remainingSeconds) / pomoState.totalSeconds;
  const circumference = 2 * Math.PI * 88; // r=88
  const offset = circumference * (1 - progress);
  const ringFg = $('pomo-ring-fg');
  if (ringFg) {
    ringFg.style.strokeDasharray = circumference;
    ringFg.style.strokeDashoffset = offset;
  }

  // 紧张模式：最后5分钟红闪
  const card = document.querySelector('.pomo-card');
  if (card) {
    if (pomoState.remainingSeconds <= 300 && pomoState.remainingSeconds > 0 && !pomoState.paused) {
      card.classList.add('urgent-mode');
    } else {
      card.classList.remove('urgent-mode');
    }
  }

  // 更新页面标题
  document.title = `🍅 ${timeStr} - ${pomoState.todoTitle}`;
}

function togglePomoPause() {
  if (!pomoState.active) return;

  pomoState.paused = !pomoState.paused;
  $('pomo-pause-btn').textContent = pomoState.paused ? '▶ 继续' : '⏸ 暂停';

  if (pomoState.paused) {
    document.title = `⏸ 已暂停 - ${pomoState.todoTitle}`;
    playSound('pomo-pause');
    bgmPause(); // 淡出BGM + 停事件调度器
  } else {
    playSound('confirm');
    bgmResume(); // 淡入BGM + 重启事件调度器
  }
}

function abandonPomo() {
  if (!pomoState.active) return;

  clearInterval(pomoState.intervalId);
  pomoState.active = false;
  $('pomodoro-overlay').classList.add('hidden');
  focusMode = 'kanban';
  document.title = '🦞 Claw Todo';
  bgmStop();
  bgmIndex = 0;
  bgmUpdateUI(); // 同步UI显示静音
  playSound('cancel');
  updateFocus();
}

// ═══════════════════ 5分钟起手式完成 ═══════════════════
function showMiniPomoDone() {
  clearInterval(pomoState.intervalId);
  bgmStop();
  bgmIndex = 0;
  bgmUpdateUI(); // 同步UI显示静音
  playSound('pomo-complete');
  
  $('mini-pomo-done').classList.remove('hidden');
  focusMode = 'mini-pomo-done';
  miniPomoOptionIndex = 0;
  updateMiniPomoFocus();
}

function updateMiniPomoFocus() {
  const options = ['mini-continue', 'mini-stop'];
  options.forEach((id, idx) => {
    $(id)?.classList.toggle('focused', idx === miniPomoOptionIndex);
  });
}

function confirmMiniPomoChoice() {
  $('mini-pomo-done').classList.add('hidden');
  
  if (miniPomoOptionIndex === 0) {
    // 继续做完：给起手buff，延长到标准番茄
    starterBuff = true;
    isMiniPomo = false;
    const remaining = getActivePomoDuration() - MINI_POMO_DURATION;
    pomoState.totalSeconds = getActivePomoDuration();
    pomoState.remainingSeconds = remaining;
    $('pomo-task-name').textContent = pomoState.todoTitle + ' 🔥';
    focusMode = 'pomodoro';
    updatePomoDisplay();
    pomoState.intervalId = setInterval(pomoTick, 1000);
    playSound('workout-start');
  } else {
    // 就到这里：按完成算（但XP减半）
    isMiniPomo = false;
    completePomodoro(true); // halfXP
  }
}

async function completePomodoro(halfXP = false) {
  clearInterval(pomoState.intervalId);
  bgmStop();
  bgmIndex = 0;
  bgmUpdateUI(); // 同步UI显示静音

  // 番茄完成音效
  playSound('pomo-complete');

  // 更新番茄计数到服务器
  const todo = todos.find(t => t.id === pomoState.todoId);
  let newPomoCount = 0;
  if (todo) {
    const currentCount = getPomoCount(todo);
    newPomoCount = currentCount + 1;
    const newMetadata = { ...(todo.metadata || {}), pomodoro_count: newPomoCount };

    await fetchJSON(`${API.todos}/${pomoState.todoId}`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: newMetadata })
    });
    // 立即更新本地 todo 对象，避免后续读取旧值
    todo.metadata = { ...todo.metadata, pomodoro_count: newPomoCount };
  }

  // 游戏化：获得XP + 更新番茄计数（totalPomo 由 updateGameUI 从服务器数据同步）
  gameState.todayPomo++;
  gameState.streak++;
  
  // === Combo 连击 ===
  updateCombo();
  const comboMult = getComboMultiplier();
  let baseXP = XP_REWARDS.pomo;
  if (halfXP) baseXP = Math.floor(baseXP / 2); // 5分钟起手式只拿一半
  if (starterBuff) baseXP = Math.floor(baseXP * 1.5); // 起手buff XP+50%
  const comboXP = Math.floor(baseXP * comboMult);
  addXP(comboXP, `🍅 番茄${comboMult > 1 ? ' ×' + comboMult.toFixed(1) : ''}${starterBuff ? ' 🔥' : ''}${halfXP ? ' (5min)' : ''}`);
  starterBuff = false; // 重置
  
  // === Boss 受击 ===
  hitBoss();
  
  // === 随机事件 ===
  rollRandomEvent();
  
  // === 每日挑战进度 ===
  updateDailyProgress('pomo_3', 1);
  updateDailyProgress('pomo_5', 1);
  updateDailyProgress('combo_3', gameState.combo >= 3 ? 1 : 0);
  
  checkAchievements();

  // 番茄飞出动画
  const tomatoEmoji = $('pomo-tomato-emoji');
  if (tomatoEmoji) {
    tomatoEmoji.classList.add('fly-out');
  }

  // 等待动画完成再隐藏
  await new Promise(r => setTimeout(r, 600));

  // 隐藏计时器
  $('pomodoro-overlay').classList.add('hidden');

  // 显示庆祝界面
  const title = LEVEL_TITLES[gameState.level] || `Lv.${gameState.level}`;
  $('celebrate-count').innerHTML = `已完成 ${newPomoCount} 个番茄 · <span style="color:var(--accent)">+${XP_REWARDS.pomo}XP</span>`;
  $('pomo-celebrate').classList.remove('hidden');
  focusMode = 'celebrate';
  document.title = `🍅 番茄完成！ - ${pomoState.todoTitle}`;

  // 粒子特效
  spawnParticles('🍅', 20);

  pomoState.active = false;

  // 刷新数据
  await loadTodos();
}

function closeCelebrate() {
  $('pomo-celebrate').classList.add('hidden');
  document.title = '🦞 Claw Todo';
  playSound('confirm');
  // 关闭庆祝后弹出盲盒
  showLootbox();
  // 空奖励时showLootbox直接return，需手动回kanban
  if (focusMode === 'celebrate') {
    focusMode = 'kanban';
    updateFocus();
  }
}

// ═══════════════════ CRUD ═══════════════════
async function moveTodo(id, newStatus) {
  const todo = todos.find(t => t.id === id);
  const patch = { status: newStatus };
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
    playSound('success');
    
    // 游戏化：完成任务获得XP
    if (newStatus === 'completed' && todo) {
      const xp = todo.priority === 'urgent' ? XP_REWARDS.urgent :
                 todo.priority === 'high' ? XP_REWARDS.high : XP_REWARDS.complete;
      addXP(xp, '✅ 完成');
      gameState.totalCompleted = (gameState.totalCompleted || 0) + 1;
      checkAchievements();
      spawnParticles('⭐', 15);
      // === 每日挑战：完成任务 ===
      updateDailyProgress('complete_1', 1);
    }
    
    // 检查是否清空列
    const colItems = getColItems(todo?.status);
    if (colItems.length === 1) { // 移动前是最后一个
      gameState.hasClearedCol = true;
      checkAchievements();
    }
    
    await loadTodos();
  }
}

async function deleteTodo(id) {
  if (!confirm('确定删除？')) return;
  const res = await fetchJSON(`${API.todos}/${id}`, { method: 'DELETE' });
  if (res?.message) {
    toast('已删除');
    playSound('success');
    await loadTodos();
  }
}

// ═══════════════════ 语音输入系统 ═══════════════════
const WHISPER_API = 'https://api.chatanywhere.tech/v1/audio/transcriptions';
const WHISPER_KEY = 'sk-C0X7DL7XhdNIRn8af5qxzagcbzwXOJxaNLaIMMY7KwoG5YeM';

let mediaRecorder = null;
let audioChunks = [];
let voiceRecording = false;
let voiceStartTime = 0;
let voiceTimerInterval = null;
let voiceTargetInput = null; // 记录语音回填目标：'title' 或 'desc'

function initVoiceInput() {
  // 语音输入通过 Space(Y键) 或 V键 触发，无需按钮
}

async function startVoiceRecording() {
  try {
    // 录音时暂停BGM
    bgmPauseForRecording();
    
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      processVoiceAudio();
    };

    mediaRecorder.start();
    voiceRecording = true;
    voiceStartTime = Date.now();

    // 显示录音遮罩
    $('voice-overlay').classList.remove('hidden');
    updateVoiceTimer();
    voiceTimerInterval = setInterval(updateVoiceTimer, 1000);
    playSound('select');

  } catch (err) {
    console.error('无法访问麦克风:', err);
    toast('❌ 无法访问麦克风，请检查权限');
    playSound('error');
    // 录音失败也要恢复BGM
    bgmResumeAfterRecording();
  }
}

function updateVoiceTimer() {
  const elapsed = Math.floor((Date.now() - voiceStartTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  $('voice-timer').textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function stopVoiceRecording(cancel = false) {
  voiceRecording = false;
  clearInterval(voiceTimerInterval);
  $('voice-overlay').classList.add('hidden');

  // 录音结束，恢复BGM
  bgmResumeAfterRecording();

  if (cancel) {
    mediaRecorder.stop();
    audioChunks = [];
    playSound('cancel');
    toast('已取消录音');
    // 取消时回到之前的模式
    if (voiceTargetInput === 'pomo-note') {
      focusMode = 'pomodoro';
    }
  } else {
    console.log('Stopping recording, chunks:', audioChunks.length);
    mediaRecorder.stop();
    // onstop 会调用 processVoiceAudio
  }
}

async function processVoiceAudio() {
  if (audioChunks.length === 0) {
    console.warn('processVoiceAudio: no audio chunks');
    return;
  }

  const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
  console.log('Audio blob size:', audioBlob.size, 'bytes, type:', audioBlob.type);
  audioChunks = [];

  playSound('confirm');
  toast('⏳ 正在识别语音...');

  try {
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model', 'whisper-1');
    formData.append('language', 'zh');

    const res = await fetch(WHISPER_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${WHISPER_KEY}` },
      body: formData
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Whisper API error:', res.status, errText);
      throw new Error(`API ${res.status}: ${errText.substring(0, 100)}`);
    }

    const data = await res.json();
    console.log('Whisper response:', data);
    if (data.text) {
      const text = data.text.trim();
      
      if (voiceTargetInput === 'pomo-note') {
        // 番茄随笔模式：保存到当前任务的随笔
        await addPomoNote(text);
        playSound('success');
        toast(`📝 随笔已记录: ${text.substring(0, 20)}${text.length > 20 ? '...' : ''}`);
        // 录音结束后回到番茄模式
        focusMode = 'pomodoro';
      } else {
        // 根据 voiceTargetInput 回填到对应输入框
        const targetInput = voiceTargetInput === 'desc' ? 'todo-desc-input' : 'todo-title-input';
        $(targetInput).value = text;
        playSound('success');
        toast(`✅ 已识别: ${text.substring(0, 20)}${text.length > 20 ? '...' : ''}`);
      }
    } else {
      throw new Error(data.error || '识别失败');
    }
  } catch (err) {
    console.error('语音识别失败:', err);
    playSound('error');
    toast('❌ 语音识别失败，请重试');
  }
}

// 语音录制时的按键处理（在 handleKeyNav 中调用）
function handleVoiceRecordingNav(e) {
  const key = e.key;

  // B 键（Escape）= 取消
  if (key === 'Escape') {
    e.preventDefault();
    playSound('cancel');
    stopVoiceRecording(true);
    // 回到之前的模式
    focusMode = voiceTargetInput === 'pomo-note' ? 'pomodoro' : 'modal';
    return;
  }

  // Space 键 = 发送（松手即识别）
  if (key === ' ') {
    e.preventDefault();
    playSound('select');
    stopVoiceRecording(false);
    // 非随笔模式回到modal，随笔模式在processVoiceAudio中处理
    if (voiceTargetInput !== 'pomo-note') {
      focusMode = 'modal';
    }
    return;
  }
}

// ═══════════════════ 番茄随笔系统 ═══════════════════
// 随笔：番茄钟进行中按 Y 键录音，语音识别后保存到当前任务的 metadata.pomo_notes

async function addPomoNote(text) {
  if (!pomoState.active || !pomoState.todoId) {
    toast('❌ 没有正在进行的番茄');
    return;
  }
  
  const todo = todos.find(t => t.id === pomoState.todoId);
  if (!todo) return;
  
  const notes = todo.metadata?.pomo_notes || [];
  const note = {
    id: Date.now(),
    text: text,
    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    pomo_count: getPomoCount(todo) + 1  // 当前正在进行的番茄序号
  };
  notes.push(note);
  
  const newMetadata = { ...(todo.metadata || {}), pomo_notes: notes };
  
  await fetchJSON(`${API.todos}/${pomoState.todoId}`, {
    method: 'PATCH',
    body: JSON.stringify({ metadata: newMetadata })
  });
  
  // 立即更新本地
  todo.metadata = newMetadata;
  
  // 更新番茄界面中的随笔显示
  updatePomoNotesUI(notes);
}

function updatePomoNotesUI(notes) {
  const container = $('pomo-notes-list');
  if (!container) return;
  
  container.innerHTML = notes.map(n => 
    `<div class="pomo-note-item">
      <span class="pomo-note-time">🍅${n.pomo_count} ${n.time}</span>
      <span class="pomo-note-text">${escapeHtml(n.text)}</span>
    </div>`
  ).join('');
  
  // 滚动到底部
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ═══════════════════ AI 抽取待办 ═══════════════════
const CHAT_API = 'https://api.chatanywhere.tech/v1/chat/completions';

async function extractTodosFromNotes() {
  const todo = todos.find(t => t.id === editingTodoId);
  if (!todo) return;
  const notes = (todo.metadata && todo.metadata.pomo_notes) || [];
  if (notes.length === 0) { toast('没有随笔可分析'); playSound('error'); return; }

  const btn = $('btn-extract-todo');
  btn.disabled = true;
  btn.textContent = '⏳ AI 分析中...';
  toast('⏳ AI 分析随笔中...');

  try {
    const text = notes.map(n => n.text).join('\n');
    const res = await fetch(CHAT_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WHISPER_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: '从以下番茄钟随笔中提取可执行的待办事项。每行一个，格式：标题|优先级(high/normal/low)。只输出待办，不要解释，不要编号。如果随笔中没有可提取的待办，输出空。'
        }, { role: 'user', content: text }]
      })
    });

    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const content = data.choices[0].message.content.trim();
    const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

    if (lines.length === 0) {
      toast('未发现可提取的待办');
      playSound('error');
      return;
    }

    let created = 0;
    for (const line of lines) {
      const parts = line.split('|');
      const title = parts[0].trim();
      const priority = (parts[1] || 'normal').trim().replace(/[^a-z]/g, '');
      if (!title) continue;
      const validPriority = ['high','normal','low'].includes(priority) ? priority : 'normal';
      await fetchJSON(API.todos, {
        method: 'POST',
        body: JSON.stringify({ title, priority: validPriority, status: 'pending' })
      });
      created++;
    }

    toast(`✅ 已创建 ${created} 个待办`);
    playSound('levelup');
    await loadTodos();
  } catch (e) {
    console.error('extractTodos error:', e);
    toast('❌ AI 分析失败: ' + e.message);
    playSound('error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 AI 抽取待办';
  }
}

// ═══════════════════ Modal ═══════════════════
function openAddModal() {
  editingTodoId = null;
  $('modal-title').textContent = '新建待办';
  $('todo-title-input').value = '';
  $('todo-desc-input').value = '';
  $('todo-priority-input').value = 'normal';
  $('todo-status-input').value = 'pending';
  $('todo-deadline-input').value = '';
  // 初始化截止时间选择器为今天当前时间
  dpInit();
  syncAllCustomSelects();
  // 新建时隐藏随笔区
  $('modal-notes-section').classList.add('hidden');
  $('modal-notes-list').innerHTML = '';
  $('todo-modal').classList.remove('hidden');
  focusMode = 'modal';
  modalFocusIndex = 0;
  $('todo-title-input').focus();
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
  // 回填截止时间
  deadlineToDateOption(todo.due);
  syncAllCustomSelects();
  // 加载随笔
  const notes = (todo.metadata && todo.metadata.pomo_notes) || [];
  const notesSection = $('modal-notes-section');
  const notesList = $('modal-notes-list');
  if (notes.length > 0) {
    notesSection.classList.remove('hidden');
    notesList.innerHTML = notes.map(n =>
      `<div class="modal-note-item"><span class="modal-note-time">${n.time||''}</span><span class="modal-note-text">${escapeHtml(n.text)}</span></div>`
    ).join('');
  } else {
    notesSection.classList.add('hidden');
    notesList.innerHTML = '';
  }
  $('todo-modal').classList.remove('hidden');
  focusMode = 'modal';
  modalFocusIndex = 0;
  $('todo-title-input').focus();
}

// ═══════════════════ 自定义选择器 ═══════════════════
// 同步自定义选择器显示值与隐藏 select
function syncCustomSelect(cs) {
  const select = cs.querySelector('select');
  const valueEl = cs.querySelector('.cs-value');
  if (!select || !valueEl) return;
  valueEl.textContent = select.options[select.selectedIndex]?.text || '';
  // 截止时间：自定义选项显示datetime-local
  if (cs.id === 'cs-deadline') {
    const dtInput = $('todo-deadline-datetime');
    if (dtInput) {
      if (select.value === 'custom') {
        dtInput.classList.remove('hidden');
        dtInput.focus();
      } else {
        dtInput.classList.add('hidden');
      }
    }
  }
}

// 初始化自定义选择器按钮点击事件
function initCustomSelects() {
  document.querySelectorAll('.custom-select').forEach(cs => {
    const select = cs.querySelector('select');
    cs.querySelectorAll('.cs-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = parseInt(btn.dataset.dir);
        const newIdx = select.selectedIndex + dir;
        if (newIdx >= 0 && newIdx < select.options.length) {
          select.selectedIndex = newIdx;
          syncCustomSelect(cs);
          playSound('move');
        } else {
          playSound('error');
        }
      });
    });
    // 点击中间值区域也聚焦
    cs.querySelector('.cs-value')?.addEventListener('click', () => {
      cs.focus();
      cs.classList.add('focused');
    });
  });
  // 初始化截止时间选择器点击事件
  dpClickInit();
}

// 同步所有自定义选择器（在设置值后调用）
function syncAllCustomSelects() {
  document.querySelectorAll('.custom-select').forEach(syncCustomSelect);
}

function closeTodoModal() {
  $('todo-modal').classList.add('hidden');
  focusMode = 'kanban';
  updateFocus();
}

async function saveTodo() {
  const title = $('todo-title-input').value.trim();
  if (!title) { toast('请输入标题'); playSound('error'); return; }

  const data = {
    title,
    description: $('todo-desc-input').value.trim(),
    priority: $('todo-priority-input').value,
    status: $('todo-status-input').value,
    due: dpToISO(),
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
    playSound('success');
    await loadTodos();
  }
}

// ═══════════════════ Settings ═══════════════════
let pairTimerInterval = null;

function openSettings() {
  $('settings-modal').classList.remove('hidden');
  focusMode = 'settings';
  modalFocusIndex = 0;
  $('gen-pair-btn')?.focus();
}

function closeSettings() {
  $('settings-modal').classList.add('hidden');
  focusMode = 'kanban';
  updateFocus();
  if (pairTimerInterval) { clearInterval(pairTimerInterval); pairTimerInterval = null; }
}

async function generatePairCode() {
  const res = await fetchJSON(API.pairCode, { method: 'POST' });
  if (res?.code) {
    const codeEl = $('pair-code');
    codeEl.textContent = res.code;
    let remaining = res.expires_in || 300;
    const timerEl = $('pair-timer');
    if (pairTimerInterval) clearInterval(pairTimerInterval);
    pairTimerInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(pairTimerInterval);
        pairTimerInterval = null;
        codeEl.textContent = '------';
        timerEl.textContent = '已过期';
        return;
      }
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }, 1000);
    toast('配对码已生成');
    playSound('success');
  } else {
    toast(res?.error || '生成失败');
    playSound('error');
  }
}

async function generateBindToken() {
  const res = await fetchJSON(API.generateToken, { method: 'POST' });
  if (res?.token) {
    $('bind-token').value = res.token;
    toast('Token 已生成');
    playSound('success');
  }
}

function copyBindToken() {
  const t = $('bind-token').value;
  if (!t) { toast('请先生成 Token'); playSound('error'); return; }
  navigator.clipboard.writeText(t);
  toast('已复制');
  playSound('confirm');
}

// ═══════════════════ WebSocket ═══════════════════
function connectWS() {
  if (!token) return;
  ws = new WebSocket(`${API.ws}?token=${token}`);
  ws.onopen = () => setOnline(true);
  ws.onclose = () => { setOnline(false); setTimeout(connectWS, 3000); };
  ws.onerror = () => {};
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'todo_created') { todos.unshift(msg.payload); renderView(); }
    else if (msg.type === 'todo_updated') {
      const idx = todos.findIndex(t => t.id === msg.payload.id);
      if (idx >= 0) todos[idx] = msg.payload;
      renderView();
    }
    else if (msg.type === 'todo_deleted') {
      todos = todos.filter(t => t.id !== msg.payload.id);
      renderView();
    }
  };
}

function setOnline(online) {
  const dot = $('online-status');
  dot.className = `status-dot ${online ? 'online' : 'offline'}`;
}

// ═══════════════════ Offline ═══════════════════
function setupOfflineHandler() {
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

// ═══════════════════ Event Listeners ═══════════════════
function setupEventListeners() {
  // 全局点击初始化音频（浏览器要求用户交互才能播放）
  document.addEventListener('click', () => ensureAudioCtx(), { once: true });

  $('setup-btn').onclick = doSetup;
  $('login-btn').onclick = doLogin;
  $('setup-password').onkeydown = e => e.key === 'Enter' && doSetup();
  $('login-password').onkeydown = e => e.key === 'Enter' && doLogin();

  $('add-btn').onclick = () => { playSound('select'); openAddModal(); };
  $('settings-btn').onclick = () => { playSound('select'); openSettings(); };

  // 音效开关
  $('sound-btn').onclick = () => {
    soundEnabled = !soundEnabled;
    $('sound-btn').textContent = soundEnabled ? '🔊' : '🔇';
    if (soundEnabled) playSound('confirm');
  };

  $('modal-cancel').onclick = () => { closeTodoModal(); playSound('cancel'); };
  $('modal-save').onclick = saveTodo;
  $('todo-modal').querySelector('.modal-backdrop').onclick = () => { closeTodoModal(); playSound('cancel'); };

  $('settings-close').onclick = () => { closeSettings(); playSound('cancel'); };
  $('gen-pair-btn').onclick = generatePairCode;
  $('gen-token-btn').onclick = generateBindToken;
  $('copy-token-btn').onclick = copyBindToken;
  $('settings-modal').querySelector('.modal-backdrop').onclick = () => { closeSettings(); playSound('cancel'); };

  // 番茄钟按钮
  $('pomo-pause-btn').onclick = togglePomoPause;
  $('pomo-abandon-btn').onclick = abandonPomo;
  $('pomo-done-btn').onclick = closeCelebrate;

  // AI 抽取待办
  $('btn-extract-todo').onclick = extractTodosFromNotes;

  // 状态栏快捷按钮（成就/运动/冥想）— 事件委托，不依赖子元素存在时机
  $('status-bar').addEventListener('click', (e) => {
    // 等级区域点击 → 打开个人统计
    if (e.target.closest('.sb-game')) {
      playSound('select');
      openXPPanel();
      return;
    }
    const item = e.target.closest('.sb-action-item');
    if (!item) return;
    const items = [...$('status-bar').querySelectorAll('.sb-action-item')];
    const idx = items.indexOf(item);
    if (idx === -1) return;
    playSound('select');
    if (idx === 0) openAchievementsPanel();
    else if (idx === 1) openWorkoutSelect();
    else if (idx === 2) openMeditateSelect();
  });
}

// ═══════════════════ Helpers ═══════════════════
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

// ═══════════════════ 游戏化视觉效果 ═══════════════════

// 粒子特效系统
function spawnParticles(emoji, count) {
  const container = document.getElementById('particle-layer');
  if (!container) return;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.textContent = emoji;
    p.style.left = (20 + Math.random() * 60) + 'vw';
    p.style.animationDuration = (1 + Math.random() * 1.5) + 's';
    p.style.animationDelay = (Math.random() * 0.3) + 's';
    p.style.fontSize = (16 + Math.random() * 20) + 'px';
    container.appendChild(p);
    setTimeout(() => p.remove(), 3000);
  }
}

// 升级烟花
function spawnFireworks() {
  const container = document.getElementById('particle-layer');
  if (!container) return;
  const colors = ['🎆', '🎇', '✨', '🌟', '💫', '⭐', '🎉'];
  for (let burst = 0; burst < 3; burst++) {
    setTimeout(() => {
      for (let i = 0; i < 25; i++) {
        const p = document.createElement('div');
        p.className = 'particle firework';
        p.textContent = colors[Math.floor(Math.random() * colors.length)];
        p.style.left = (10 + Math.random() * 80) + 'vw';
        p.style.top = (10 + Math.random() * 40) + 'vh';
        p.style.animationDuration = (1.5 + Math.random() * 2) + 's';
        p.style.fontSize = (20 + Math.random() * 24) + 'px';
        container.appendChild(p);
        setTimeout(() => p.remove(), 4000);
      }
    }, burst * 400);
  }
}

// XP飘字
function showXPFloat(amount, label) {
  const el = document.createElement('div');
  el.className = 'xp-float';
  el.innerHTML = `${label} <span style="color:var(--accent);font-weight:bold">+${amount}XP</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// 升级动画
function showLevelUp(newLevel) {
  const title = LEVEL_TITLES[newLevel] || `Lv.${newLevel}`;
  const overlay = document.createElement('div');
  overlay.className = 'levelup-overlay';
  overlay.innerHTML = `
    <div class="levelup-card">
      <div class="levelup-glow"></div>
      <div class="levelup-text">⬆️ LEVEL UP!</div>
      <div class="levelup-level">Lv.${newLevel}</div>
      <div class="levelup-title">${title}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  playSound('levelup');
  spawnFireworks();
  setTimeout(() => {
    overlay.classList.add('fade-out');
    setTimeout(() => overlay.remove(), 600);
  }, 2500);
}

// 成就解锁弹窗
function showAchievementUnlocked(ach) {
  const el = document.createElement('div');
  el.className = 'achievement-popup';
  el.innerHTML = `
    <div class="ach-icon">${ach.icon}</div>
    <div class="ach-info">
      <div class="ach-label">🏆 成就解锁</div>
      <div class="ach-name">${ach.name}</div>
      <div class="ach-desc">${ach.desc}</div>
    </div>
  `;
  document.body.appendChild(el);
  playSound('achievement');
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 500);
  }, 3000);
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

// ═══════════════════ 运动模块 ═══════════════════
function formatSec(s) { const m = Math.floor(s / 60); return `${m}:${(s % 60).toString().padStart(2, '0')}`; }
// ═══ 动作步骤数据（自动生成） ═══
const EXERCISE_STEPS = {
  'V字支撑': ['坐姿，双手撑地后倾，双腿并拢', '抬起双腿成V字，核心收紧', '保持平衡，背部挺直'],
  'W-Y伸展': ['站姿，双臂成W形，肩胛骨后缩', '双臂向上伸展成Y形，肩膀下沉远离耳朵', '回到W形，再次夹紧肩胛骨'],
  '下巴后缩': ['坐姿或站姿，目视前方', '下巴水平向后收，如做双下巴', '放松回到中立位'],
  '下犬式': ['四点跪姿，双手与肩同宽', '臀部向上推，身体成倒V形', '脚跟下压，伸展腿后侧'],
  '仰卧卷腹': ['仰卧屈膝，双脚踩地，双手放头后', '卷起上背部，肩胛骨离地，核心发力', '缓慢有控制地回到起始位'],
  '仰卧抬腿': ['仰卧，双手放体侧', '双腿并拢向上抬起至90度', '缓慢放下，不触地继续'],
  '低弓步拉伸': ['右脚前弓步，左膝着地，双手放右大腿', '臀部缓慢前推，感受左侧髋屈肌拉伸', '保持拉伸，换另一侧'],
  '侧平板抬腿': ['侧卧，下腿微屈，上腿伸直', '上腿缓慢向上抬起，臀部外侧发力', '缓慢放下，换另一侧'],
  '侧平板支撑': ['侧卧，前臂撑地，身体成直线', '髋部抬起，核心收紧', '保持稳定，换另一侧'],
  '俄罗斯转体': ['坐姿，双脚离地，双手前伸', '上身向右旋转，核心发力', '回到中间，向左旋转'],
  '保加利亚分腿蹲': ['后脚背搭在凳上，前脚前迈', '下蹲至前大腿平行地面', '站起，换另一侧'],
  '俯卧撑': ['双手撑地与肩同宽，身体成直线', '屈肘下放身体，肘部约45度', '推起回到起始位'],
  '俯卧撑跳转': ['平板支撑位开始', '做一个俯卧撑', '双脚跳向双手，站起跳起'],
  '前臂拉伸': ['手臂伸直，掌心朝上', '另一手向下压手指', '感受前臂拉伸，换手'],
  '单腿提踵': ['单脚站立，手扶墙保持平衡', '踮脚站起，小腿发力', '缓慢放下脚跟，换另一侧'],
  '单腿硬拉': ['单脚站立，双臂自然下垂', '上身前倾，后腿抬起成T字', '回到站立，换另一侧'],
  '反向雪天使': ['俯卧，双臂放体侧', '双臂从体侧向上举过头顶', '缓慢放下回到体侧'],
  '婴儿式': ['跪坐，臀部坐脚跟', '上身前折叠，双臂前伸，额头触地', '完全放松，深呼吸'],
  '山羊挺身模拟': ['俯卧在垫上，双手抱头', '上身向上抬起，背部发力', '缓慢放下，重复'],
  '平板支撑': ['前臂撑地，身体成直线', '核心收紧，臀部不塌不翘', '保持呼吸均匀'],
  '平板支撑60秒': ['前臂撑地，身体成直线', '核心收紧，臀部不塌', '保持60秒'],
  '平板爬行': ['平板支撑位开始', '右手左脚同时向前移动', '左手右脚跟上，继续爬行'],
  '平板转侧平板': ['平板支撑位开始', '转体成侧平板，上臂上举', '转回平板，换另一侧'],
  '开合跳': ['站姿，双脚并拢，双臂体侧', '跳起，双脚打开双臂上举', '跳回并拢，重复'],
  '开合跳俯卧撑': ['标准俯卧撑起始位', '做一个俯卧撑', '推起后双手双脚向外跳开，再跳回'],
  '弹力带AB轮模拟': ['跪姿，弹力带套在双手', '双手前伸，身体前倾', '拉回起始，核心发力'],
  '弹力带YTW伸展': ['俯卧，弹力带套在双手', '双臂向前上方伸展成Y形', '缓慢放下'],
  '弹力带三头下压': ['站姿，双手握弹力带一端在背后，另一端过肩', '伸直手臂向上，三头肌发力', '缓慢屈肘回到起始'],
  '弹力带侧平举': ['站姿，双脚踩弹力带中段，双手握两端', '双臂向两侧抬起至肩高，肩部发力', '缓慢放下'],
  '弹力带侧步行走': ['弹力带套在脚踝，微屈膝半蹲', '向前走4步，保持弹力带张力', '向后走4步，保持半蹲'],
  '弹力带俄罗斯转体': ['坐姿，弹力带固定在侧面', '双手握带，上身向对侧旋转', '回到中间，换方向'],
  '弹力带冲刺': ['站姿，弹力带套在脚踝', '快速原地小步跑', '保持弹力带张力'],
  '弹力带划船': ['坐姿，弹力带绕过双脚，双手握住两端，双臂前伸', '向身体拉弹力带，夹紧肩胛骨，肘部贴身', '缓慢有控制地伸直双臂'],
  '弹力带划船+深蹲': ['站姿，弹力带踩脚下，双手握带', '下蹲，站起时双臂划船', '重复动作'],
  '弹力带单臂划船': ['站姿，双手握弹力带在右肩上方', '斜向下拉至左髋，核心旋转发力', '缓慢回到起始，换另一侧'],
  '弹力带卷腹': ['仰卧，弹力带绕过双脚，双手握带', '卷腹，双手拉带向上', '缓慢放下'],
  '弹力带反向飞鸟': ['站姿，双手握弹力带前伸，微屈膝', '双臂向两侧打开，肩胛骨夹紧', '缓慢回到前伸位'],
  '弹力带开合跳': ['站姿，弹力带套在脚踝', '双脚跳开，双臂侧举', '跳回并拢，双臂放下'],
  '弹力带引体模拟': ['站姿，弹力带固定高处，双手握带', '下拉至胸前，背阔肌发力', '缓慢放回'],
  '弹力带弯举': ['站姿，双脚踩弹力带，双手握带掌心朝上', '屈肘弯举至肩部，二头肌发力', '缓慢伸直双臂'],
  '弹力带扩胸': ['站姿，双手握弹力带前伸', '双臂向内夹，胸肌发力', '缓慢打开回到起始'],
  '弹力带死虫式': ['仰卧，弹力带套在双手和双脚上', '伸直右臂和左腿，对抗弹力带阻力', '回到起始，换对侧'],
  '弹力带深蹲': ['弹力带套膝盖上方，双脚与肩同宽', '下蹲至大腿平行，站起时双膝外展', '双膝合拢，继续下一次'],
  '弹力带深蹲推举': ['站姿，双手握弹力带在身前', '先弯举至肩部，再向上推举过头', '缓慢放下回到起始'],
  '弹力带深蹲跳': ['弹力带套肩上，双脚与肩同宽', '下蹲至大腿平行，爆发跳起', '落地缓冲，继续下一次'],
  '弹力带直臂下压': ['站姿，双手握弹力带举过头顶，双臂伸直', '双臂保持伸直向下压至大腿两侧，背阔肌发力', '缓慢有控制地回到起始位'],
  '弹力带硬拉': ['站姿，弹力带踩脚下，双手握带', '髋部后推，上身前倾', '髋部前推站起'],
  '弹力带站姿侧屈': ['站姿，右手握弹力带踩在右脚下', '上身向左侧弯，拉伸右侧腰', '回到中立，换另一侧'],
  '弹力带站姿抗旋': ['站姿侧对弹力带固定点，双手握带在胸前', '双手前伸，核心抗旋转保持稳定', '保持5秒，换另一侧'],
  '弹力带肩外旋': ['站姿双手握弹力带，屈肘90度贴紧身体', '双手向外旋转，肘部保持贴身，拉开弹力带', '缓慢有控制地回到起始位'],
  '弹力带肩推': ['站姿，双手握弹力带在肩部两侧', '双手向上推至手臂伸直', '缓慢放下至肩部'],
  '弹力带肩胛后缩': ['俯卧，弹力带套在双手', '双臂成W形，肩胛骨后缩', '缓慢伸直双臂'],
  '弹力带胸推': ['弹力带绕背后，双手握带前推', '双手向前推至手臂伸直，胸肌发力', '缓慢收回'],
  '弹力带腕伸展': ['坐姿，弹力带套在前脚掌，双手拉紧', '脚背向上勾起，对抗弹力带', '缓慢放下'],
  '弹力带腕屈曲': ['坐姿，弹力带套在前脚掌，固定另一端', '脚尖向下踩，对抗弹力带', '缓慢回到中立'],
  '弹力带臀kickback': ['站姿，弹力带套在脚踝，手扶墙', '右腿向后踢，臀部发力', '缓慢放下，换另一侧'],
  '弹力带臀桥': ['侧卧，弹力带套在膝盖上方', '上膝打开，脚跟并拢，臀中肌发力', '缓慢合拢膝盖'],
  '弹力带臀桥外展': ['仰卧，弹力带套在膝盖上方，双脚踩地', '臀部顶起成桥式，在最高点双膝向外打开', '双膝合拢，缓慢放下臀部'],
  '弹力带面拉': ['双手握弹力带与眼同高，双臂前伸', '向面部拉弹力带，双手到头部两侧，夹紧肩胛骨', '缓慢伸直双臂回到起始位'],
  '弹力带髋外展': ['侧卧，弹力带套在双腿膝盖上方', '上腿向外打开对抗弹力带阻力，髋部保持稳定', '缓慢有控制地放下上腿'],
  '快乐婴儿式': ['仰卧，双膝向腋下拉', '双手握住脚掌，膝盖向外', '轻摇放松下背'],
  '快速登山者': ['平板支撑位开始', '右膝快速拉向胸部', '换左膝，交替进行'],
  '悬垂举腿模拟': ['挂单杠或撑椅子，双腿下垂', '抬膝至髋高或更高', '缓慢放下'],
  '手指张开弹力带': ['双手握拳', '用力张开五指，伸展到最大', '再次握拳，重复'],
  '手腕绕圈': ['双手十指交叉', '顺时针绕圈活动手腕', '逆时针绕圈活动手腕'],
  '提踵': ['站姿，前脚掌踩台阶边缘', '脚跟下压拉伸小腿', '踮脚站起，重复'],
  '死虫式': ['仰卧，双臂伸直指向天花板，双腿屈膝90度', '缓慢伸直右臂过头，同时左腿向地面伸直，核心收紧', '回到起始位，换对侧重复'],
  '波比+俯卧撑': ['站姿开始', '下蹲撑地，跳回平板，做俯卧撑', '跳回蹲位，站起跳起'],
  '波比+跳高': ['站姿开始', '下蹲撑地，跳回平板', '跳回蹲位，全力跳高'],
  '波比跳': ['站姿开始', '下蹲双手撑地，跳回平板支撑', '跳回蹲位，站起跳起'],
  '深蹲': ['双脚与肩同宽，脚尖微外八', '臀部后坐下蹲，膝盖对准脚尖方向', '蹲至大腿平行地面，站起'],
  '深蹲跳': ['站姿，双脚与肩同宽', '下蹲蓄力，跳起尽量高', '落地深蹲，继续下一次'],
  '游泳式': ['俯卧，双臂前伸', '双臂交替前伸后拉，如游泳动作', '保持核心稳定'],
  '猫牛式': ['四点跪姿，脊柱中立', '背部向上拱起（猫式），下巴收向胸口', '腹部下沉（牛式），胸腔和尾骨上提，目视前方'],
  '登山者': ['平板支撑位开始', '右膝拉向胸部', '换左膝，快速交替'],
  '眼镜蛇式': ['俯卧，双手放肩旁，额头触地', '双手撑地，缓慢抬起上半身，延展脊柱', '保持延展，缓慢放下'],
  '祈祷式拉伸': ['跪坐，双膝分开，大脚趾相触', '上身前倾，双臂前伸', '额头触地，放松呼吸'],
  '空心体保持': ['仰卧，双臂过头', '抬起肩胛和双腿，下背贴地', '保持，核心收紧'],
  '箭步跳': ['弓步蹲位开始', '跳起换腿', '落地成另一侧弓步'],
  '箭步蹲': ['站立，右脚向前迈一大步', '下蹲至双膝90度，前膝不超过脚尖', '站起，换另一侧'],
  '胸椎伸展': ['坐姿，双手抱头', '上身向后伸展，打开胸椎', '回到中立'],
  '胸椎旋转': ['四点跪姿，一手抱头', '转体向上，眼睛跟随手肘', '换另一侧'],
  '脊柱扭转': ['仰卧，双臂侧平举', '屈右膝，右腿跨过身体向左扭转', '保持扭转，换另一侧'],
  '腘绳肌拉伸': ['站立，双脚与髋同宽', '从髋部折叠向前，双手触地或抱小腿', '保持拉伸，深呼吸放松'],
  '臀桥': ['仰卧屈膝，双脚与髋同宽踩地', '臀部发力向上顶，在最高点夹紧臀部', '缓慢有控制地放下臀部'],
  '自行车卷腹': ['仰卧，双手抱头', '右肘碰左膝，右腿伸直', '换左肘碰右膝，交替'],
  '蝴蝶式': ['坐姿，双脚掌相对，双膝向两侧打开', '双手握脚，上身前倾加深拉伸', '保持拉伸，深呼吸'],
  '超人式': ['俯卧，双臂前伸，双腿伸直', '同时抬起双臂、胸部和双腿，下背和臀部发力', '在最高点保持，缓慢放下'],
  '超人式保持': ['俯卧，双臂前伸', '同时抬起双臂和双腿', '保持，下背发力'],
  '跳跃箭步蹲': ['弓步蹲位开始', '跳起换腿', '落地成另一侧弓步'],
  '门框胸肌拉伸': ['站在门框中，双臂屈肘90度抵住门框', '身体前倾穿过门框，感受胸部拉伸', '保持拉伸，然后退回放松'],
  '阻力俯卧撑': ['平板支撑位，弹力带绕过背部双手握住', '屈肘下压，对抗弹力带阻力', '推起回到起始，重复'],
  '青蛙式': ['四点跪姿，双膝向两侧大开，脚尖朝外', '臀部后坐向脚跟，前臂撑地，感受大腿内侧深度拉伸', '保持拉伸，深呼吸，进一步放松'],
  '靠墙天使': ['靠墙站立，双臂成W形贴墙', '双臂沿墙向上滑过头顶', '滑回W形，肩胛后缩'],
  '颈部侧拉伸': ['坐直，右手过头轻拉左耳向右肩', '保持拉伸，左肩下沉，感受颈部左侧拉伸', '放松，换另一侧拉伸'],
  '高抬腿': ['站姿，挺胸收腹', '右膝快速抬高至髋部', '换左膝，交替进行'],
  '鸟狗式': ['四点跪姿，手在肩正下方，膝在髋正下方', '同时伸直右臂和左腿，身体保持水平', '回到起始，换对侧重复'],
  '鸽子式': ['右腿弯曲在前，左腿向后伸直', '上身前折叠在右腿上，双臂前伸，放松拉伸', '保持深度拉伸，换另一侧'],
  '龙旗退阶': ['仰卧，双手抓住固定物', '抬起双腿和臀部，肩胛离地', '缓慢放下，不触地'],
};

// 步骤轮播状态
let stepCarousel = {
  currentStep: 0,
  totalSteps: 0,
  timerId: null,
  stepDuration: 0, // 每步持续时间(ms)
};

// 图片预加载缓存
const imgPreloadCache = {};

function preloadExerciseImages(exName) {
  // 预加载主图和步骤图
  const mainSrc = `/img/workout_guide/${exName}.jpg`;
  const steps = EXERCISE_STEPS[exName];
  const toLoad = [mainSrc];
  if (steps) {
    for (let i = 1; i < steps.length; i++) {
      toLoad.push(`/img/workout_guide/${exName}_s${i}.jpg`);
    }
  }
  toLoad.forEach(src => {
    if (!imgPreloadCache[src]) {
      const img = new Image();
      img.src = src;
      imgPreloadCache[src] = img;
    }
  });
}

function preloadNextExercise() {
  const ch = workoutState.challenge;
  // 预加载当前+1和+2的动作图片
  for (let offset = 1; offset <= 2; offset++) {
    const nextIdx = workoutState.exerciseIdx + offset;
    if (nextIdx < ch.exercises.length) {
      preloadExerciseImages(ch.exercises[nextIdx].name);
    }
  }
}

function startStepCarousel(exName, totalDuration, isRestPreview = false) {
  // 清除之前的轮播
  stopStepCarousel();
  
  const steps = EXERCISE_STEPS[exName];
  if (!steps || steps.length <= 1) {
    // 无步骤数据或只有1步，不轮播
    stepCarousel.totalSteps = 0;
    $('workout-step-dots').innerHTML = '';
    $('workout-step-tip').textContent = steps ? `① ${steps[0]}` : '';
    return;
  }
  
  stepCarousel.totalSteps = steps.length;
  stepCarousel.currentStep = 0;
  // 休息预览模式：每个步骤停留更长时间（8秒），不播报语音
  stepCarousel.stepDuration = isRestPreview ? 8000 : (totalDuration * 1000) / steps.length;
  stepCarousel.exName = exName;
  stepCarousel.isRestPreview = isRestPreview;
  
  // 渲染步骤圆点（可点击切换）
  const dotsEl = $('workout-step-dots');
  dotsEl.innerHTML = steps.map((_, i) => 
    `<div class="workout-step-dot${i === 0 ? ' active' : ''}" data-step="${i}"></div>`
  ).join('');
  
  // 点击圆点手动切换步骤
  dotsEl.onclick = (e) => {
    const dot = e.target.closest('.workout-step-dot');
    if (!dot) return;
    const newStep = parseInt(dot.dataset.step);
    if (newStep === stepCarousel.currentStep) return;
    stepCarousel.currentStep = newStep;
    showStepImage(exName, newStep);
    dotsEl.querySelectorAll('.workout-step-dot').forEach((d, i) => {
      d.classList.toggle('active', i === newStep);
    });
    const markers = ['①','②','③','④'];
    $('workout-step-tip').textContent = `${markers[newStep] || (newStep+1)+'.'} ${steps[newStep]}`;
    // 休息预览模式不播报，运动模式才播报
    if (!isRestPreview) {
      playVoice(`step_${exName}_${newStep}`);
      playSynthBeep(1);
    }
    // 重置自动轮播计时器
    clearInterval(stepCarousel.timerId);
    stepCarousel.timerId = setInterval(autoStep, stepCarousel.stepDuration);
  };
  
  // 显示第一步提示
  $('workout-step-tip').textContent = `① ${steps[0]}`;
  
  // 显示第一步图片
  showStepImage(exName, 0);
  
  // 运动模式：播报第一步；休息预览模式：不播报（已在workoutSpeakRest播过）
  if (!isRestPreview) {
    playVoice(`step_${exName}_0`);
  }
  
  // 自动轮播
  function autoStep() {
    stepCarousel.currentStep++;
    if (stepCarousel.currentStep >= steps.length) {
      stepCarousel.currentStep = 0; // 循环
    }
    showStepImage(exName, stepCarousel.currentStep);
    
    // 更新圆点
    dotsEl.querySelectorAll('.workout-step-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === stepCarousel.currentStep);
    });
    
    // 更新提示
    const stepNum = stepCarousel.currentStep + 1;
    const markers = ['①','②','③','④'];
    const tipText = `${markers[stepNum-1] || stepNum+'.'} ${steps[stepCarousel.currentStep]}`;
    $('workout-step-tip').textContent = tipText;
    
    // 运动模式：播报动作要领；休息预览模式：只滴声不播报
    if (!isRestPreview) {
      playVoice(`step_${exName}_${stepCarousel.currentStep}`);
    }
    playSynthBeep(1);
  }
  
  stepCarousel.timerId = setInterval(autoStep, stepCarousel.stepDuration);
}

function showStepImage(exName, stepIdx) {
  const imgEl = $('workout-full-img');
  const bgEl = $('workout-full-bg');
  const phEl = $('workout-full-placeholder');
  
  let src;
  if (stepIdx === 0) {
    src = `/img/workout_guide/${exName}.jpg`;
  } else {
    src = `/img/workout_guide/${exName}_s${stepIdx}.jpg`;
  }
  
  // 检查是否已预加载（缓存中有完整图片）
  const cached = imgPreloadCache[src];
  
  // 淡出切换
  imgEl.classList.add('fade-out');
  const fadeDelay = cached ? 100 : 200; // 已缓存的切换更快
  
  setTimeout(() => {
    imgEl.src = src;
    bgEl.src = src; // 同步模糊背景
    imgEl.onload = () => {
      imgEl.classList.remove('fade-out');
      imgEl.style.display = '';
      bgEl.style.display = '';
      phEl.style.display = 'none';
    };
    imgEl.onerror = () => {
      // 步骤图不存在，fallback到主图
      if (stepIdx > 0) {
        imgEl.src = `/img/workout_guide/${exName}.jpg`;
        bgEl.src = `/img/workout_guide/${exName}.jpg`;
      } else {
        imgEl.style.display = 'none';
        bgEl.style.display = 'none';
        phEl.style.display = '';
        phEl.textContent = '🏋️';
      }
      imgEl.classList.remove('fade-out');
    };
  }, fadeDelay);
}

function stopStepCarousel() {
  if (stepCarousel.timerId) {
    clearInterval(stepCarousel.timerId);
    stepCarousel.timerId = null;
  }
  stepCarousel.totalSteps = 0;
  stepCarousel.currentStep = 0;
}

const WORKOUT_CHALLENGES = [
  {
    id: 'core_starter', name: '🏰 核心觉醒', desc: '唤醒沉睡的核心肌群，对抗腰痛第一战！',
    icon: '🏰', cover: 'core_starter.jpg', difficulty: 'easy', duration: 5, target: ['核心','腹肌'],
    exercises: [
      { name: '死虫式', img: '死虫式.svg', dur: 45, rest: 15, desc: '仰卧，对侧手脚缓慢下放后还原', band: false },
      { name: '平板支撑', img: '平板支撑.svg', dur: 45, rest: 15, desc: '前臂撑地，身体成直线，收紧核心', band: false },
      { name: '鸟狗式', img: '鸟狗式.svg', dur: 45, rest: 15, desc: '四点跪姿，对侧手脚伸展保持2秒', band: false },
      { name: '仰卧卷腹', img: '仰卧卷腹.svg', dur: 45, rest: 15, desc: '屈膝，肩胛骨离地即可，慢起慢落', band: false },
      { name: '臀桥', img: '臀桥.svg', dur: 45, rest: 15, desc: '仰卧屈膝，臀部发力顶起至直线', band: false }
    ]
  },
  {
    id: 'neck_shoulder', name: '🦢 天鹅颈行动', desc: '对抗低头族诅咒！释放颈肩紧张',
    icon: '🦢', cover: 'neck_shoulder.jpg', difficulty: 'easy', duration: 5, target: ['颈部','肩部'],
    exercises: [
      { name: '颈部侧拉伸', img: '颈部侧拉伸.svg', dur: 45, rest: 15, desc: '手拉头向侧，对侧肩下沉', band: false },
      { name: '弹力带肩外旋', img: '弹力带肩外旋.svg', dur: 45, rest: 15, desc: '肘贴肋，前臂外旋，强化肩袖', band: true },
      { name: 'W-Y伸展', img: 'W-Y伸展.svg', dur: 45, rest: 15, desc: '俯卧，双臂W→Y形上抬，挤压肩胛', band: false },
      { name: '门框胸肌拉伸', img: '门框胸肌拉伸.svg', dur: 45, rest: 15, desc: '前臂抵门框，身体前倾拉伸胸肌', band: false },
      { name: '弹力带面拉', img: '弹力带面拉.svg', dur: 45, rest: 15, desc: '弹力带拉向面部，肩胛后缩', band: true }
    ]
  },
  {
    id: 'hip_rescue', name: '🦵 髋部解放者', desc: '久坐髋屈肌紧绷如铁？重获新生！',
    icon: '🦵', cover: 'hip_rescue.jpg', difficulty: 'easy', duration: 5, target: ['髋部','臀部'],
    exercises: [
      { name: '低弓步拉伸', img: '低弓步拉伸.svg', dur: 45, rest: 15, desc: '单腿跪地，髋部前推拉伸腹股沟', band: false },
      { name: '鸽子式', img: '鸽子式.svg', dur: 45, rest: 15, desc: '前腿屈膝，身体前倾加深臀部拉伸', band: false },
      { name: '弹力带髋外展', img: '弹力带髋外展.svg', dur: 45, rest: 15, desc: '弹力带套膝上，侧卧抬腿强化臀中肌', band: true },
      { name: '青蛙式', img: '青蛙式.svg', dur: 45, rest: 15, desc: '四肢着地，膝盖外开，髋部后坐', band: false },
      { name: '弹力带臀桥外展', img: '弹力带臀桥外展.svg', dur: 45, rest: 15, desc: '弹力带套膝，臀桥顶峰双膝外开', band: true }
    ]
  },
  {
    id: 'back_shield', name: '🛡️ 钢铁背脊', desc: '打造护盾般的背部，无惧腰背酸痛！',
    icon: '🛡️', cover: 'back_shield.jpg', difficulty: 'easy', duration: 7, target: ['背部','竖脊肌'],
    exercises: [
      { name: '猫牛式', img: '猫牛式.svg', dur: 45, rest: 15, desc: '吸气塌腰抬头，呼气拱背低头', band: false },
      { name: '弹力带划船', img: '弹力带划船.svg', dur: 45, rest: 15, desc: '弹力带绕脚底，向后拉肩胛后缩', band: true },
      { name: '超人式', img: '超人式.svg', dur: 45, rest: 15, desc: '俯卧，同时抬起手脚保持2秒', band: false },
      { name: '弹力带直臂下压', img: '弹力带直臂下压.svg', dur: 45, rest: 15, desc: '弹力带固定高处，直臂下压激活背阔肌', band: true },
      { name: '眼镜蛇式', img: '眼镜蛇式.svg', dur: 45, rest: 15, desc: '俯卧，撑起上半身延展脊柱', band: false },
      { name: '弹力带反向飞鸟', img: '弹力带反向飞鸟.svg', dur: 45, rest: 15, desc: '双手持带，双臂向两侧打开', band: true }
    ]
  },
  {
    id: 'stretch_recover', name: '🌙 月光恢复术', desc: '战斗后的恢复仪式，全身深度拉伸',
    icon: '🌙', cover: 'stretch_recover.jpg', difficulty: 'easy', duration: 7, target: ['拉伸','恢复'],
    exercises: [
      { name: '婴儿式', img: '婴儿式.svg', dur: 45, rest: 15, desc: '跪坐，双臂前伸，额头贴地放松', band: false },
      { name: '下犬式', img: '下犬式.svg', dur: 45, rest: 15, desc: '臀部上推成倒V，脚跟下压', band: false },
      { name: '脊柱扭转', img: '脊柱扭转.svg', dur: 45, rest: 15, desc: '仰卧，一腿跨过，膝盖倒向一侧', band: false },
      { name: '腘绳肌拉伸', img: '腘绳肌拉伸.svg', dur: 45, rest: 15, desc: '坐姿，一腿伸直，向前折叠触脚尖', band: false },
      { name: '蝴蝶式', img: '蝴蝶式.svg', dur: 45, rest: 15, desc: '脚心相对，膝盖下压，身体前倾', band: false },
      { name: '快乐婴儿式', img: '快乐婴儿式.svg', dur: 45, rest: 15, desc: '仰卧，双手握脚外侧，膝拉向腋下', band: false }
    ]
  },
  {
    id: 'upper_blitz', name: '⚔️ 上肢突袭', desc: '胸肩臂全面强化，锻造程序员力量上限',
    icon: '⚔️', cover: 'upper_blitz.jpg', difficulty: 'medium', duration: 7, target: ['胸肌','肩部','手臂'],
    exercises: [
      { name: '弹力带胸推', img: '弹力带胸推.svg', dur: 45, rest: 15, desc: '弹力带绕背，双手向前推', band: true },
      { name: '俯卧撑', img: '俯卧撑.svg', dur: 45, rest: 15, desc: '标准俯卧撑，身体成直线', band: false },
      { name: '弹力带肩推', img: '弹力带肩推.svg', dur: 45, rest: 15, desc: '踩住弹力带，双手肩上推举', band: true },
      { name: '弹力带弯举', img: '弹力带弯举.svg', dur: 45, rest: 15, desc: '踩住弹力带，双手弯举', band: true },
      { name: '弹力带三头下压', img: '弹力带三头下压.svg', dur: 45, rest: 15, desc: '弹力带固定高处，双手下压伸臂', band: true },
      { name: '阻力俯卧撑', img: '阻力俯卧撑.svg', dur: 45, rest: 15, desc: '弹力带绕背增加阻力做俯卧撑', band: true },
      { name: '弹力带侧平举', img: '弹力带侧平举.svg', dur: 45, rest: 15, desc: '踩住弹力带，双臂侧抬至肩高', band: true }
    ]
  },
  {
    id: 'lower_power', name: '🦿 下肢引擎', desc: '强化臀腿，站立办公稳如泰山',
    icon: '🦿', cover: 'lower_power.jpg', difficulty: 'medium', duration: 7, target: ['臀部','大腿'],
    exercises: [
      { name: '深蹲', img: '深蹲.svg', dur: 45, rest: 15, desc: '双脚与肩同宽，臀部后坐下蹲', band: false },
      { name: '弹力带深蹲', img: '弹力带深蹲.svg', dur: 45, rest: 15, desc: '弹力带套大腿，深蹲时膝对抗阻力', band: true },
      { name: '箭步蹲', img: '箭步蹲.svg', dur: 45, rest: 15, desc: '前后腿交替下蹲，后膝近地', band: false },
      { name: '弹力带臀kickback', img: '弹力带臀kickback.svg', dur: 45, rest: 15, desc: '四点跪姿，弹力带套脚，单腿后上踢', band: true },
      { name: '保加利亚分腿蹲', img: '保加利亚分腿蹲.svg', dur: 45, rest: 15, desc: '后脚放椅子，前腿单腿下蹲', band: false },
      { name: '弹力带髋外展', img: '弹力带髋外展.svg', dur: 45, rest: 15, desc: '弹力带套脚踝，单腿侧抬', band: true },
      { name: '提踵', img: '提踵.svg', dur: 45, rest: 15, desc: '前掌踩台阶边缘，脚跟下放后踮起', band: false }
    ]
  },
  {
    id: 'full_circuit', name: '🌀 漩涡风暴', desc: '全身肌群终极考验，效率巅峰',
    icon: '🌀', cover: 'full_circuit.jpg', difficulty: 'medium', duration: 7, target: ['全身','心肺'],
    exercises: [
      { name: '开合跳', img: '开合跳.svg', dur: 45, rest: 15, desc: '双脚跳开双手上举，再跳回', band: false },
      { name: '弹力带深蹲推举', img: '弹力带深蹲推举.svg', dur: 45, rest: 15, desc: '踩弹力带，下蹲站起时双手上推', band: true },
      { name: '登山者', img: '登山者.svg', dur: 45, rest: 15, desc: '平板姿势，双腿交替向胸前跑', band: false },
      { name: '弹力带划船+深蹲', img: '弹力带划船+深蹲.svg', dur: 45, rest: 15, desc: '深蹲同时做弹力带划船', band: true },
      { name: '波比跳', img: '波比跳.svg', dur: 45, rest: 15, desc: '下蹲-后跳平板-跳回-跳起', band: false },
      { name: '弹力带硬拉', img: '弹力带硬拉.svg', dur: 45, rest: 15, desc: '踩弹力带，髋铰链前倾臀后推', band: true },
      { name: '平板转侧平板', img: '平板转侧平板.svg', dur: 45, rest: 15, desc: '平板支撑，交替转向左右侧平板', band: false }
    ]
  },
  {
    id: 'core_furnace', name: '🔥 核心熔炉', desc: '燃烧腹部脂肪，召唤六块神兵！',
    icon: '🔥', cover: 'core_furnace.jpg', difficulty: 'medium', duration: 7, target: ['核心','侧腹'],
    exercises: [
      { name: '仰卧抬腿', img: '仰卧抬腿.svg', dur: 45, rest: 15, desc: '双腿伸直上抬90度，慢放不触地', band: false },
      { name: '俄罗斯转体', img: '俄罗斯转体.svg', dur: 45, rest: 15, desc: '双脚离地，双手合十左右转体', band: false },
      { name: '弹力带卷腹', img: '弹力带卷腹.svg', dur: 45, rest: 15, desc: '弹力带固定高处，跪姿卷腹下拉', band: true },
      { name: '侧平板支撑', img: '侧平板支撑.svg', dur: 45, rest: 15, desc: '侧卧前臂撑地，身体成直线', band: false },
      { name: '自行车卷腹', img: '自行车卷腹.svg', dur: 45, rest: 15, desc: '对侧肘膝相触，交替进行', band: false },
      { name: '弹力带站姿侧屈', img: '弹力带站姿侧屈.svg', dur: 45, rest: 15, desc: '弹力带单侧踩住，侧屈拉伸对侧腹', band: true },
      { name: 'V字支撑', img: 'V字支撑.svg', dur: 45, rest: 15, desc: '双腿和上半身抬起成V形保持', band: false }
    ]
  },
  {
    id: 'posture_eagle', name: '🦅 雄鹰展翅', desc: '告别驼背圆肩，重塑挺拔身姿',
    icon: '🦅', cover: 'posture_eagle.jpg', difficulty: 'medium', duration: 7, target: ['体态','肩胛'],
    exercises: [
      { name: '胸椎旋转', img: '胸椎旋转.svg', dur: 45, rest: 15, desc: '侧卧，上方手臂向后旋转', band: false },
      { name: '弹力带YTW伸展', img: '弹力带YTW伸展.svg', dur: 45, rest: 15, desc: '俯卧，弹力带绕手，依次Y-T-W上抬', band: true },
      { name: '靠墙天使', img: '靠墙天使.svg', dur: 45, rest: 15, desc: '背靠墙，双臂W贴墙上下滑动', band: false },
      { name: '弹力带扩胸', img: '弹力带扩胸.svg', dur: 45, rest: 15, desc: '双手持带于胸前，双臂向两侧打开', band: true },
      { name: '下巴后缩', img: '下巴后缩.svg', dur: 45, rest: 15, desc: '坐直，下巴水平后收如做双下巴', band: false },
      { name: '弹力带肩胛后缩', img: '弹力带肩胛后缩.svg', dur: 45, rest: 15, desc: '双手持带，手臂伸直肩胛夹紧', band: true },
      { name: '胸椎伸展', img: '胸椎伸展.svg', dur: 45, rest: 15, desc: '仰卧，毛巾卷放上背，向后仰', band: false }
    ]
  },
  {
    id: 'hiit_lightning', name: '⚡ 闪电突袭', desc: '30秒全力输出，让心率飙升！',
    icon: '⚡', cover: 'hiit_lightning.jpg', difficulty: 'medium', duration: 7, target: ['HIIT','燃脂'],
    exercises: [
      { name: '高抬腿', img: '高抬腿.svg', dur: 45, rest: 15, desc: '原地快速跑，膝盖抬至髋高', band: false },
      { name: '深蹲跳', img: '深蹲跳.svg', dur: 45, rest: 15, desc: '深蹲后全力跳起，落地缓冲', band: false },
      { name: '俯卧撑跳转', img: '俯卧撑跳转.svg', dur: 45, rest: 15, desc: '俯卧撑姿势，双腿跳开跳回', band: false },
      { name: '箭步跳', img: '箭步跳.svg', dur: 45, rest: 15, desc: '箭步蹲姿势跳起换腿', band: false },
      { name: '快速登山者', img: '快速登山者.svg', dur: 45, rest: 15, desc: '平板姿势，双腿快速交替跑', band: false },
      { name: '开合跳俯卧撑', img: '开合跳俯卧撑.svg', dur: 45, rest: 15, desc: '站立-下蹲-平板-俯卧撑-跳起', band: false },
      { name: '波比跳', img: '波比跳.svg', dur: 45, rest: 15, desc: '完整波比跳，全力爆发', band: false }
    ]
  },
  {
    id: 'wrist_guard', name: '🛡️ 腕盾守护', desc: '保护手腕前臂，远离RSI和腱鞘炎！',
    icon: '🛡️', cover: 'wrist_guard.jpg', difficulty: 'medium', duration: 5, target: ['手腕','前臂'],
    exercises: [
      { name: '手腕绕圈', img: '手腕绕圈.svg', dur: 45, rest: 15, desc: '双手握拳，顺逆时针各绕15圈', band: false },
      { name: '弹力带腕屈曲', img: '弹力带腕屈曲.svg', dur: 45, rest: 15, desc: '前臂放腿上，弹力带绕手掌上卷', band: true },
      { name: '弹力带腕伸展', img: '弹力带腕伸展.svg', dur: 45, rest: 15, desc: '掌心向下，弹力带绕手背上抬', band: true },
      { name: '手指张开弹力带', img: '手指张开弹力带.svg', dur: 45, rest: 15, desc: '弹力带套五指，手指用力张开', band: true },
      { name: '祈祷式拉伸', img: '祈祷式拉伸.svg', dur: 45, rest: 15, desc: '双手合十胸前，手指向上，下压', band: false },
      { name: '前臂拉伸', img: '前臂拉伸.svg', dur: 45, rest: 15, desc: '手臂伸直，另一手向后拉手指', band: false }
    ]
  },
  {
    id: 'beast_core', name: '👹 野兽模式', desc: '核心极限挑战！只有真正战士才能完成',
    icon: '👹', cover: 'beast_core.jpg', difficulty: 'hard', duration: 10, target: ['核心极限'],
    exercises: [
      { name: '平板支撑60秒', img: '平板支撑60秒.svg', dur: 60, rest: 15, desc: '标准平板，核心收紧', band: false },
      { name: '悬垂举腿模拟', img: '悬垂举腿模拟.svg', dur: 45, rest: 15, desc: '仰卧，双手垫臀下，直腿上抬过垂直', band: false },
      { name: '弹力带死虫式', img: '弹力带死虫式.svg', dur: 45, rest: 15, desc: '弹力带固定，死虫式对抗阻力', band: true },
      { name: '侧平板抬腿', img: '侧平板抬腿.svg', dur: 45, rest: 15, desc: '侧平板姿势，上腿抬起下放', band: false },
      { name: '龙旗退阶', img: '龙旗退阶.svg', dur: 45, rest: 15, desc: '仰卧，双手抓固定物，臀腿上抬', band: false },
      { name: '弹力带站姿抗旋', img: '弹力带站姿抗旋.svg', dur: 45, rest: 15, desc: '弹力带侧向固定，双手胸前持带抗旋', band: true },
      { name: '弹力带AB轮模拟', img: '弹力带AB轮模拟.svg', dur: 45, rest: 15, desc: '跪姿，弹力带向前伸展卷腹再收回', band: true },
      { name: '平板爬行', img: '平板爬行.svg', dur: 45, rest: 15, desc: '平板姿势，前臂交替向前爬再退回', band: false },
      { name: '弹力带俄罗斯转体', img: '弹力带俄罗斯转体.svg', dur: 45, rest: 15, desc: '弹力带固定侧面，双手持带转体', band: true },
      { name: '空心体保持', img: '空心体保持.svg', dur: 60, rest: 15, desc: '仰卧，头肩和双腿离地，下背贴地', band: false }
    ]
  },
  {
    id: 'hiit_inferno', name: '🌋 地狱火', desc: '45秒高强度10秒喘息，存活即传奇！',
    icon: '🌋', cover: 'hiit_inferno.jpg', difficulty: 'hard', duration: 10, target: ['HIIT极限','燃脂'],
    exercises: [
      { name: '波比跳', img: '波比跳.svg', dur: 45, rest: 10, desc: '完整波比跳，全力爆发', band: false },
      { name: '深蹲跳', img: '深蹲跳.svg', dur: 45, rest: 10, desc: '深蹲后全力跳起', band: false },
      { name: '弹力带深蹲跳', img: '弹力带深蹲跳.svg', dur: 45, rest: 10, desc: '弹力带增加阻力深蹲跳', band: true },
      { name: '波比+俯卧撑', img: '波比+俯卧撑.svg', dur: 45, rest: 10, desc: '波比跳加入俯卧撑', band: false },
      { name: '登山者', img: '登山者.svg', dur: 45, rest: 10, desc: '平板姿势，双腿快速交替跑', band: false },
      { name: '弹力带开合跳', img: '弹力带开合跳.svg', dur: 45, rest: 10, desc: '弹力带套腿，开合跳加阻力', band: true },
      { name: '箭步跳', img: '箭步跳.svg', dur: 45, rest: 10, desc: '箭步蹲跳起换腿', band: false },
      { name: '高抬腿', img: '高抬腿.svg', dur: 45, rest: 10, desc: '原地快速高抬腿跑', band: false },
      { name: '弹力带冲刺', img: '弹力带冲刺.svg', dur: 45, rest: 10, desc: '弹力带固定身后，原地冲刺对抗阻力', band: true },
      { name: '波比+跳高', img: '波比+跳高.svg', dur: 45, rest: 10, desc: '波比跳后全力向上跳摸高', band: false }
    ]
  },
  {
    id: 'iron_back', name: '🦾 钢铁之背', desc: '拉力+稳定+力量三位一体，背部霸主！',
    icon: '🦾', cover: 'iron_back.jpg', difficulty: 'hard', duration: 10, target: ['背部极限','后链'],
    exercises: [
      { name: '弹力带引体模拟', img: '弹力带引体模拟.svg', dur: 45, rest: 15, desc: '弹力带固定高处，跪姿下拉模拟引体', band: true },
      { name: '弹力带单臂划船', img: '弹力带单臂划船.svg', dur: 45, rest: 15, desc: '弹力带固定，单臂后拉肩胛后缩', band: true },
      { name: '超人式保持', img: '超人式保持.svg', dur: 45, rest: 15, desc: '俯卧，手脚同时抬起保持', band: false },
      { name: '弹力带直臂下压', img: '弹力带直臂下压.svg', dur: 45, rest: 15, desc: '弹力带固定高处，直臂下压至大腿', band: true },
      { name: '反向雪天使', img: '反向雪天使.svg', dur: 45, rest: 15, desc: '俯卧，双臂从臀部划弧至头顶', band: false },
      { name: '弹力带硬拉', img: '弹力带硬拉.svg', dur: 45, rest: 15, desc: '踩弹力带，髋铰链前倾臀后推', band: true },
      { name: '弹力带面拉', img: '弹力带面拉.svg', dur: 45, rest: 15, desc: '弹力带拉向面部，肩胛后缩外旋', band: true },
      { name: '游泳式', img: '游泳式.svg', dur: 45, rest: 15, desc: '俯卧，对侧手脚交替抬起模拟游泳', band: false },
      { name: '弹力带反向飞鸟', img: '弹力带反向飞鸟.svg', dur: 45, rest: 15, desc: '弹力带绕手，双臂向两侧打开', band: true },
      { name: '山羊挺身模拟', img: '山羊挺身模拟.svg', dur: 45, rest: 15, desc: '俯卧，上半身抬起下放强化下背', band: false }
    ]
  },
  {
    id: 'leg_nightmare', name: '💀 腿日噩梦', desc: '传说完成的人第二天走路都成了奢望...',
    icon: '💀', cover: 'leg_nightmare.jpg', difficulty: 'hard', duration: 10, target: ['下肢极限','臀腿'],
    exercises: [
      { name: '弹力带深蹲', img: '弹力带深蹲.svg', dur: 45, rest: 15, desc: '弹力带套大腿，深蹲时膝对抗阻力', band: true },
      { name: '保加利亚分腿蹲', img: '保加利亚分腿蹲.svg', dur: 45, rest: 15, desc: '后脚垫高，前腿单腿下蹲', band: false },
      { name: '弹力带臀桥', img: '弹力带臀桥.svg', dur: 45, rest: 15, desc: '弹力带套髋部，臀桥对抗阻力', band: true },
      { name: '跳跃箭步蹲', img: '跳跃箭步蹲.svg', dur: 45, rest: 15, desc: '箭步蹲姿势跳起换腿', band: false },
      { name: '弹力带髋外展', img: '弹力带髋外展.svg', dur: 45, rest: 15, desc: '弹力带套脚踝，单腿侧抬', band: true },
      { name: '单腿硬拉', img: '单腿硬拉.svg', dur: 45, rest: 15, desc: '单腿站立，髋铰链前倾后腿后伸', band: false },
      { name: '弹力带臀kickback', img: '弹力带臀kickback.svg', dur: 45, rest: 15, desc: '四点跪姿，弹力带套脚后上踢', band: true },
      { name: '深蹲跳', img: '深蹲跳.svg', dur: 45, rest: 15, desc: '深蹲后全力跳起', band: false },
      { name: '弹力带侧步行走', img: '弹力带侧步行走.svg', dur: 45, rest: 15, desc: '弹力带套腿，半蹲姿势侧向走', band: true },
      { name: '单腿提踵', img: '单腿提踵.svg', dur: 45, rest: 15, desc: '单腿脚跟下放后踮起', band: false }
    ]
  }
];

// 运动XP奖励
const WORKOUT_XP = { easy: 50, medium: 75, hard: 120 };
// 估算卡路里（每分钟）
const CAL_PER_MIN = { easy: 5, medium: 8, hard: 11 };

let workoutState = {
  active: false,
  paused: false,
  challenge: null,
  exerciseIdx: 0,
  isRest: false,
  timeLeft: 0,
  timerId: null,
  filter: 'all',
  listIdx: 0
};

// 运动选择导航实例
const workoutSelectNav = new ListNav({
  container: 'workout-list',
  item: '.workout-item',
  focusedClass: 'focused',
  onSelect: (idx, el) => {
    const filtered = workoutState.filter === 'all'
      ? WORKOUT_CHALLENGES
      : WORKOUT_CHALLENGES.filter(c => c.difficulty === workoutState.filter);
    if (filtered[idx]) startWorkout(filtered[idx].id);
  },
  onEscape: () => {
    focusMode = 'kanban';
    $('workout-select').classList.add('hidden');
  },
  onFilter: (dir) => {
    const filters = ['all', 'easy', 'medium', 'hard'];
    const curIdx = filters.indexOf(workoutState.filter);
    const newIdx = dir === 'left'
      ? (curIdx > 0 ? curIdx - 1 : -1)
      : (curIdx < filters.length - 1 ? curIdx + 1 : -1);
    if (newIdx === -1) { playSound('error'); return; }
    playSound('move');
    setWorkoutFilter(filters[newIdx]);
    workoutSelectNav.reset();
    workoutSelectNav.updateFocus();
  }
});

function openWorkoutSelect() {
  focusMode = 'workout-select';
  workoutState.filter = 'all';
  workoutSelectNav.reset();
  renderWorkoutList();
  $('workout-select').classList.remove('hidden');
  workoutSelectNav.updateFocus();
  // 更新筛选按钮
  document.querySelectorAll('.wf-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === 'all');
  });
}

function renderWorkoutList() {
  const list = $('workout-list');
  const filtered = workoutState.filter === 'all'
    ? WORKOUT_CHALLENGES
    : WORKOUT_CHALLENGES.filter(c => c.difficulty === workoutState.filter);
  
  list.innerHTML = filtered.map((c, i) => `
    <div class="workout-item" data-idx="${i}" data-id="${c.id}">
      ${c.cover ? `<img class="workout-item-cover" src="/img/workout_covers/${c.cover}" alt="${c.name}" />` : `<span class="workout-item-icon">${c.icon}</span>`}
      <div class="workout-item-info">
        <div class="workout-item-name">${c.name}</div>
        <div class="workout-item-desc">${c.desc}</div>
        <div class="workout-item-meta">
          <span class="${c.difficulty}">${c.difficulty === 'easy' ? '🟢新手' : c.difficulty === 'medium' ? '🟡进阶' : '🔴硬核'}</span>
          <span>⏱${c.duration}分钟</span>
          <span>${c.exercises.length}个动作</span>
          ${c.exercises.some(e => e.band) ? '<span>🎯需弹力带</span>' : ''}
        </div>
      </div>
    </div>
  `).join('');
  
  // 绑定点击
  list.querySelectorAll('.workout-item').forEach(el => {
    el.onclick = () => {
      workoutSelectNav.idx = parseInt(el.dataset.idx);
      const filtered2 = workoutState.filter === 'all'
        ? WORKOUT_CHALLENGES
        : WORKOUT_CHALLENGES.filter(c => c.difficulty === workoutState.filter);
      if (filtered2[workoutSelectNav.idx]) startWorkout(filtered2[workoutSelectNav.idx].id);
    };
  });
  
  workoutSelectNav.updateFocus();
}

function handleWorkoutSelectNav(e) {
  workoutSelectNav.handleKey(e);
}

function setWorkoutFilter(f) {
  workoutState.filter = f;
  workoutSelectNav.reset();
  renderWorkoutList();
  document.querySelectorAll('.wf-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === f);
  });
}

function startWorkout(challengeId) {
  const challenge = WORKOUT_CHALLENGES.find(c => c.id === challengeId);
  if (!challenge) return;
  
  workoutState.active = true;
  workoutState.paused = false;
  workoutState.challenge = challenge;
  workoutState.exerciseIdx = 0;
  workoutState.isRest = false;
  
  $('workout-select').classList.add('hidden');
  $('workout-overlay').classList.remove('hidden');
  focusMode = 'workout';
  
  // 运动开始音效+语音
  playSound('workout-start');
  workoutSpeakChallengeStart(challenge.id, challenge.name);
  
  // 延迟1.5秒后显示第一个动作
  setTimeout(() => showWorkoutExercise(), 1500);
}

// ═══ 运动音效（全部 Web Audio API 合成，不依赖 mp3 文件） ═══

// 合成滴声（不依赖mp3文件，避免缓存问题）
function playSynthBeep(count = 1) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  for (let i = 0; i < count; i++) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    const t = now + i * 0.18;
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.12);
  }
  // 返回模拟Audio对象的延迟时间(ms)
  return count * 180;
}

// 预合成语音队列播放
const voiceAudioCache = {};
const voice404Cache = new Set(); // 记住404的key，不再重试
let voiceQueue = [];
let voicePlaying = false;

function playVoice(key) {
  if (!key || voice404Cache.has(key)) return;
  voiceQueue.push(key);
  if (!voicePlaying) drainVoiceQueue();
}

function drainVoiceQueue() {
  if (voiceQueue.length === 0) {
    voicePlaying = false;
    return;
  }
  voicePlaying = true;
  const key = voiceQueue.shift();
  if (voice404Cache.has(key)) { drainVoiceQueue(); return; }
  const src = `/audio/workout/${key}.mp3`;
  let a = voiceAudioCache[src];
  if (!a) {
    a = new Audio(src);
    a.volume = 0.9;
    voiceAudioCache[src] = a;
  }
  a.currentTime = 0;
  a.onended = () => drainVoiceQueue();
  a.onerror = () => { voice404Cache.add(key); drainVoiceQueue(); };
  a.play().catch(() => { voice404Cache.add(key); drainVoiceQueue(); });
}

function clearVoiceQueue() {
  voiceQueue = [];
  voicePlaying = false;
  Object.values(voiceAudioCache).forEach(a => { a.pause(); a.currentTime = 0; });
}

// 播放挑战名（开场用）— 3声短促电子滴
function workoutSpeakChallengeStart(challengeId, challengeName) {
  playVoice('workout_start');
  playSynthBeep(3);
}

// 播放动作名
function workoutSpeakExercise(challengeId, exIdx) {
  const ch = WORKOUT_CHALLENGES.find(c => c.id === challengeId);
  if (!ch) return;
  const ex = ch.exercises[exIdx];
  if (!ex) return;
  playVoice(`ex_${ex.name}`);
  playSynthBeep(2);
}

// 播放休息提示 + 下一个动作名（简洁版，不播步骤要领）
function workoutSpeakRest(seconds, nextChallengeId, nextExIdx) {
  playVoice('rest');
  const ch = WORKOUT_CHALLENGES.find(c => c.id === nextChallengeId);
  if (ch) {
    const nextEx = ch.exercises[nextExIdx];
    if (nextEx) {
      // 休息2秒后只播报下一个动作名
      setTimeout(() => playVoice(`ex_${nextEx.name}`), 2000);
    }
  }
  playSynthBeep(3);
}

// 播放数字（倒计时3-2-1）
function workoutSpeakNumber(n) {
  playSynthBeep(1);
}

// 播放过半提示
function workoutSpeakHalfway() {
  playSynthBeep(2);
}

// 播放完成
function workoutSpeakComplete(challengeName, calories, xp) {
  playVoice('workout_complete');
  playSynthBeep(4);
}

function showWorkoutExercise() {
  const ch = workoutState.challenge;
  const ex = ch.exercises[workoutState.exerciseIdx];
  const isRest = workoutState.isRest;
  const totalTime = isRest ? ex.rest : ex.dur;
  
  $('workout-icon').textContent = '';
  $('workout-name').textContent = ch.name;
  $('workout-progress').textContent = `${workoutState.exerciseIdx + 1}/${ch.exercises.length}`;
  
  // 全屏动作指导图（步骤轮播模式）
  const imgEl = $('workout-full-img');
  const bgEl = $('workout-full-bg');
  const phEl = $('workout-full-placeholder');
  
  if (!isRest && ex.name) {
    // 预加载当前动作图片
    preloadExerciseImages(ex.name);
    // 启动步骤轮播
    startStepCarousel(ex.name, totalTime);
  } else if (isRest) {
    // 休息时只显示下一个动作的主图（不轮播步骤）
    stopStepCarousel();
    const nextEx = ch.exercises[workoutState.exerciseIdx + 1];
    if (nextEx) {
      // 预加载下一个动作图片
      preloadExerciseImages(nextEx.name);
      // 显示下一个动作的主图
      const mainSrc = `/img/workout_guide/${nextEx.name}.jpg`;
      imgEl.src = mainSrc;
      bgEl.src = mainSrc;
      imgEl.style.display = '';
      bgEl.style.display = '';
      phEl.style.display = 'none';
      $('workout-step-dots').innerHTML = '';
      $('workout-step-tip').textContent = nextEx.desc || '';
    } else {
      // 不应该到这里了（最后一个动作后不再进入休息）
      $('workout-step-dots').innerHTML = '';
      $('workout-step-tip').textContent = '';
      imgEl.style.display = 'none';
      bgEl.style.display = 'none';
      phEl.style.display = '';
      phEl.textContent = '🏆';
    }
  } else {
    stopStepCarousel();
    $('workout-step-dots').innerHTML = '';
    $('workout-step-tip').textContent = '';
    imgEl.style.display = 'none';
    bgEl.style.display = 'none';
    phEl.style.display = '';
    phEl.textContent = ch.icon;
  }
  
  // 圆圈倒计时
  const timerText = $('workout-timer');
  const timerFg = $('timer-fg');
  timerText.textContent = formatSec(totalTime);
  
  if (isRest) {
    timerText.className = 'timer-text rest';
    timerFg.className.baseVal = 'timer-fg rest';
    const nextEx = ch.exercises[workoutState.exerciseIdx + 1];
    if (nextEx) {
      $('workout-exercise').textContent = '⏳ ' + nextEx.name + (nextEx.band ? ' 🎯' : '');
      $('workout-desc').textContent = nextEx.desc || '准备开始';
    } else {
      $('workout-exercise').textContent = '😮‍💨 最后休息';
      $('workout-desc').textContent = '即将完成挑战！';
    }
    playSound('workout-rest');
    // 语音提示休息+下一个动作名
    workoutSpeakRest(ex.rest, ch.id, workoutState.exerciseIdx + 1);
  } else {
    timerText.className = 'timer-text';
    timerFg.className.baseVal = 'timer-fg';
    $('workout-exercise').textContent = ex.name + (ex.band ? ' 🎯' : '');
    $('workout-desc').textContent = ex.desc;
    playSound('workout-exercise');
    // 语音播报动作名+要领
    workoutSpeakExercise(ch.id, workoutState.exerciseIdx);
  }
  
  // 初始化圆圈进度为满
  const circumference = 2 * Math.PI * 44; // 276.46
  timerFg.style.strokeDasharray = circumference;
  timerFg.style.strokeDashoffset = '0';
  
  // 下一个动作预览
  if (isRest) {
    // 休息时已经在上方显示下一个动作名，这里不重复
    $('workout-next').textContent = '';
  } else if (workoutState.exerciseIdx + 1 < ch.exercises.length) {
    $('workout-next').textContent = `下一个：${ch.exercises[workoutState.exerciseIdx + 1].name}`;
  } else {
    $('workout-next').textContent = '🔥 最后一个！坚持住！';
  }
  
  // 进度条
  const totalEx = ch.exercises.length;
  const done = workoutState.exerciseIdx + (isRest ? 1 : 0);
  $('workout-bar-fill').style.width = `${(done / totalEx) * 100}%`;
  
  // 开始倒计时
  workoutState.timeLeft = isRest ? ex.rest : ex.dur;
  clearInterval(workoutState.timerId);
  workoutState.timerId = setInterval(workoutTick, 1000);
  
  // 预加载下一个动作的图片
  if (!isRest) preloadNextExercise();
}

function workoutTick() {
  if (workoutState.paused) return;
  
  workoutState.timeLeft--;
  const el = $('workout-timer');
  const timerFg = $('timer-fg');
  el.textContent = formatSec(workoutState.timeLeft);
  
  const totalTime = workoutState.isRest 
    ? workoutState.challenge.exercises[workoutState.exerciseIdx].rest
    : workoutState.challenge.exercises[workoutState.exerciseIdx].dur;
  
  // 更新圆圈进度
  const circumference = 2 * Math.PI * 44;
  const progress = 1 - (workoutState.timeLeft / totalTime);
  timerFg.style.strokeDashoffset = circumference * progress;
  
  // 最后5秒变黄色警告
  if (workoutState.timeLeft <= 5) {
    timerFg.className.baseVal = 'timer-fg warning';
    el.className = 'timer-text warning';
  }
  
  // 过半提示（仅运动阶段）
  if (!workoutState.isRest && workoutState.timeLeft === Math.floor(totalTime / 2) && totalTime >= 20) {
    playSound('workout-half');
    workoutSpeakHalfway();
  }
  
  // 最后10秒冲刺提示（仅运动阶段，长动作才触发）
  if (!workoutState.isRest && workoutState.timeLeft === 10 && totalTime >= 30) {
    playSound('workout-half');
  }
  
  // 随机鼓励（运动阶段，每15秒概率触发）
  if (!workoutState.isRest && workoutState.timeLeft > 5 && workoutState.timeLeft % 15 === 0 && Math.random() < 0.4) {
    playSound('hit');
  }
  
  // 最后5秒倒计时音效（合成滴声）
  if (workoutState.timeLeft <= 5 && workoutState.timeLeft > 0) {
    playSound('workout-countdown');
  }
  
  // 最后3秒播报"三二一开始"
  if (workoutState.timeLeft === 3) {
    playVoice('321');
  }
  
  if (workoutState.timeLeft <= 0) {
    clearInterval(workoutState.timerId);
    advanceWorkout();
  }
}

function advanceWorkout() {
  const ch = workoutState.challenge;
  const ex = ch.exercises[workoutState.exerciseIdx];
  
  if (workoutState.isRest) {
    // 休息结束，进入下一个动作
    playVoice('rest_end');
    playSynthBeep(3);
    workoutState.isRest = false;
    workoutState.exerciseIdx++;
    if (workoutState.exerciseIdx >= ch.exercises.length) {
      completeWorkout();
      return;
    }
  } else {
    // 动作结束
    const isLastExercise = workoutState.exerciseIdx >= ch.exercises.length - 1;
    if (isLastExercise) {
      // 最后一个动作完成，直接结束，不进入休息
      completeWorkout();
      return;
    }
    // 非最后一个动作，进入休息（如果有）
    if (ex.rest > 0) {
      workoutState.isRest = true;
    } else {
      // 无休息直接切换
      playSynthBeep(2);
      workoutState.exerciseIdx++;
      if (workoutState.exerciseIdx >= ch.exercises.length) {
        completeWorkout();
        return;
      }
    }
  }
  
  showWorkoutExercise();
}

function completeWorkout() {
  workoutState.active = false;
  clearInterval(workoutState.timerId);
  stopStepCarousel();
  $('workout-overlay').classList.add('hidden');
  $('workout-complete').classList.remove('hidden');
  focusMode = 'workout-complete';
  
  const ch = workoutState.challenge;
  const xp = WORKOUT_XP[ch.difficulty];
  const cal = Math.round(CAL_PER_MIN[ch.difficulty] * ch.duration);
  
  $('wc-name').textContent = ch.name;
  $('wc-duration').textContent = ch.duration;
  $('wc-calories').textContent = cal;
  $('wc-xp').textContent = xp;
  
  // 完成音效+语音
  playSound('workout-complete');
  workoutSpeakComplete(ch.name, cal, xp);
  
  // 发放奖励
  addXP(xp, '🏃 运动');
  gameState.totalWorkouts = (gameState.totalWorkouts || 0) + 1;
  gameState.todayWorkouts = (gameState.todayWorkouts || 0) + 1;
  
  // 活力buff
  gameState.activeBuffs.push({
    type: 'vitality',
    expires: Date.now() + 2 * 60 * 60 * 1000, // 2小时
    data: { xpBonus: 0.2 }
  });
  
  saveGameState();
  spawnParticles('💪', 15);
}

function toggleWorkoutPause() {
  workoutState.paused = !workoutState.paused;
  $('workout-pause-btn').textContent = workoutState.paused ? '▶ 继续' : '⏸ 暂停';
}

function skipWorkoutExercise() {
  clearInterval(workoutState.timerId);
  workoutState.isRest = false;
  workoutState.exerciseIdx++;
  const ch = workoutState.challenge;
  if (workoutState.exerciseIdx >= ch.exercises.length) {
    completeWorkout();
  } else {
    playSound('event');
    showWorkoutExercise();
  }
}

function abandonWorkout() {
  workoutState.active = false;
  clearInterval(workoutState.timerId);
  stopStepCarousel();
  $('workout-overlay').classList.add('hidden');
  focusMode = 'kanban';
  toast('运动已放弃');
}

function closeWorkoutComplete() {
  $('workout-complete').classList.add('hidden');
  focusMode = 'kanban';
}

function handleWorkoutNav(e) {
  switch(e.key) {
    case ' ':
    case 'Enter':
      e.preventDefault();
      playSound('select');
      toggleWorkoutPause();
      break;
    case 'ArrowRight':
      playSound('move');
      skipWorkoutExercise();
      break;
    case 'Escape':
      playSound('cancel');
      abandonWorkout();
      break;
  }
}

function handleWorkoutCompleteNav(e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    playSound('select');
    closeWorkoutComplete();
  }
}

// ═══════════════════ 冥想模块 ═══════════════════
const MEDITATE_SESSIONS = [
  { id: 'focus5', name: '专注呼吸', duration: 5 * 60, desc: '5分钟·静心归零', breath: { inhale: 4, hold: 4, exhale: 6 }, img: 'focus5.jpg', cover: 'focus5.jpg' },
  { id: 'calm10', name: '深度平静', duration: 10 * 60, desc: '10分钟·478呼吸', breath: { inhale: 4, hold: 7, exhale: 8 }, img: 'calm10.jpg', cover: 'calm10.jpg' },
  { id: 'zen15', name: '禅定入定', duration: 15 * 60, desc: '15分钟·腹式呼吸', breath: { inhale: 6, hold: 2, exhale: 8 }, img: 'zen15.jpg', cover: 'zen15.jpg' },
  { id: 'deep20', name: '深度冥想', duration: 20 * 60, desc: '20分钟·身体扫描', breath: { inhale: 5, hold: 5, exhale: 10 }, img: 'deep20.jpg', cover: 'deep20.jpg' },
];

let meditateState = null; // { session, remaining, paused, intervalId, breathPhase, breathTimer }

// 冥想选择导航实例
const meditateSelectNav = new ListNav({
  container: 'meditate-list',
  item: '.workout-item',
  focusedClass: 'focused',
  onSelect: (idx) => {
    if (MEDITATE_SESSIONS[idx]) startMeditate(MEDITATE_SESSIONS[idx]);
  },
  onEscape: () => {
    $('meditate-select').classList.add('hidden');
    focusMode = 'kanban';
  }
});

function openMeditateSelect() {
  focusMode = 'meditate-select';
  meditateSelectNav.reset();
  const list = $('meditate-list');
  list.innerHTML = MEDITATE_SESSIONS.map((s, i) => `
    <div class="workout-item" data-idx="${i}">
      ${s.cover ? `<img class="workout-item-cover" src="/img/meditate/${s.cover}" alt="${s.name}" onerror="this.src='/img/meditate/${s.img}'" />` : `<img class="workout-item-icon" src="/img/meditate/${s.img}" alt="${s.name}" onerror="this.style.display='none'">`}
      <div class="workout-item-info">
        <div class="workout-item-name">${s.name}</div>
        <div class="workout-item-meta"><span>${s.desc}</span></div>
      </div>
    </div>
  `).join('');
  $('meditate-select').classList.remove('hidden');
  // 绑定点击事件（Steam Deck 触屏支持）
  list.querySelectorAll('.workout-item').forEach(el => {
    el.onclick = () => {
      const idx = parseInt(el.dataset.idx);
      if (MEDITATE_SESSIONS[idx]) startMeditate(MEDITATE_SESSIONS[idx]);
    };
  });
  meditateSelectNav.updateFocus();
}

function handleMeditateSelectNav(e) {
  if (e.repeat) return;
  meditateSelectNav.handleKey(e);
}

function startMeditate(session) {
  $('meditate-select').classList.add('hidden');
  $('meditate-overlay').classList.remove('hidden');
  focusMode = 'meditate';
  
  meditateState = {
    session,
    remaining: session.duration,
    paused: false,
    intervalId: null,
    breathPhase: 'inhale', // inhale | hold | exhale
    breathTimer: 0,
    startedAt: Date.now(), // 启动时间，防止 Enter 冒泡
  };
  
  $('meditate-name').textContent = session.name;
  $('meditate-timer').textContent = formatSec(session.duration);
  $('meditate-pause-btn').textContent = '⏸ 暂停';
  
  // 全屏冥想背景图
  const mImg = $('meditate-full-img');
  const mBg = $('meditate-full-bg');
  const mPh = $('meditate-full-placeholder');
  const mCoverSrc = session.cover ? `/img/meditate/${session.cover}` : '';
  if (mCoverSrc) {
    mImg.src = mCoverSrc;
    mBg.src = mCoverSrc;
    mImg.style.display = '';
    mBg.style.display = '';
    mImg.onload = () => { mImg.style.display = ''; mBg.style.display = ''; mPh.style.display = 'none'; };
    mImg.onerror = () => { mImg.style.display = 'none'; mBg.style.display = 'none'; mPh.style.display = ''; };
    mPh.style.display = 'none';
  } else {
    mImg.style.display = 'none';
    mBg.style.display = 'none';
    mPh.style.display = '';
  }
  
  // 开始呼吸循环
  startBreathCycle();
  // 开始计时
  meditateState.intervalId = setInterval(meditateTick, 1000);
  
  // 颂钵开始音
  playSound('meditate-bowl');
}

function startBreathCycle() {
  if (!meditateState || meditateState.paused) return;
  const b = meditateState.session.breath;
  const circle = $('breath-circle');
  const text = $('breath-text');
  
  // 吸气
  meditateState.breathPhase = 'inhale';
  meditateState.breathTimer = b.inhale;
  circle.className = 'breath-circle inhale';
  text.textContent = '吸气';
  playSound('meditate-breathe');
  
  setTimeout(() => {
    if (!meditateState || meditateState.paused) return;
    // 屏息
    if (b.hold > 0) {
      meditateState.breathPhase = 'hold';
      meditateState.breathTimer = b.hold;
      circle.className = 'breath-circle inhale hold';
      text.textContent = '屏息';
      
      setTimeout(() => {
        if (!meditateState || meditateState.paused) return;
        // 呼气
        meditateState.breathPhase = 'exhale';
        meditateState.breathTimer = b.exhale;
        circle.className = 'breath-circle exhale';
        text.textContent = '呼气';
        playSound('meditate-breathe');
        
        setTimeout(() => {
          if (!meditateState || meditateState.paused) return;
          startBreathCycle(); // 循环
        }, b.exhale * 1000);
      }, b.hold * 1000);
    } else {
      // 无屏息，直接呼气
      meditateState.breathPhase = 'exhale';
      meditateState.breathTimer = b.exhale;
      circle.className = 'breath-circle exhale';
      text.textContent = '呼气';
      playSound('meditate-breathe');
      
      setTimeout(() => {
        if (!meditateState || meditateState.paused) return;
        startBreathCycle();
      }, b.exhale * 1000);
    }
  }, b.inhale * 1000);
}

function meditateTick() {
  if (!meditateState || meditateState.paused) return;
  meditateState.remaining--;
  
  $('meditate-timer').textContent = formatSec(meditateState.remaining);
  
  // 最后30秒每5秒柔和提示音
  if (meditateState.remaining <= 30 && meditateState.remaining % 5 === 0) {
    playSound('meditate-breathe');
  }
  
  if (meditateState.remaining <= 0) {
    completeMeditate();
  }
}

function toggleMeditatePause() {
  if (!meditateState) return;
  meditateState.paused = !meditateState.paused;
  $('meditate-pause-btn').textContent = meditateState.paused ? '▶ 继续' : '⏸ 暂停';
  
  if (!meditateState.paused) {
    // 恢复呼吸循环
    startBreathCycle();
  } else {
    // 暂停时重置呼吸圈
    $('breath-circle').className = 'breath-circle';
    $('breath-text').textContent = '暂停';
  }
  playSound('select');
}

function abandonMeditate() {
  if (!meditateState) return;
  clearInterval(meditateState.intervalId);
  meditateState = null;
  $('meditate-overlay').classList.add('hidden');
  $('breath-circle').className = 'breath-circle';
  focusMode = 'kanban';
  playSound('cancel');
}

function completeMeditate() {
  if (!meditateState) return;
  const session = meditateState.session;
  clearInterval(meditateState.intervalId);
  $('meditate-overlay').classList.add('hidden');
  $('breath-circle').className = 'breath-circle';
  meditateState = null;
  
  // 今日冥想计数+1
  gameState.todayMeditations = (gameState.todayMeditations || 0) + 1;
  
  // 显示完成界面
  $('mc-name').textContent = $('meditate-name').textContent;
  $('mc-duration').textContent = Math.round(session.duration / 60);
  
  // XP奖励：5min=50, 10min=100, 15min=160, 20min=220
  const xpTable = { 300: 50, 600: 100, 900: 160, 1200: 220 };
  const xp = xpTable[session.duration] || 50;
  $('mc-xp').textContent = xp;
  
  $('meditate-complete').classList.remove('hidden');
  focusMode = 'meditate-complete';
  
  // 加XP + 禅定buff
  addXP(xp, '🧘 冥想');
  // 禅定buff：30分钟内XP+30%
  if (!gameState.activeBuffs) gameState.activeBuffs = [];
  gameState.activeBuffs.push({ type: 'zen', expires: Date.now() + 30 * 60 * 1000, data: { xpBonus: 0.3 } });
  saveGameState();
  
  playSound('meditate-gong');
  checkAchievements();
}

function closeMeditateComplete() {
  $('meditate-complete').classList.add('hidden');
  focusMode = 'kanban';
}

function handleMeditateNav(e) {
  // 忽略按键重复（Steam Deck 按住会触发多次 keydown）
  if (e.repeat) return;
  
  switch(e.key) {
    case ' ':
    case 'Enter':
      e.preventDefault();
      // 启动后 2s 内忽略 Enter/Space（防止从选择界面冒泡/重复导致立刻暂停）
      if (meditateState && Date.now() - meditateState.startedAt < 2000) return;
      playSound('select');
      toggleMeditatePause();
      break;
    case 'Escape':
      e.preventDefault();
      playSound('cancel');
      abandonMeditate();
      break;
  }
}

function handleMeditateCompleteNav(e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    playSound('select');
    closeMeditateComplete();
  }
}
