/**
 * Background service worker for TikTok Stats Chrome Extension
 * Handles Google OAuth2 authentication and Google Sheets API calls
 */

// Store access token in memory
let accessToken = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'auth_google') {
    handleGoogleAuth(sendResponse);
    return true; // Keep channel open for async
  }

  if (request.action === 'send_to_sheets') {
    handleSendToSheets(request.data, request.settings, request.writeMode, sendResponse);
    return true;
  }

  if (request.action === 'collect_from_account') {
    handleCollectFromAccount(request.account, sendResponse);
    return true;
  }
});

/**
 * Authenticate with Google using Chrome Identity API
 */
async function handleGoogleAuth(sendResponse) {
  try {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          success: false,
          error: chrome.runtime.lastError.message
        });
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

/**
 * Send extracted data to Google Sheets
 */
async function handleSendToSheets(data, settings, writeMode, sendResponse) {
  try {
    // Ensure we have a token
    if (!accessToken) {
      // Try to get token silently
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

    // Build the values array according to column mapping
    const columnMap = {
      [colAccount]: 'account',
      [colCampaign]: 'campaign',
      [colSpend]: 'spend',
      [colCpc]: 'cpc',
      [colCpl]: 'cpl',
      [colDate]: 'date',
    };

    // Sort columns alphabetically to determine range
    const sortedCols = Object.keys(columnMap).sort();
    const firstCol = sortedCols[0];
    const lastCol = sortedCols[sortedCols.length - 1];

    // Convert column letters to indices (A=0, B=1, ...)
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

    // Build rows
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
      // Append after the last row with data
      result = await appendToSheet(spreadsheetId, sheetName, firstCol, lastCol, rows);
    } else {
      // Overwrite starting from startRow
      const range = `${sheetName}!${firstCol}${actualStartRow}:${lastCol}${actualStartRow + rows.length - 1}`;
      result = await updateSheet(spreadsheetId, range, rows);
    }

    sendResponse({
      success: true,
      updatedRows: rows.length,
      result: result
    });

  } catch (err) {
    // If token expired, clear it and retry
    if (err.message && err.message.includes('401')) {
      accessToken = null;
      chrome.identity.removeCachedAuthToken({ token: accessToken });
      sendResponse({
        success: false,
        error: 'Токен истёк. Нажмите "Авторизоваться" и попробуйте снова.'
      });
    } else {
      sendResponse({ success: false, error: err.message });
    }
  }
}

/**
 * Append rows to the end of the sheet
 */
async function appendToSheet(spreadsheetId, sheetName, firstCol, lastCol, rows) {
  const range = `${sheetName}!${firstCol}:${lastCol}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: rows,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `Google Sheets API ошибка (${response.status}): ${errorData.error?.message || response.statusText}`
    );
  }

  return await response.json();
}

/**
 * Collect stats from a single TikTok account by opening a background tab,
 * waiting for the page to load, injecting the content script, and extracting data.
 */
async function handleCollectFromAccount(account, sendResponse) {
  let tabId = null;
  try {
    // Create a tab in the background
    const tab = await chrome.tabs.create({ url: account.url, active: false });
    tabId = tab.id;

    // Wait for the tab to finish loading
    await waitForTabLoad(tabId);

    // Give the page extra time for dynamic content to render
    await sleep(4000);

    // Inject the content script into the tab
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content/content.js'],
    });

    // Small delay for content script to initialize
    await sleep(500);

    // Send extract message to the content script
    const response = await chrome.tabs.sendMessage(tabId, { action: 'extract_stats' });

    // Close the background tab
    await chrome.tabs.remove(tabId);
    tabId = null;

    if (response && response.success && response.data) {
      // Override account name with the configured name
      const data = response.data.map(row => ({
        ...row,
        account: row.account || account.name,
      }));
      sendResponse({ success: true, data });
    } else {
      sendResponse({
        success: false,
        error: response?.error || 'Не удалось собрать данные с аккаунта',
      });
    }
  } catch (err) {
    // Clean up tab if it was opened
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch (_) { /* ignore */ }
    }
    sendResponse({ success: false, error: err.message });
  }
}

/**
 * Wait for a tab to finish loading
 */
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

/**
 * Update (overwrite) a specific range
 */
async function updateSheet(spreadsheetId, range, rows) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: rows,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `Google Sheets API ошибка (${response.status}): ${errorData.error?.message || response.statusText}`
    );
  }

  return await response.json();
}
