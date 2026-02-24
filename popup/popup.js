document.addEventListener('DOMContentLoaded', async () => {
  const elements = {
    spreadsheetId: document.getElementById('spreadsheet-id'),
    sheetName: document.getElementById('sheet-name'),
    startRow: document.getElementById('start-row'),
    colAccount: document.getElementById('col-account'),
    colCampaign: document.getElementById('col-campaign'),
    colSpend: document.getElementById('col-spend'),
    colCpc: document.getElementById('col-cpc'),
    colCpl: document.getElementById('col-cpl'),
    colDate: document.getElementById('col-date'),
    saveSettings: document.getElementById('save-settings'),
    authGoogle: document.getElementById('auth-google'),
    authStatus: document.getElementById('auth-status'),
    authStatusText: document.getElementById('auth-status-text'),
    extractBtn: document.getElementById('extract-btn'),
    previewSection: document.getElementById('preview-section'),
    previewBody: document.getElementById('preview-body'),
    rowCount: document.getElementById('row-count'),
    confirmSend: document.getElementById('confirm-send'),
    cancelSend: document.getElementById('cancel-send'),
    statusBar: document.getElementById('status-bar'),
    statusText: document.getElementById('status-text'),
    logContainer: document.getElementById('log-container'),
  };

  let extractedData = [];

  // Load saved settings
  const settings = await chrome.storage.local.get([
    'spreadsheetId', 'sheetName', 'startRow',
    'colAccount', 'colCampaign', 'colSpend', 'colCpc', 'colCpl', 'colDate',
    'isAuthed'
  ]);

  if (settings.spreadsheetId) elements.spreadsheetId.value = settings.spreadsheetId;
  if (settings.sheetName) elements.sheetName.value = settings.sheetName;
  if (settings.startRow) elements.startRow.value = settings.startRow;
  if (settings.colAccount) elements.colAccount.value = settings.colAccount;
  if (settings.colCampaign) elements.colCampaign.value = settings.colCampaign;
  if (settings.colSpend) elements.colSpend.value = settings.colSpend;
  if (settings.colCpc) elements.colCpc.value = settings.colCpc;
  if (settings.colCpl) elements.colCpl.value = settings.colCpl;
  if (settings.colDate) elements.colDate.value = settings.colDate;

  if (settings.isAuthed) {
    setAuthStatus(true);
  }

  function setAuthStatus(authed) {
    if (authed) {
      elements.authStatus.className = 'auth-status authed';
      elements.authStatusText.textContent = 'Авторизован в Google';
      elements.authGoogle.textContent = 'Переавторизоваться';
    } else {
      elements.authStatus.className = 'auth-status not-auth';
      elements.authStatusText.textContent = 'Не авторизован';
      elements.authGoogle.textContent = 'Авторизоваться в Google';
    }
  }

  function showStatus(message, type) {
    elements.statusBar.className = `status-bar ${type}`;
    elements.statusText.textContent = message;
    elements.statusBar.classList.remove('hidden');

    if (type === 'success' || type === 'error') {
      setTimeout(() => {
        elements.statusBar.classList.add('hidden');
      }, 5000);
    }
  }

  function addLog(message, type = '') {
    const time = new Date().toLocaleTimeString('ru-RU');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="timestamp">[${time}]</span> ${message}`;
    elements.logContainer.prepend(entry);
  }

  // Save settings
  elements.saveSettings.addEventListener('click', async () => {
    const settingsToSave = {
      spreadsheetId: elements.spreadsheetId.value.trim(),
      sheetName: elements.sheetName.value.trim(),
      startRow: parseInt(elements.startRow.value) || 2,
      colAccount: elements.colAccount.value.trim().toUpperCase(),
      colCampaign: elements.colCampaign.value.trim().toUpperCase(),
      colSpend: elements.colSpend.value.trim().toUpperCase(),
      colCpc: elements.colCpc.value.trim().toUpperCase(),
      colCpl: elements.colCpl.value.trim().toUpperCase(),
      colDate: elements.colDate.value.trim().toUpperCase(),
    };

    if (!settingsToSave.spreadsheetId) {
      showStatus('Укажите ID Google Таблицы', 'error');
      return;
    }

    await chrome.storage.local.set(settingsToSave);
    showStatus('Настройки сохранены', 'success');
    addLog('Настройки сохранены', 'success');
  });

  // Google Auth
  elements.authGoogle.addEventListener('click', () => {
    showStatus('Авторизация...', 'loading');
    addLog('Начинаем авторизацию в Google...');

    chrome.runtime.sendMessage({ action: 'auth_google' }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Ошибка: ' + chrome.runtime.lastError.message, 'error');
        addLog('Ошибка авторизации: ' + chrome.runtime.lastError.message, 'error');
        return;
      }

      if (response && response.success) {
        setAuthStatus(true);
        chrome.storage.local.set({ isAuthed: true });
        showStatus('Авторизация успешна!', 'success');
        addLog('Авторизация в Google прошла успешно', 'success');
      } else {
        showStatus('Ошибка авторизации: ' + (response?.error || 'Неизвестная ошибка'), 'error');
        addLog('Ошибка авторизации: ' + (response?.error || 'Неизвестная ошибка'), 'error');
      }
    });
  });

  // Extract data from TikTok Ads Manager
  elements.extractBtn.addEventListener('click', async () => {
    showStatus('Сбор данных с TikTok Ads Manager...', 'loading');
    addLog('Начинаем сбор данных...');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url || !tab.url.includes('ads.tiktok.com')) {
        showStatus('Откройте TikTok Ads Manager (ads.tiktok.com)', 'error');
        addLog('Ошибка: активная вкладка не ads.tiktok.com', 'error');
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, { action: 'extract_stats' });

      if (!response || !response.success) {
        showStatus('Ошибка: ' + (response?.error || 'Не удалось собрать данные'), 'error');
        addLog('Ошибка сбора: ' + (response?.error || 'Не удалось собрать данные'), 'error');
        return;
      }

      extractedData = response.data;
      addLog(`Найдено ${extractedData.length} строк данных`, 'success');

      if (extractedData.length === 0) {
        showStatus('Данные не найдены. Убедитесь, что таблица со статистикой загружена.', 'error');
        return;
      }

      // Show preview
      elements.previewBody.innerHTML = '';
      extractedData.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(row.account || '-')}</td>
          <td>${escapeHtml(row.campaign || '-')}</td>
          <td>${escapeHtml(row.spend || '-')}</td>
          <td>${escapeHtml(row.cpc || '-')}</td>
          <td>${escapeHtml(row.cpl || '-')}</td>
          <td>${escapeHtml(row.date || '-')}</td>
        `;
        elements.previewBody.appendChild(tr);
      });

      elements.rowCount.textContent = `${extractedData.length} строк`;
      elements.previewSection.classList.remove('hidden');
      showStatus(`Найдено ${extractedData.length} строк. Проверьте данные и нажмите "Отправить".`, 'info');

    } catch (err) {
      showStatus('Ошибка: ' + err.message, 'error');
      addLog('Ошибка: ' + err.message, 'error');
    }
  });

  // Cancel send
  elements.cancelSend.addEventListener('click', () => {
    elements.previewSection.classList.add('hidden');
    extractedData = [];
    showStatus('Отменено', 'info');
  });

  // Confirm send to Google Sheets
  elements.confirmSend.addEventListener('click', async () => {
    if (extractedData.length === 0) {
      showStatus('Нет данных для отправки', 'error');
      return;
    }

    const savedSettings = await chrome.storage.local.get([
      'spreadsheetId', 'sheetName', 'startRow',
      'colAccount', 'colCampaign', 'colSpend', 'colCpc', 'colCpl', 'colDate'
    ]);

    if (!savedSettings.spreadsheetId) {
      showStatus('Сначала укажите ID Google Таблицы в настройках', 'error');
      return;
    }

    const writeMode = document.querySelector('input[name="write-mode"]:checked').value;

    showStatus('Отправка данных в Google Sheets...', 'loading');
    addLog('Отправка данных в Google Sheets...');

    chrome.runtime.sendMessage({
      action: 'send_to_sheets',
      data: extractedData,
      settings: savedSettings,
      writeMode: writeMode
    }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Ошибка: ' + chrome.runtime.lastError.message, 'error');
        addLog('Ошибка отправки: ' + chrome.runtime.lastError.message, 'error');
        return;
      }

      if (response && response.success) {
        showStatus(`Данные отправлены! Обновлено ${response.updatedRows || extractedData.length} строк.`, 'success');
        addLog(`Данные успешно записаны в Google Sheets (${response.updatedRows || extractedData.length} строк)`, 'success');
        elements.previewSection.classList.add('hidden');
        extractedData = [];
      } else {
        showStatus('Ошибка: ' + (response?.error || 'Не удалось записать данные'), 'error');
        addLog('Ошибка записи: ' + (response?.error || 'Не удалось записать данные'), 'error');
      }
    });
  });

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
