const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

process.env.TZ = 'Asia/Ho_Chi_Minh';

// --- CẤU HÌNH ĐỘNG ---
let BOT_USERNAME = process.env.BOT_USERNAME || 'Kiru Đẹp Trai';
let BOT_PASSWORD = process.env.BOT_PASSWORD || 'YourPasswordHere';
let BOT_HOST = process.env.BOT_HOST || 'mc.example.com';
let BOT_PORT = parseInt(process.env.BOT_PORT) || 25565;

const HAS_ENV_PASSWORD = !!process.env.BOT_PASSWORD;

// ============ CẤU HÌNH TÍNH NĂNG ============
const CONFIG = {
  autoClickEnabled: false,
  leftClickDelay: 200,
  rightClickDelay: 300,
  enableLeft: true,
  enableRight: true,

  autoResetEnabled: true,
  autoResetInterval: 60000,
  autoResetPauseTime: 5000,

  autoWalkEnabled: false,
  autoWalkContinuous: true,
  autoWalkDuration: 3000,
  autoWalkInterval: 8000,
  autoWalkJumpInterval: 1500,
  autoWalkTurnEnabled: false,
  autoWalkSprintEnabled: false,
  autoWalkSprintOnJump: true,

  hotbarSelected: 1,
};

let bot = null;
let reconnectTimeout = null;
let isReconnecting = false;
let isManualStopped = false;
let isFirstSpawn = true;

let currentReconnectDelay = 12000;
let consecutiveFailures = 0;

let actionTimeout = null;
let antiAfkTimeout = null;
let ramGcInterval = null;
let posCheckInterval = null;
let watchdogInterval = null;
let pingInterval = null;
let loginTimer1 = null;
let loginTimer2 = null;
let respawnTimer = null;
let commandResponseTimer = null;

let leftInterval = null;
let rightInterval = null;
let autoResetTimer = null;
let autoResetPauseTimer = null;

let autoWalkForwardTimer = null;
let autoWalkStopTimer = null;
let autoWalkJumpTimer = null;
let autoWalkTurnTimer = null;

let isAwaitingResponse = false;
let isAutoActionRunning = false;
let lastActionTime = Date.now();
let currentCoords = 'Đang xác định...';
let currentPing = 0;

const startTime = Date.now();
const serverChatLogs = [];
const errorLogs = [];
const pingLogs = [];
const botMentionLogs = [];
const guiLogs = [];
let currentWindow = null;

let lastTimeAge = 0;
let lastTimeAgeUpdate = Date.now();

function getVNTime() {
  return new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

function addChatLog(msg) {
  serverChatLogs.unshift(`[${getVNTime()}] ${msg}`);
  if (serverChatLogs.length > 25) serverChatLogs.pop();
}

function addErrorLog(type, details) {
  errorLogs.unshift({ time: getVNTime(), type, details });
  if (errorLogs.length > 50) errorLogs.pop();
}

function addPingLog(pingVal) {
  pingLogs.unshift({ time: getVNTime(), ping: pingVal });
  if (pingLogs.length > 15) pingLogs.pop();
}

function addBotMentionLog(msg) {
  botMentionLogs.unshift({ time: getVNTime(), text: msg });
}

function addGuiLog(msg) {
  guiLogs.unshift(`[${getVNTime()}] ${msg}`);
  if (guiLogs.length > 40) guiLogs.pop();
}

function triggerChatWindow(durationMs = 8000) {
  isAwaitingResponse = true;
  if (commandResponseTimer) clearTimeout(commandResponseTimer);
  commandResponseTimer = setTimeout(() => { isAwaitingResponse = false; }, durationMs);
}

// ============ ĐỌC TÊN VẬT PHẨM ============
function extractText(component) {
  if (!component) return '';
  if (typeof component === 'string') {
    try { return extractText(JSON.parse(component)); } catch (e) { return component; }
  }
  if (typeof component === 'number' || typeof component === 'boolean') return String(component);
  if (typeof component === 'object') {
    if (component.type && component.value !== undefined) return extractText(component.value);
    let result = '';
    if (component.text) result += extractText(component.text);
    if (component.translate) result += component.translate;
    if (component.extra && Array.isArray(component.extra)) {
      for (const c of component.extra) result += extractText(c);
    }
    if (!result && component.value) result = extractText(component.value);
    return result.trim();
  }
  return '';
}

function getItemName(item) {
  if (!item) return '';
  if (item.customName) { const n = extractText(item.customName); if (n) return n; }
  if (item.nbt && item.nbt.display && item.nbt.display.Name) {
    const n = extractText(item.nbt.display.Name); if (n) return n;
  }
  if (item.displayName) { const n = extractText(item.displayName); if (n) return n; }
  if (item.name) return item.name;
  return 'không rõ';
}

// ============ ĐỌC GUI (BỎ QUA INVENTORY) ============
function isBotInventory(window) {
  if (!window) return true;
  const winType = (window.type || '').toLowerCase();
  const winTitle = (extractText(window.title) || window.title || '').toLowerCase();

  if (window.id === 0) return true;
  if (winType === 'minecraft:inventory' || winType === 'inventory') return true;
  if (winTitle.includes('túi đồ') || winTitle.includes('inventory')) return true;
  if (winTitle.includes('crafting')) return true;

  return false;
}

function readWindow(window) {
  if (isBotInventory(window)) {
    addGuiLog('[GUI] ⏭️ Bỏ qua inventory của bot');
    return;
  }

  const winTitle = extractText(window.title) || window.title || '';
  const winType = window.type || '';

  addGuiLog('─────────── GUI SERVER ───────────');
  addGuiLog(`Tiêu đề: ${winTitle}`);
  addGuiLog(`Loại: ${winType}`);
  addGuiLog(`Số ô: ${window.slots.length}`);
  for (let i = 0; i < window.slots.length; i++) {
    const item = window.slots[i];
    if (item) addGuiLog(`[Ô ${i}] ${getItemName(item)} x${item.count || 1}`);
  }
  addGuiLog('───────────────────────────');
}

// ============ AUTO CLICK ============
function startAutoClick() {
  stopAutoClick();
  if (!bot || !bot.entity) { addErrorLog('AUTO CLICK', 'Bot chưa vào server!'); return; }

  if (CONFIG.enableLeft) {
    leftInterval = setInterval(() => {
      if (bot && bot.entity) { try { bot.swingArm('right'); } catch (e) {} }
    }, CONFIG.leftClickDelay);
    addGuiLog(`[AUTO CLICK] Trái mỗi ${CONFIG.leftClickDelay}ms`);
  }

  if (CONFIG.enableRight) {
    rightInterval = setInterval(() => {
      if (bot && bot.entity) { try { bot.activateItem(); } catch (e) {} }
    }, CONFIG.rightClickDelay);
    addGuiLog(`[AUTO CLICK] Phải mỗi ${CONFIG.rightClickDelay}ms`);
  }

  CONFIG.autoClickEnabled = true;
  addGuiLog('[AUTO CLICK] BẬT');
  startAutoReset();
}

function stopAutoClick() {
  if (leftInterval) { clearInterval(leftInterval); leftInterval = null; }
  if (rightInterval) { clearInterval(rightInterval); rightInterval = null; }
  CONFIG.autoClickEnabled = false;
  addGuiLog('[AUTO CLICK] TẮT');
  stopAutoReset();
}

// ============ AUTO RESET ============
function startAutoReset() {
  stopAutoReset();
  if (!CONFIG.autoResetEnabled) return;

  autoResetTimer = setTimeout(() => {
    addGuiLog(`[AUTO RESET] Tạm dừng ${CONFIG.autoResetPauseTime}ms...`);
    const wasEnabled = CONFIG.autoClickEnabled;

    if (leftInterval) { clearInterval(leftInterval); leftInterval = null; }
    if (rightInterval) { clearInterval(rightInterval); rightInterval = null; }
    CONFIG.autoClickEnabled = false;
    addGuiLog('[AUTO CLICK] TẮT (đang reset)');

    autoResetPauseTimer = setTimeout(() => {
      if (wasEnabled && !isManualStopped) {
        addGuiLog('[AUTO RESET] Bật lại auto click...');
        startAutoClick();
      } else {
        startAutoReset();
      }
    }, CONFIG.autoResetPauseTime);
  }, CONFIG.autoResetInterval);
}

function stopAutoReset() {
  if (autoResetTimer) { clearTimeout(autoResetTimer); autoResetTimer = null; }
  if (autoResetPauseTimer) { clearTimeout(autoResetPauseTimer); autoResetPauseTimer = null; }
}

// ============ AUTO WALK ============
function startAutoWalk() {
  stopAutoWalk();
  if (!bot || !bot.entity) { addErrorLog('AUTO WALK', 'Bot chưa vào server!'); return; }

  CONFIG.autoWalkEnabled = true;

  const enableMovement = () => {
    if (!bot || !bot.entity) return;
    try { bot.setControlState('forward', true); } catch (e) {}
    if (CONFIG.autoWalkSprintEnabled) {
      try { bot.setControlState('sprint', true); } catch (e) {}
    }
  };

  const disableMovement = () => {
    if (!bot || !bot.entity) return;
    try {
      bot.setControlState('forward', false);
      bot.setControlState('sprint', false);
    } catch (e) {}
  };

  if (CONFIG.autoWalkContinuous) {
    addGuiLog(`[AUTO WALK] BẮT ĐẦU - LIÊN TỤC${CONFIG.autoWalkSprintEnabled ? ' + SPRINT ⚡' : ''}`);
    enableMovement();
  } else {
    addGuiLog(`[AUTO WALK] BẮT ĐẦU - CHU KỲ${CONFIG.autoWalkSprintEnabled ? ' + SPRINT ⚡' : ''} (đi ${CONFIG.autoWalkDuration}ms / nghỉ ${CONFIG.autoWalkInterval}ms)`);

    const cycleLoop = () => {
      if (!CONFIG.autoWalkEnabled || CONFIG.autoWalkContinuous || isManualStopped || !bot || !bot.entity) return;
      enableMovement();

      autoWalkStopTimer = setTimeout(() => {
        disableMovement();
        if (!CONFIG.autoWalkEnabled || CONFIG.autoWalkContinuous || isManualStopped) return;
        autoWalkForwardTimer = setTimeout(cycleLoop, CONFIG.autoWalkInterval);
      }, CONFIG.autoWalkDuration);
    };
    cycleLoop();
  }

  const jumpLoop = () => {
    if (!CONFIG.autoWalkEnabled || isManualStopped || !bot || !bot.entity) return;
    try {
      if (CONFIG.autoWalkSprintOnJump && !CONFIG.autoWalkSprintEnabled) {
        try { bot.setControlState('sprint', true); } catch (e) {}
      }

      bot.setControlState('jump', true);
      setTimeout(() => {
        if (bot && bot.entity && CONFIG.autoWalkEnabled) {
          try { bot.setControlState('jump', false); } catch (e) {}

          if (CONFIG.autoWalkSprintOnJump && !CONFIG.autoWalkSprintEnabled) {
            setTimeout(() => {
              if (bot && bot.entity && CONFIG.autoWalkEnabled) {
                try { bot.setControlState('sprint', false); } catch (e) {}
              }
            }, 800);
          }
        }
      }, 250);
    } catch (e) {}
    autoWalkJumpTimer = setTimeout(jumpLoop, CONFIG.autoWalkJumpInterval);
  };
  jumpLoop();

  if (CONFIG.autoWalkTurnEnabled) {
    const turnLoop = () => {
      if (!CONFIG.autoWalkEnabled || isManualStopped || !bot || !bot.entity) return;
      try {
        const deltaYaw = (Math.random() - 0.5) * 0.4;
        bot.look(bot.entity.yaw + deltaYaw, bot.entity.pitch, true);
      } catch (e) {}
      autoWalkTurnTimer = setTimeout(turnLoop, 4000 + Math.random() * 4000);
    };
    turnLoop();
  }
}

function stopAutoWalk() {
  if (autoWalkForwardTimer) { clearTimeout(autoWalkForwardTimer); autoWalkForwardTimer = null; }
  if (autoWalkStopTimer) { clearTimeout(autoWalkStopTimer); autoWalkStopTimer = null; }
  if (autoWalkJumpTimer) { clearTimeout(autoWalkJumpTimer); autoWalkJumpTimer = null; }
  if (autoWalkTurnTimer) { clearTimeout(autoWalkTurnTimer); autoWalkTurnTimer = null; }

  if (bot && bot.entity) {
    try {
      bot.setControlState('forward', false);
      bot.setControlState('jump', false);
      bot.setControlState('sprint', false);
    } catch (e) {}
  }
  CONFIG.autoWalkEnabled = false;
  addGuiLog('[AUTO WALK] DỪNG');
}

// ============ HTTP ENDPOINTS ============
app.get('/api/ping', (req, res) => res.send('PONG_OK'));

app.post('/api/update-config', (req, res) => {
  const { username, password, host } = req.body;

  if (username !== undefined && username.trim() !== '') {
    BOT_USERNAME = username.trim();
  }

  // Chỉ đổi mật khẩu khi user nhập mới (không để trống)
  if (password !== undefined && password.trim() !== '') {
    BOT_PASSWORD = password.trim();
    addErrorLog('CẤU HÌNH', '🔒 Đã cập nhật mật khẩu mới');
  }

  if (host !== undefined && host.trim() !== '') {
    let cleanHost = host.trim();
    if (cleanHost.includes(':')) {
      const parts = cleanHost.split(':');
      BOT_HOST = parts[0];
      BOT_PORT = parseInt(parts[1]) || 25565;
    } else {
      BOT_HOST = cleanHost;
      BOT_PORT = 25565;
    }
  }

  addErrorLog('CẤU HÌNH', `Đã cập nhật cấu hình Bot [${BOT_USERNAME}]. Đang kết nối lại...`);
  consecutiveFailures = 0;
  isManualStopped = false;
  createBot();
  res.redirect('/');
});

app.post('/api/command', (req, res) => {
  if (isManualStopped) return res.send('Bot đang ở trạng thái TẮT thủ công!');
  const cmd = req.body.command;
  if (!bot || !bot._client) return res.send('Bot đang ngoại tuyến!');
  if (cmd) {
    bot.chat(cmd);
    addChatLog(`[WEB-ADMIN]: ${cmd}`);
    triggerChatWindow(8000);
  }
  res.redirect('/');
});

app.get('/api/toggle-bot', (req, res) => {
  isManualStopped = !isManualStopped;
  if (isManualStopped) {
    addErrorLog('THỦ CÔNG', 'Đã TẮT Bot từ Dashboard.');
    cleanupBot();
  } else {
    addErrorLog('THỦ CÔNG', 'Đã BẬT lại Bot. Đang kết nối lại Server...');
    consecutiveFailures = 0;
    createBot();
  }
  res.redirect('/');
});

app.get('/api/clear-error-log', (req, res) => { errorLogs.length = 0; res.redirect('/'); });
app.get('/api/clear-mention-log', (req, res) => { botMentionLogs.length = 0; res.redirect('/'); });
app.get('/api/clear-gui-log', (req, res) => { guiLogs.length = 0; res.redirect('/'); });

app.get('/api/hard-restart', (req, res) => {
  addErrorLog('HỆ THỐNG', 'Khởi động lại tiến trình Node.js...');
  process.exit(1);
});

// === Hotbar ===
app.get('/api/hotbar/:slot', (req, res) => {
  const slot = parseInt(req.params.slot);
  if (isNaN(slot) || slot < 1 || slot > 9) {
    addGuiLog('[HOTBAR] Số không hợp lệ (1-9)');
    return res.redirect('/');
  }
  if (!bot || !bot.entity) {
    addGuiLog('[HOTBAR] Bot chưa vào server!');
    return res.redirect('/');
  }

  const quickBarIndex = slot - 1;

  try {
    bot.setQuickBarSlot(quickBarIndex);
    CONFIG.hotbarSelected = slot;

    const item = bot.inventory.slots[36 + quickBarIndex];
    const itemName = item ? getItemName(item) : '(ô trống)';

    addGuiLog(`[HOTBAR] ✅ Chọn ô ${slot} → "${itemName}"`);
    addChatLog(`[HOTBAR] Cầm ô ${slot}: ${itemName}`);
  } catch (e) {
    addGuiLog(`[HOTBAR] ❌ Lỗi: ${e.message}`);
  }
  res.redirect('/');
});

// === Auto Click endpoints ===
app.get('/api/toggle-autoclick', (req, res) => {
  if (CONFIG.autoClickEnabled) stopAutoClick(); else startAutoClick();
  res.redirect('/');
});

app.post('/api/set-autoclick', (req, res) => {
  const { leftDelay, rightDelay, enableLeft, enableRight } = req.body;
  if (leftDelay) CONFIG.leftClickDelay = parseInt(leftDelay) || CONFIG.leftClickDelay;
  if (rightDelay) CONFIG.rightClickDelay = parseInt(rightDelay) || CONFIG.rightClickDelay;
  CONFIG.enableLeft = enableLeft === 'on';
  CONFIG.enableRight = enableRight === 'on';
  addGuiLog(`[CFG] Trái=${CONFIG.enableLeft}(${CONFIG.leftClickDelay}ms), Phải=${CONFIG.enableRight}(${CONFIG.rightClickDelay}ms)`);
  if (CONFIG.autoClickEnabled) startAutoClick();
  res.redirect('/');
});

// === Auto Reset endpoints ===
app.get('/api/toggle-autoreset', (req, res) => {
  CONFIG.autoResetEnabled = !CONFIG.autoResetEnabled;
  if (CONFIG.autoResetEnabled && CONFIG.autoClickEnabled) startAutoReset();
  else stopAutoReset();
  res.redirect('/');
});

app.post('/api/set-autoreset', (req, res) => {
  const { interval, pause } = req.body;
  if (interval) CONFIG.autoResetInterval = parseInt(interval) || CONFIG.autoResetInterval;
  if (pause) CONFIG.autoResetPauseTime = parseInt(pause) || CONFIG.autoResetPauseTime;
  addGuiLog(`[CFG] Auto Reset: chu kỳ ${CONFIG.autoResetInterval}ms, pause ${CONFIG.autoResetPauseTime}ms`);
  if (CONFIG.autoClickEnabled) startAutoReset();
  res.redirect('/');
});

// === Auto Walk endpoints ===
app.get('/api/toggle-autowalk', (req, res) => {
  if (CONFIG.autoWalkEnabled) stopAutoWalk(); else startAutoWalk();
  res.redirect('/');
});

app.post('/api/set-autowalk', (req, res) => {
  const { duration, interval, jumpInterval, continuous, turnEnabled, sprintEnabled, sprintOnJump } = req.body;

  if (duration) CONFIG.autoWalkDuration = parseInt(duration) || CONFIG.autoWalkDuration;
  if (interval) CONFIG.autoWalkInterval = parseInt(interval) || CONFIG.autoWalkInterval;
  if (jumpInterval) CONFIG.autoWalkJumpInterval = parseInt(jumpInterval) || CONFIG.autoWalkJumpInterval;

  CONFIG.autoWalkContinuous = continuous === 'on';
  CONFIG.autoWalkTurnEnabled = turnEnabled === 'on';
  CONFIG.autoWalkSprintEnabled = sprintEnabled === 'on';
  CONFIG.autoWalkSprintOnJump = sprintOnJump === 'on';

  addGuiLog(`[CFG] Auto Walk: continuous=${CONFIG.autoWalkContinuous}, sprint=${CONFIG.autoWalkSprintEnabled}, sprintOnJump=${CONFIG.autoWalkSprintOnJump}, turn=${CONFIG.autoWalkTurnEnabled}`);

  if (CONFIG.autoWalkEnabled) startAutoWalk();
  res.redirect('/');
});

// === GUI endpoints ===
app.post('/api/click-slot', (req, res) => {
  const { slot, mode, search } = req.body;
  if (!currentWindow) { addGuiLog('[LỖI] Không có GUI đang mở'); return res.redirect('/'); }

  const title = extractText(currentWindow.title) || currentWindow.title || '';
  addGuiLog(`[CHECK] GUI: "${title}" | ${currentWindow.slots.length} ô`);

  let targetSlot = -1;
  if (mode === 'name' && search) {
    const s = search.toLowerCase();
    for (let i = 0; i < currentWindow.slots.length; i++) {
      const item = currentWindow.slots[i];
      if (item) {
        const name = getItemName(item);
        if (name.toLowerCase().includes(s)) { targetSlot = i; break; }
      }
    }
    if (targetSlot === -1) {
      addGuiLog(`[LỖI] Không tìm thấy vật phẩm "${search}"`);
      return res.redirect('/');
    }
  } else {
    const n = parseInt(slot);
    if (!isNaN(n) && n >= 0 && n < currentWindow.slots.length) targetSlot = n;
  }

  if (targetSlot !== -1) {
    const item = currentWindow.slots[targetSlot];
    const itemName = item ? getItemName(item) : '(ô trống)';

    if (itemName.toLowerCase().includes('stained glass') ||
        itemName.toLowerCase().includes('barrier')) {
      addGuiLog(`[CẢNH BÁO] Ô ${targetSlot} là "${itemName}" — có thể server CHẶN click!`);
    }

    try {
      bot.clickWindow(targetSlot, 0, 0);
      addGuiLog(`[GUI] ✅ Click ô ${targetSlot} ("${itemName}")`);
    } catch (e) {
      addGuiLog(`[LỖI] Click thất bại: ${e.message}`);
    }
  } else {
    addGuiLog('[LỖI] Số ô không hợp lệ');
  }
  res.redirect('/');
});

app.get('/api/close-gui', (req, res) => {
  if (currentWindow) {
    try { currentWindow.close(); addGuiLog('[GUI] Đã đóng'); } catch (e) {}
    currentWindow = null;
  }
  res.redirect('/');
});

// ============ DASHBOARD ============
app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const currentWeapon = (bot && bot.heldItem) ? bot.heldItem.displayName : 'Tay không';

  let statusBadge = '<span class="badge-off">OFFLINE</span>';
  if (isManualStopped) {
    statusBadge = '<span class="badge-pause">ĐÃ TẮT THỦ CÔNG (NHƯỜNG NICK)</span>';
  } else if (bot && bot._client && bot._client.state === 'play') {
    statusBadge = '<span class="badge-on">ONLINE</span>';
  } else {
    statusBadge = `<span class="badge-off">RECONNECTING (${Math.round(currentReconnectDelay / 1000)}s)</span>`;
  }

  const acInd = CONFIG.autoClickEnabled ? '<span class="indicator ind-on">BẬT</span>' : '<span class="indicator ind-off">TẮT</span>';
  const arInd = CONFIG.autoResetEnabled ? '<span class="indicator ind-on">BẬT</span>' : '<span class="indicator ind-off">TẮT</span>';
  const awInd = CONFIG.autoWalkEnabled ? '<span class="indicator ind-on">BẬT</span>' : '<span class="indicator ind-off">TẮT</span>';

  const awMode = CONFIG.autoWalkContinuous
    ? '<span style="color:#fbbf24">🔥 LIÊN TỤC</span>'
    : '<span style="color:#38bdf8">🔄 CHU KỲ</span>';

  const hotbarButtons = [1,2,3,4,5,6,7,8,9].map(n => {
    const qbIndex = n - 1;
    const item = (bot && bot.inventory) ? bot.inventory.slots[36 + qbIndex] : null;
    const itemName = item ? getItemName(item).substring(0, 12) : '—';
    const isActive = CONFIG.hotbarSelected === n;
    return `
      <a href="/api/hotbar/${n}" style="text-decoration:none">
        <button type="button" style="
          width:100%;padding:12px 6px;
          background:${isActive ? 'linear-gradient(135deg,#16a34a,#15803d)' : 'linear-gradient(135deg,#475569,#334155)'};
          border:2px solid ${isActive ? '#4ade80' : 'rgba(255,255,255,0.15)'};
          box-shadow:${isActive ? '0 0 15px rgba(74,222,128,0.5)' : 'none'};
          font-size:1.1rem;font-weight:800;min-height:60px;
          display:flex;flex-direction:column;align-items:center;justify-content:center;
          gap:2px;color:#fff;
        ">
          <span style="font-size:1.2rem">${n}</span>
          <span style="font-size:0.6rem;opacity:0.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%">${itemName}</span>
        </button>
      </a>
    `;
  }).join('');

  const currentHotbarItem = (() => {
    const idx = CONFIG.hotbarSelected - 1;
    const item = (bot && bot.inventory) ? bot.inventory.slots[36 + idx] : null;
    return item ? getItemName(item) : '(trống)';
  })();

  // === FORM MẬT KHẨU — Bảo mật ===
  const passwordFormHtml = HAS_ENV_PASSWORD
    ? `<div style="font-size:.8rem;color:#4ade80;padding:12px;background:rgba(74,222,128,0.1);border-radius:10px;border:1px solid rgba(74,222,128,0.3);line-height:1.6">
         🔒 <b>Mật khẩu đang được nạp từ biến môi trường (ENV)</b><br>
         Không thể xem hoặc sửa từ web. Muốn đổi → sửa ENV <code>BOT_PASSWORD</code> trên Render.
       </div>`
    : `<div>
         <label>Mật Khẩu:</label>
         <div id="pwd-container"></div>
       </div>`;

  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Kiru Đẹp Trai</title>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--card-bg:rgba(10,14,26,0.85);--accent-cyan:#38bdf8;--accent-pink:#f43f5e;--accent-purple:#c084fc;--accent-green:#4ade80;--accent-yellow:#fbbf24;--border:rgba(244,63,94,0.25)}
*{box-sizing:border-box}
body{font-family:'Plus Jakarta Sans',sans-serif;margin:0;padding:16px;color:#f8fafc;min-height:100vh;background-color:#05070f;background-position:center center;background-repeat:no-repeat;background-attachment:fixed;background-size:cover;transition:background-image .8s ease-in-out;position:relative}
body::before{content:'';position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(4,6,14,0.70);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:-1}
.header{display:flex;align-items:center;justify-content:space-between;padding-bottom:15px;border-bottom:2px solid var(--border);margin-bottom:20px;gap:12px;flex-wrap:wrap}
h1{font-family:'Orbitron',sans-serif;font-size:1.8rem;margin:0;background:linear-gradient(90deg,#38bdf8,#f43f5e,#c084fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;text-shadow:0 0 20px rgba(244,63,94,0.4)}
.container{display:grid;grid-template-columns:2fr 1fr;gap:20px}
.card{background:var(--card-bg);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);padding:18px;border-radius:18px;border:1px solid var(--border);box-shadow:0 8px 32px 0 rgba(0,0,0,0.5);margin-bottom:20px}
h3{margin-top:0;color:var(--accent-cyan);font-size:1.1rem;display:flex;align-items:center;gap:8px}
.badge-on{background:rgba(74,222,128,0.2);color:#4ade80;border:1px solid #22c55e;padding:6px 14px;border-radius:20px;font-weight:bold;font-size:.85rem}
.badge-off{background:rgba(244,63,94,0.2);color:#f43f5e;border:1px solid #f43f5e;padding:6px 14px;border-radius:20px;font-weight:bold;font-size:.85rem}
.badge-pause{background:rgba(251,191,36,0.2);color:#fbbf24;border:1px solid #f59e0b;padding:6px 14px;border-radius:20px;font-weight:bold;font-size:.85rem}
.status-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:15px 0}
.status-item{background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.08);padding:10px 12px;border-radius:12px;display:flex;flex-direction:column;gap:4px}
.status-item .label{font-size:.7rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;font-weight:700}
.status-item .value{font-size:.9rem;font-weight:600;color:#f8fafc;word-break:break-all}
.chat-box{background:rgba(0,0,0,0.6);padding:12px;border-radius:12px;font-family:monospace;height:220px;overflow-y:auto;color:#38bdf8;border:1px solid rgba(56,189,248,0.2);font-size:.85rem}
.error-box{background:rgba(20,5,5,0.7);padding:12px;border-radius:12px;font-family:monospace;height:220px;overflow-y:auto;color:#f87171;border:1px solid rgba(244,63,94,0.3);font-size:.85rem}
.kiru-box{background:rgba(15,23,15,0.7);padding:12px;border-radius:12px;font-family:monospace;height:200px;overflow-y:auto;color:#facc15;border:1px solid rgba(250,204,21,0.3);font-size:.85rem}
.gui-box{background:rgba(10,20,30,0.8);padding:12px;border-radius:12px;font-family:monospace;height:260px;overflow-y:auto;color:#a5b4fc;border:1px solid rgba(165,180,252,0.3);font-size:.85rem}
.input-group{display:flex;gap:10px;margin-top:10px}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
input[type="text"],input[type="password"],input[type="number"]{width:100%;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.5);color:#fff;outline:none;font-size:.9rem}
input:focus{border-color:var(--accent-pink);box-shadow:0 0 10px rgba(244,63,94,0.4)}
input[type="checkbox"]{width:auto;transform:scale(1.2);accent-color:#38bdf8;cursor:pointer}
input:disabled{opacity:0.4;cursor:not-allowed}
button{padding:10px 18px;background:linear-gradient(135deg,#e11d48,#be123c);color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:bold;transition:all .25s ease;white-space:nowrap;font-size:.9rem}
button:hover{transform:translateY(-2px);box-shadow:0 4px 15px rgba(225,29,72,0.5)}
.btn-stop{background:linear-gradient(135deg,#dc2626,#991b1b)!important}
.btn-start{background:linear-gradient(135deg,#16a34a,#15803d)!important}
.btn-warning{background:linear-gradient(135deg,#d97706,#b45309)!important}
.btn-save{background:linear-gradient(135deg,#0284c7,#0369a1)!important;width:100%;margin-top:10px}
.btn-purple{background:linear-gradient(135deg,#7c3aed,#6d28d9)!important}
label{font-size:.8rem;color:#94a3b8;display:block;margin-bottom:4px}
.btn-group-responsive{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:15px}
.feature-row{display:flex;align-items:center;justify-content:space-between;padding:10px;background:rgba(0,0,0,0.4);border-radius:10px;margin-bottom:10px;border:1px solid rgba(255,255,255,0.08)}
.feature-row .name{font-weight:700;color:#f8fafc}
.indicator{padding:4px 10px;border-radius:20px;font-size:.75rem;font-weight:bold}
.ind-on{background:rgba(74,222,128,0.2);color:#4ade80;border:1px solid #22c55e}
.ind-off{background:rgba(244,63,94,0.2);color:#f43f5e;border:1px solid #f43f5e}
.mini-form{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end;margin-bottom:10px}
.mini-form label{margin-bottom:2px}
.mini-form button{padding:10px 14px}
.continuous-box{display:flex;gap:20px;font-size:.9rem;margin-bottom:12px;padding:10px;background:rgba(0,0,0,0.3);border-radius:10px;flex-wrap:wrap}
.continuous-box label{display:flex;align-items:center;gap:8px;color:#f8fafc;cursor:pointer;margin-bottom:0}
.hotbar-grid{display:grid;grid-template-columns:repeat(9,1fr);gap:6px;margin:12px 0}
.pwd-guard{user-select:none;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none}
@media(max-width:1024px){.container{grid-template-columns:1fr}}
@media(max-width:600px){body{padding:10px}.header{flex-direction:column;align-items:flex-start}h1{font-size:1.5rem}.form-grid{grid-template-columns:1fr}.input-group{flex-direction:column}.input-group button{width:100%}.btn-group-responsive{grid-template-columns:1fr}.card{padding:14px}.mini-form{grid-template-columns:1fr}.continuous-box{flex-direction:column;gap:8px}.hotbar-grid{grid-template-columns:repeat(5,1fr)}}
</style>
<script>
setInterval(()=>{const a=document.activeElement;if(!a||a.tagName!=='INPUT'){location.reload();}},6000);
async function rotateAnimeBg(){try{const r=await fetch('https://api.waifu.pics/sfw/waifu');const d=await r.json();if(d&&d.url){const i=new Image();i.src=d.url;i.onload=()=>{document.body.style.backgroundImage='url("'+d.url+'")';};}}catch(e){}}

// Render ô mật khẩu bằng JS — ẩn hoàn toàn khỏi View Source
function renderPasswordInput(){
  const container = document.getElementById('pwd-container');
  if (!container) return;
  const pwdInput = document.createElement('input');
  pwdInput.type = 'password';
  pwdInput.id = 'pwd-input';
  pwdInput.name = 'password';
  pwdInput.value = '';
  pwdInput.placeholder = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (đã lưu - nhập mới để đổi)';
  pwdInput.setAttribute('autocomplete', 'new-password');
  pwdInput.className = 'pwd-guard';
  pwdInput.style.paddingRight = '15px';
  pwdInput.style.userSelect = 'none';
  pwdInput.style.webkitUserSelect = 'none';
  pwdInput.style.mozUserSelect = 'none';
  pwdInput.style.msUserSelect = 'none';

  ['copy','cut','paste','contextmenu','dragstart','selectstart','drop']
    .forEach(evt => pwdInput.addEventListener(evt, e => e.preventDefault()));

  container.appendChild(pwdInput);
}

window.addEventListener('DOMContentLoaded',()=>{
  rotateAnimeBg();
  setInterval(rotateAnimeBg,60000);
  renderPasswordInput();
});
</script>
</head>
<body>
<div class="header">
<h1>KIRU ĐẸP TRAI</h1>
<div>${statusBadge}</div>
</div>

<div class="container">
<div>
  <div class="card">
    <h3>Trạng Thái Bot: <span style="color:var(--accent-pink)">${BOT_USERNAME}</span></h3>
    <div class="status-grid">
      <div class="status-item"><span class="label">Server</span><span class="value"><code>${BOT_HOST}:${BOT_PORT}</code></span></div>
      <div class="status-item"><span class="label">Ping</span><span class="value" style="color:var(--accent-cyan)">${currentPing} ms</span></div>
      <div class="status-item"><span class="label">Tọa Độ</span><span class="value"><code>${currentCoords}</code></span></div>
      <div class="status-item"><span class="label">Trang Bị</span><span class="value"><code>${currentWeapon}</code></span></div>
      <div class="status-item"><span class="label">Hoạt Động</span><span class="value">${uptimeMinutes} phút</span></div>
      <div class="status-item"><span class="label">RAM</span><span class="value">${memoryUsage} MB</span></div>
    </div>

    <form class="input-group" action="/api/command" method="POST">
      <input type="text" id="cmd-input" name="command" placeholder="Gửi lệnh hoặc chat vào server..." autocomplete="off" required>
      <button type="submit">Gửi</button>
    </form>

    <div class="btn-group-responsive">
      ${isManualStopped
        ? '<a href="/api/toggle-bot" style="text-decoration:none"><button type="button" class="btn-start" style="width:100%">BẬT BOT</button></a>'
        : '<a href="/api/toggle-bot" style="text-decoration:none"><button type="button" class="btn-stop" style="width:100%">TẮT BOT</button></a>'}
      <a href="/api/clear-error-log" style="text-decoration:none"><button type="button" class="btn-warning" style="width:100%">Xóa Lỗi</button></a>
      <a href="/api/clear-mention-log" style="text-decoration:none"><button type="button" class="btn-warning" style="width:100%">Mention (${botMentionLogs.length})</button></a>
      <a href="/api/hard-restart" style="text-decoration:none" onclick="return confirm('Reset toàn bộ Tiến Trình Code?');"><button type="button" class="btn-stop" style="width:100%">Reset App</button></a>
    </div>
  </div>

  <!-- ============ HOTBAR ============ -->
  <div class="card">
    <h3>🎒 Hotbar (Chọn ô 1-9)</h3>
    <div class="hotbar-grid">
      ${hotbarButtons}
    </div>
    <div style="font-size:.8rem;color:#94a3b8;text-align:center;margin-top:8px">
      Đang cầm: <b style="color:#4ade80">Ô ${CONFIG.hotbarSelected}</b> — ${currentHotbarItem}
    </div>
  </div>

  <form action="/api/update-config" method="POST" autocomplete="off">
    <div class="card">
      <h3>Đăng Nhập</h3>
      <div class="form-grid">
        <div>
          <label>Tên Nhân Vật:</label>
          <input type="text" name="username" value="${BOT_USERNAME}" required autocomplete="off">
        </div>
        ${passwordFormHtml}
      </div>
      ${HAS_ENV_PASSWORD ? '' : `
        <div style="font-size:.75rem;color:#94a3b8;margin-top:8px;line-height:1.5">
          🔒 Mật khẩu hiện tại đã được lưu an toàn.
          <b style="color:#fbbf24">Để trống</b> nếu không muốn đổi.
          Nhập mật khẩu mới nếu muốn cập nhật.
        </div>
      `}
    </div>
    <div class="card">
      <h3>IP Server</h3>
      <div><label>IP Server:</label><input type="text" name="host" value="${BOT_HOST}${BOT_PORT && BOT_PORT !== 25565 ? ':' + BOT_PORT : ''}" required autocomplete="off" placeholder="vangioinetwork.xyz hoặc ip:port"></div>
      <button type="submit" class="btn-save">Lưu Cấu Hình & Tái Kết Nối</button>
    </div>
  </form>

  <!-- ============ AUTO CLICK ============ -->
  <div class="card">
    <h3>🖱️ Auto Click</h3>
    <div class="feature-row">
      <span class="name">Trạng thái</span>
      <div style="display:flex;gap:8px;align-items:center">
        ${acInd}
        <a href="/api/toggle-autoclick" style="text-decoration:none">
          <button type="button" class="${CONFIG.autoClickEnabled ? 'btn-stop' : 'btn-start'}">${CONFIG.autoClickEnabled ? 'TẮT' : 'BẬT'}</button>
        </a>
      </div>
    </div>
    <form action="/api/set-autoclick" method="POST">
      <div class="mini-form">
        <div><label>Delay trái (ms)</label><input type="number" name="leftDelay" value="${CONFIG.leftClickDelay}" min="10"></div>
        <div><label>Delay phải (ms)</label><input type="number" name="rightDelay" value="${CONFIG.rightClickDelay}" min="10"></div>
        <button type="submit" class="btn-save" style="margin-top:0;width:auto">Lưu</button>
      </div>
      <div style="display:flex;gap:20px;font-size:.9rem;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;color:#f8fafc;margin-bottom:0"><input type="checkbox" name="enableLeft" ${CONFIG.enableLeft ? 'checked' : ''}> Bật click trái</label>
        <label style="display:flex;align-items:center;gap:6px;color:#f8fafc;margin-bottom:0"><input type="checkbox" name="enableRight" ${CONFIG.enableRight ? 'checked' : ''}> Bật click phải</label>
      </div>
    </form>
  </div>

  <!-- ============ AUTO RESET ============ -->
  <div class="card">
    <h3>🔄 Auto Reset</h3>
    <div class="feature-row">
      <span class="name">Trạng thái</span>
      <div style="display:flex;gap:8px;align-items:center">
        ${arInd}
        <a href="/api/toggle-autoreset" style="text-decoration:none">
          <button type="button" class="${CONFIG.autoResetEnabled ? 'btn-stop' : 'btn-start'}">${CONFIG.autoResetEnabled ? 'TẮT' : 'BẬT'}</button>
        </a>
      </div>
    </div>
    <form action="/api/set-autoreset" method="POST">
      <div class="mini-form">
        <div><label>Chu kỳ (ms)</label><input type="number" name="interval" value="${CONFIG.autoResetInterval}" min="1000"></div>
        <div><label>Tạm dừng (ms)</label><input type="number" name="pause" value="${CONFIG.autoResetPauseTime}" min="500"></div>
        <button type="submit" class="btn-save" style="margin-top:0;width:auto">Lưu</button>
      </div>
    </form>
  </div>

  <!-- ============ AUTO WALK ============ -->
  <div class="card">
    <h3>🚶 Auto Walk <span style="font-size:.8rem;font-weight:normal;margin-left:auto">${awMode}</span></h3>
    <div class="feature-row">
      <span class="name">Trạng thái</span>
      <div style="display:flex;gap:8px;align-items:center">
        ${awInd}
        <a href="/api/toggle-autowalk" style="text-decoration:none">
          <button type="button" class="${CONFIG.autoWalkEnabled ? 'btn-stop' : 'btn-purple'}">${CONFIG.autoWalkEnabled ? 'DỪNG' : 'BẮT ĐẦU'}</button>
        </a>
      </div>
    </div>
    <form action="/api/set-autowalk" method="POST">
      <div class="continuous-box">
        <label>
          <input type="checkbox" name="continuous" ${CONFIG.autoWalkContinuous ? 'checked' : ''}>
          🔥 <b>Đi liên tục</b> (giữ W mãi mãi)
        </label>
        <label>
          <input type="checkbox" name="sprintEnabled" ${CONFIG.autoWalkSprintEnabled ? 'checked' : ''}>
          ⚡ <b>Chạy nhanh (Sprint)</b> như giữ Ctrl
        </label>
        <label>
          <input type="checkbox" name="sprintOnJump" ${CONFIG.autoWalkSprintOnJump ? 'checked' : ''}>
          Tự sprint khi nhảy (vượt block)
        </label>
        <label>
          <input type="checkbox" name="turnEnabled" ${CONFIG.autoWalkTurnEnabled ? 'checked' : ''}>
          Tự đổi hướng nhẹ
        </label>
      </div>

      <div class="mini-form" style="grid-template-columns:1fr 1fr 1fr auto">
        <div>
          <label>Đi (ms) ${CONFIG.autoWalkContinuous ? '<span style="color:#fbbf24">[bị bỏ qua]</span>' : ''}</label>
          <input type="number" name="duration" value="${CONFIG.autoWalkDuration}" min="500" ${CONFIG.autoWalkContinuous ? 'disabled' : ''}>
        </div>
        <div>
          <label>Nghỉ (ms) ${CONFIG.autoWalkContinuous ? '<span style="color:#fbbf24">[bị bỏ qua]</span>' : ''}</label>
          <input type="number" name="interval" value="${CONFIG.autoWalkInterval}" min="500" ${CONFIG.autoWalkContinuous ? 'disabled' : ''}>
        </div>
        <div>
          <label>Nhảy mỗi (ms)</label>
          <input type="number" name="jumpInterval" value="${CONFIG.autoWalkJumpInterval}" min="300">
        </div>
        <button type="submit" class="btn-save" style="margin-top:0;width:auto">Lưu</button>
      </div>
      <div style="font-size:.75rem;color:#94a3b8;margin-top:8px;line-height:1.5">
        ${CONFIG.autoWalkSprintEnabled
          ? '⚡ Đang <b style="color:#4ade80">CHẠY NHANH</b> (như giữ Ctrl + W)'
          : '🚶 Đang <b style="color:#38bdf8">ĐI BỘ</b> bình thường'}
        ${CONFIG.autoWalkContinuous ? ' — chế độ <b style="color:#fbbf24">LIÊN TỤC</b>' : ' — chế độ <b style="color:#38bdf8">CHU KỲ</b>'}
      </div>
    </form>
  </div>

  <!-- ============ GUI ============ -->
  <div class="card">
    <h3>📦 GUI Server ${currentWindow ? '<span class="indicator ind-on">CÓ</span>' : '<span class="indicator ind-off">KHÔNG</span>'}</h3>
    <div class="gui-box">
      ${guiLogs.length > 0 ? guiLogs.map(l => '<div>' + l + '</div>').join('') : '<i>Chưa có log GUI...</i>'}
    </div>
    <form action="/api/click-slot" method="POST" class="mini-form" style="margin-top:10px;grid-template-columns:1fr 1fr auto">
      <div><label>Số ô</label><input type="number" name="slot" min="0" placeholder="vd: 13"></div>
      <div><label>Tìm theo tên (tùy chọn)</label><input type="text" name="search" placeholder="vd: Emerald"></div>
      <input type="hidden" name="mode" value="name">
      <button type="submit" class="btn-purple" style="padding:10px 14px">Click</button>
    </form>
    <div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
      <a href="/api/close-gui" style="text-decoration:none"><button type="button" class="btn-warning">Đóng GUI</button></a>
      <a href="/api/clear-gui-log" style="text-decoration:none"><button type="button" class="btn-warning">Xóa log GUI</button></a>
    </div>
  </div>

  <div class="card">
    <h3>Nhật Ký Nhắc Tên [${BOT_USERNAME}]</h3>
    <div class="kiru-box">
      ${botMentionLogs.length > 0 ? botMentionLogs.map(k => '<div>[' + k.time + ']' + k.text + '</div>').join('') : '<i>Chưa có tin nhắn nào nhắc đến ' + BOT_USERNAME + '...</i>'}
    </div>
  </div>
</div>

<div>
  <div class="card">
    <h3>Lịch Sử Ping</h3>
    <p style="word-break:break-all"><code>${pingLogs.length > 0 ? pingLogs.map(p => '[' + p.time + ':' + p.ping + 'ms]').join(' ➔ ') : 'Đang thu thập...'}</code></p>
  </div>

  <div class="card">
    <h3>Chat Server</h3>
    <div class="chat-box">${serverChatLogs.length > 0 ? serverChatLogs.map(l => '<div>' + l + '</div>').join('') : '<i>Chưa có nhật ký...</i>'}</div>
  </div>

  <div class="card">
    <h3>Nhật Ký Lỗi Phát Sinh</h3>
    <div class="error-box">${errorLogs.length > 0 ? errorLogs.map(e => '<div>[' + e.time + '] <b>[' + e.type + ']</b>:' + e.details + '</div>').join('') : '<div style="color:var(--accent-green)">Không có lỗi!</div>'}</div>
  </div>
</div>
</div>
</body>
</html>`);
});

app.listen(port, () => console.log(`[HTTP SERVER] Running on port ${port}`));

// ============ BOT LOGIC ============
function cleanupBot() {
  isAutoActionRunning = false;
  currentCoords = 'Đang xác định...';
  currentPing = 0;

  if (actionTimeout) { clearTimeout(actionTimeout); actionTimeout = null; }
  if (antiAfkTimeout) { clearTimeout(antiAfkTimeout); antiAfkTimeout = null; }

  [ramGcInterval, posCheckInterval, watchdogInterval, pingInterval].forEach(i => i && clearInterval(i));
  [reconnectTimeout, loginTimer1, loginTimer2, respawnTimer, commandResponseTimer].forEach(t => t && clearTimeout(t));

  if (leftInterval) { clearInterval(leftInterval); leftInterval = null; }
  if (rightInterval) { clearInterval(rightInterval); rightInterval = null; }
  if (autoResetTimer) { clearTimeout(autoResetTimer); autoResetTimer = null; }
  if (autoResetPauseTimer) { clearTimeout(autoResetPauseTimer); autoResetPauseTimer = null; }
  if (autoWalkForwardTimer) { clearTimeout(autoWalkForwardTimer); autoWalkForwardTimer = null; }
  if (autoWalkStopTimer) { clearTimeout(autoWalkStopTimer); autoWalkStopTimer = null; }
  if (autoWalkJumpTimer) { clearTimeout(autoWalkJumpTimer); autoWalkJumpTimer = null; }
  if (autoWalkTurnTimer) { clearTimeout(autoWalkTurnTimer); autoWalkTurnTimer = null; }

  CONFIG.autoClickEnabled = false;
  CONFIG.autoWalkEnabled = false;
  currentWindow = null;

  if (bot) {
    try {
      bot.clearControlStates();
      bot.removeAllListeners();
      if (bot._client) {
        bot._client.removeAllListeners();
        if (bot._client.socket) {
          bot._client.socket.removeAllListeners();
          bot._client.socket.destroy();
        }
        bot._client.end();
      }
      bot.quit();
    } catch (e) {}
    bot = null;
  }

  if (global.gc) { try { global.gc(); } catch (e) {} }
}

function scheduleNextAction() {
  if (actionTimeout) { clearTimeout(actionTimeout); actionTimeout = null; }
  if (isManualStopped || !bot || !bot._client || bot._client.socket.destroyed) { isAutoActionRunning = false; return; }

  isAutoActionRunning = true;
  lastActionTime = Date.now();
  const currentBot = bot;

  try {
    const actionType = Math.floor(Math.random() * 3);
    if (actionType === 0) currentBot.swingArm('right');
    else if (actionType === 1) {
      currentBot.setControlState('sneak', true);
      setTimeout(() => { if (bot === currentBot && bot.entity) bot.setControlState('sneak', false); }, Math.floor(150 + Math.random() * 200));
    } else { try { currentBot.activateItem(); } catch (err) {} }
  } catch (err) {}

  const randomDelay = Math.floor(5000 + Math.random() * 5000);
  actionTimeout = setTimeout(scheduleNextAction, randomDelay);
}

function scheduleRandomRotation() {
  if (antiAfkTimeout) clearTimeout(antiAfkTimeout);
  if (isManualStopped) return;

  const nextRotationDelay = Math.floor(15000 + Math.random() * 20000);
  antiAfkTimeout = setTimeout(() => {
    if (bot && bot.entity && bot.health > 0 && bot._client && bot._client.state === 'play') {
      try {
        const deltaYaw = (Math.random() - 0.5) * 0.3;
        const deltaPitch = (Math.random() - 0.5) * 0.1;
        bot.look(bot.entity.yaw + deltaYaw, bot.entity.pitch + deltaPitch, true);
      } catch (e) {}
    }
    scheduleRandomRotation();
  }, nextRotationDelay);
}

function createBot() {
  if (isManualStopped) return;

  cleanupBot();
  isFirstSpawn = true;
  lastTimeAge = 0;
  lastTimeAgeUpdate = Date.now();

  const currentOptions = {
    host: BOT_HOST, port: BOT_PORT, username: BOT_USERNAME,
    hideErrors: false, checkTimeoutInterval: 60 * 1000, keepAlive: true,
    physicsEnabled: true, viewDistance: 'tiny'
  };

  console.log(`\n[HỆ THỐNG] Kết nối đến ${currentOptions.host}:${currentOptions.port} với tên [${BOT_USERNAME}]...`);

  try {
    bot = mineflayer.createBot(currentOptions);
    bot.setMaxListeners(0);
    if (bot._client) {
      bot._client.setMaxListeners(0);
      bot._client.on('error', (err) => {
        addErrorLog('Client Socket Error', err.message || err.code || 'Lỗi TCP Socket');
      });
    }
  } catch (err) {
    addErrorLog('Init Failed', err.message);
    handleReconnect();
    return;
  }

  bot.on('spawn', () => {
    console.log('[LOG] Bot đã vào game!');
    addChatLog('Kết nối ổn định thành công!');
    triggerChatWindow(12000);
    consecutiveFailures = 0;

    if (isFirstSpawn) {
      isFirstSpawn = false;

      loginTimer1 = setTimeout(() => {
        if (bot && bot._client && !isManualStopped) {
          bot.chat(`/l ${BOT_PASSWORD}`);
          triggerChatWindow(4000);
        }
      }, 3500);

      loginTimer2 = setTimeout(() => {
        if (bot && bot._client && !isManualStopped) {
          bot.chat('/afkmode vao');
          triggerChatWindow(6000);
          scheduleNextAction();
          scheduleRandomRotation();
        }
      }, 7000);

      ramGcInterval = setInterval(() => {
        if (bot && bot.entities && bot.entity && bot.entity.position) {
          const myPos = bot.entity.position;
          Object.keys(bot.entities).forEach(id => {
            const ent = bot.entities[id];
            if (ent && ent.position && ent.id !== bot.entity.id) {
              if (ent.position.distanceTo(myPos) > 16) delete bot.entities[id];
            }
          });
        }
        if (global.gc) { try { global.gc(); } catch (e) {} }
      }, 30000);

      pingInterval = setInterval(() => {
        if (bot && bot.player) { currentPing = bot.player.ping || 0; addPingLog(currentPing); }
      }, 10000);

      posCheckInterval = setInterval(() => {
        if (bot && bot.entity && bot.entity.position) {
          const pos = bot.entity.position;
          currentCoords = `x: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
        }
      }, 5000);

      watchdogInterval = setInterval(() => {
        if (!bot || isManualStopped) return;
        if (!isAutoActionRunning || Date.now() - lastActionTime > 20000) scheduleNextAction();
        if (bot.time) {
          if (bot.time.age === lastTimeAge) {
            if (Date.now() - lastTimeAgeUpdate > 45000) {
              addErrorLog('Watchdog', 'Kẹt Packet thế giới > 45s. Tiến hành Reconnect...');
              handleReconnect();
            }
          } else { lastTimeAge = bot.time.age; lastTimeAgeUpdate = Date.now(); }
        }
      }, 15000);
    }
  });

  bot.on('death', () => {
    addChatLog('Bot tử vong! Chờ hồi sinh...');
    addErrorLog('Event Chết', 'Bot tử vong');
    respawnTimer = setTimeout(() => {
      if (bot && bot._client && !isManualStopped) { try { bot.respawn(); } catch (e) {} }
      setTimeout(() => {
        if (bot && bot._client && !isManualStopped) {
          bot.chat('/afkmode vao');
          addChatLog('Hồi sinh -> /afkmode vao');
          triggerChatWindow(5000);
          scheduleNextAction();
          scheduleRandomRotation();
        }
      }, 4500);
    }, 4000);
  });

  bot.on('windowOpen', (w) => {
    if (isBotInventory(w)) {
      addGuiLog(`[GUI] ⏭️ Bỏ qua inventory của bot`);
      return;
    }
    currentWindow = w;
    readWindow(w);
    const title = extractText(w.title) || w.title || '';
    addChatLog(`[GUI] Mở: ${title}`);
  });

  bot.on('windowClose', () => {
    currentWindow = null;
    addGuiLog('[GUI] Đã đóng cửa sổ');
  });

  bot.on('heldItemChanged', () => {
    if (bot && bot.quickBarSlot !== undefined) {
      CONFIG.hotbarSelected = bot.quickBarSlot + 1;
    }
  });

  bot.on('message', (message) => {
    try {
      const text = message.toString().trim();
      if (!text) return;
      const lowerText = text.toLowerCase();
      const botNameLower = BOT_USERNAME.toLowerCase();

      if (lowerText.includes(botNameLower)) addBotMentionLog(text);

      if (text.includes('█') || lowerText.includes('hồi chiêu') || lowerText.includes('ʜồi ᴄʜɪêᴜ') || lowerText.includes('cooldown')) return;

      const isRelevant = lowerText.includes(botNameLower) || lowerText.includes('bot') || lowerText.includes('login') || lowerText.includes('afk');
      if (isRelevant || isAwaitingResponse) {
        addChatLog(text);
        console.log('[CHAT]: ' + text);
      }
    } catch (e) {}
  });

  bot.on('end', (reason) => {
    addErrorLog('Mất Kết Nối (End)', `Server ngắt socket: ${reason}`);
    handleReconnect();
  });

  bot.on('error', (err) => {
    addErrorLog('Mineflayer Error', err.message || err.toString());
  });

  bot.on('kicked', (reason) => {
    const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
    addErrorLog('Bị Server Kick', reasonStr);
    if (reasonStr.includes('LƯU DỮ LIỆU') || reasonStr.includes('lưu dữ liệu')) currentReconnectDelay = 15000;
    handleReconnect();
  });
}

function handleReconnect() {
  if (isManualStopped || isReconnecting) return;
  isReconnecting = true;
  cleanupBot();
  consecutiveFailures++;

  if (consecutiveFailures >= 10) {
    addErrorLog('CẢNH BÁO NẶNG', 'Mất kết nối nhiều lần. Khởi động lại App...');
    setTimeout(() => { process.exit(1); }, 3000);
    return;
  }

  console.log(`Chờ ${currentReconnectDelay / 1000}s để tái kết nối...`);
  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    createBot();
  }, currentReconnectDelay);
}

createBot();

process.on('uncaughtException', (err) => {
  addErrorLog('Uncaught Exception', `${err.message} (${err.code || 'NO_CODE'})`);
  handleReconnect();
});

process.on('unhandledRejection', (reason) => {
  addErrorLog('Unhandled Rejection', String(reason));
});
