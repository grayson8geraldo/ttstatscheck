/**
 * Background service worker for TikTok Stats Chrome Extension
 * Handles:
 * - Auto-collection of stats from TikTok Ads Manager
 * - Sending data to local aggregation server (localhost:3000)
 * - Google OAuth2 authentication and Google Sheets API (optional)
 */

const SERVER_URL = 'http://localhost:3220';
const ALARM_NAME = 'auto-collect-stats';

// Store access token in memory
let accessToken = null;

// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'auth_google') {
    handleGoogleAuth(sendResponse);
    return true;
  }

  if (request.action === 'send_to_sheets') {
    handleSendToSheets(request.data, request.settings, request.writeMode, sendResponse);
    return true;
  }

  if (request.action === 'collect_from_account') {
    handleCollectFromAccount(request.account, sendResponse);
    return true;
  }

  // Content script reports auto-collected data
  if (request.action === 'auto_report_stats') {
    handleAutoReport(request.data, request.accountName);
    sendResponse({ success: true });
    return true;
  }

  // Manual trigger from popup
  if (request.action === 'trigger_collect') {
    triggerAutoCollect();
    sendResponse({ success: true });
    return true;
  }

  // Get server status
  if (request.action === 'get_server_status') {
    checkServerHealth().then(status => sendResponse(status));
    return true;
  }
});

// --- Auto-collection setup ---

// Set up alarm on extension install/update
chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
  // Try initial collection after a short delay
  setTimeout(triggerAutoCollect, 10000);
});

// Set up alarm on service worker startup
chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
  // Collect on browser startup
  setTimeout(triggerAutoCollect, 15000);
});

// Handle alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    triggerAutoCollect();
  }
});

function setupAlarm() {
  chrome.storage.local.get(['collectInterval'], (result) => {
    const minutes = result.collectInterval || 60; // Default: every 60 min
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes: minutes,
    });
    console.log(`[TikTok Stats] Автосбор настроен: каждые ${minutes} мин`);
  });
}

/**
 * Trigger auto-collection: open TikTok Ads in a background tab,
 * extract data, send to local server
 */
async function triggerAutoCollect() {
  console.log('[TikTok Stats] Запуск автоматического сбора...');

  // Get the TikTok Ads URL to collect from
  // In each anti-detect profile, we auto-detect the account
  const url = 'https://ads.tiktok.com/i18n/perf/campaign';

  let tabId = null;
  try {
    // Check if server is available first
    const health = await checkServerHealth();
    if (!health.ok) {
      console.log('[TikTok Stats] Сервер недоступен, пропускаем сбор');
      return;
    }

    // Create background tab
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;

    // Wait for page to load
    await waitForTabLoad(tabId);

    // Extra time for TikTok's dynamic content
    await sleep(5000);

    // Inject content script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js'],
    });

    await sleep(1000);

    // Extract data
    const response = await chrome.tabs.sendMessage(tabId, { action: 'extract_stats' });

    // Close tab
    await chrome.tabs.remove(tabId);
    tabId = null;

    if (response && response.success && response.data && response.data.length > 0) {
      // Send to local server
      await sendToServer(response.data);
      console.log(`[TikTok Stats] Отправлено ${response.data.length} записей на сервер`);
    } else {
      console.log('[TikTok Stats] Нет данных для отправки');
    }
  } catch (err) {
    console.error('[TikTok Stats] Ошибка автосбора:', err.message);
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch (_) { /* ignore */ }
    }
  }
}

/**
 * Handle auto-reported data from content script
 */
async function handleAutoReport(data, accountName) {
  if (!data || data.length === 0) return;

  try {
    await sendToServer(data);
    console.log(`[TikTok Stats] Авто-отчёт: ${data.length} записей от "${accountName || 'unknown'}"`);
  } catch (err) {
    console.error('[TikTok Stats] Ошибка отправки авто-отчёта:', err.message);
  }
}

/**
 * Send data to local aggregation server
 */
async function sendToServer(data) {
  if (!data || data.length === 0) return;

  // Group by account name
  const grouped = {};
  data.forEach(row => {
    const acc = row.account || 'Unknown Account';
    if (!grouped[acc]) grouped[acc] = [];
    grouped[acc].push(row);
  });

  // Send each account's data separately
  for (const [accountName, campaigns] of Object.entries(grouped)) {
    const response = await fetch(`${SERVER_URL}/api/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountName,
        campaigns,
        date: campaigns[0]?.date || new Date().toLocaleDateString('ru-RU'),
      }),
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
  }
}

/**
 * Check if local server is running
 */
async function checkServerHealth() {
  try {
    const resp = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      return { ok: true };
    }
    return { ok: false, error: `HTTP ${resp.status}` };
  } catch {
    return { ok: false, error: 'Server unreachable' };
  }
}

// --- Existing functionality (Google Auth + Sheets) ---

async function handleGoogleAuth(sendResponse) {
  try {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      if (token) {
        accessToken = token;
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'Токен не получен' });
      }
    });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function handleSendToSheets(data, settings, writeMode, sendResponse) {
  try {
    if (!accessToken) {
      accessToken = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: false }, (token) => {
          if (chrome.runtime.lastError || !token) {
            reject(new Error('Необходима авторизация в Google. Нажмите "Авторизоваться".'));
          } else {
            resolve(token);
          }
        });
      });
    }

    const { spreadsheetId, sheetName, startRow, colAccount, colCampaign, colSpend, colCpc, colCpl, colDate } = settings;

    const columnMap = {
      [colAccount]: 'account',
      [colCampaign]: 'campaign',
      [colSpend]: 'spend',
      [colCpc]: 'cpc',
      [colCpl]: 'cpl',
      [colDate]: 'date',
    };

    const sortedCols = Object.keys(columnMap).sort();
    const firstCol = sortedCols[0];
    const lastCol = sortedCols[sortedCols.length - 1];

    const colToIndex = (col) => {
      let idx = 0;
      for (let i = 0; i < col.length; i++) {
        idx = idx * 26 + (col.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
      }
      return idx - 1;
    };

    const firstColIdx = colToIndex(firstCol);
    const lastColIdx = colToIndex(lastCol);
    const numCols = lastColIdx - firstColIdx + 1;

    const rows = data.map(item => {
      const row = new Array(numCols).fill('');
      for (const [col, field] of Object.entries(columnMap)) {
        const idx = colToIndex(col) - firstColIdx;
        if (idx >= 0 && idx < numCols) {
          row[idx] = item[field] || '';
        }
      }
      return row;
    });

    let result;
    const actualStartRow = parseInt(startRow) || 2;

    if (writeMode === 'append') {
      result = await appendToSheet(spreadsheetId, sheetName, firstCol, lastCol, rows);
    } else {
      const range = `${sheetName}!${firstCol}${actualStartRow}:${lastCol}${actualStartRow + rows.length - 1}`;
      result = await updateSheet(spreadsheetId, range, rows);
    }

    sendResponse({ success: true, updatedRows: rows.length, result });
  } catch (err) {
    if (err.message && err.message.includes('401')) {
      accessToken = null;
      chrome.identity.removeCachedAuthToken({ token: accessToken });
      sendResponse({ success: false, error: 'Токен истёк. Нажмите "Авторизоваться" и попробуйте снова.' });
    } else {
      sendResponse({ success: false, error: err.message });
    }
  }
}

async function appendToSheet(spreadsheetId, sheetName, firstCol, lastCol, rows) {
  const range = `${sheetName}!${firstCol}:${lastCol}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: rows }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Google Sheets API ошибка (${response.status}): ${errorData.error?.message || response.statusText}`);
  }

  return await response.json();
}

async function handleCollectFromAccount(account, sendResponse) {
  let tabId = null;
  try {
    const tab = await chrome.tabs.create({ url: account.url, active: false });
    tabId = tab.id;

    await waitForTabLoad(tabId);
    await sleep(4000);

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js'],
    });

    await sleep(500);

    const response = await chrome.tabs.sendMessage(tabId, { action: 'extract_stats' });

    await chrome.tabs.remove(tabId);
    tabId = null;

    if (response && response.success && response.data) {
      const data = response.data.map(row => ({
        ...row,
        account: row.account || account.name,
      }));

      // Also send to local server if available
      sendToServer(data).catch(() => { /* ignore server errors */ });

      sendResponse({ success: true, data });
    } else {
      sendResponse({ success: false, error: response?.error || 'Не удалось собрать данные с аккаунта' });
    }
  } catch (err) {
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch (_) { /* ignore */ }
    }
    sendResponse({ success: false, error: err.message });
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Таймаут загрузки страницы (30 сек)'));
    }, 30000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateSheet(spreadsheetId, range, rows) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: rows }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Google Sheets API ошибка (${response.status}): ${errorData.error?.message || response.statusText}`);
  }

  return await response.json();
}
