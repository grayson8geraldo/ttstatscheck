document.addEventListener('DOMContentLoaded', async () => {
  const el = {
    dateFilter: document.getElementById('date-filter'),
    collectBtn: document.getElementById('collect-btn'),
    statusBar: document.getElementById('status-bar'),
    statusText: document.getElementById('status-text'),
    progressSection: document.getElementById('progress-section'),
    progressText: document.getElementById('progress-text'),
    progressBar: document.getElementById('progress-bar'),
    totalAccounts: document.getElementById('total-accounts'),
    totalSpend: document.getElementById('total-spend'),
    avgCpc: document.getElementById('avg-cpc'),
    avgCpl: document.getElementById('avg-cpl'),
    totalCampaigns: document.getElementById('total-campaigns'),
    totalRows: document.getElementById('total-rows'),
    accountsBody: document.getElementById('accounts-body'),
    noAccounts: document.getElementById('no-accounts'),
    searchInput: document.getElementById('search-input'),
    accountFilter: document.getElementById('account-filter'),
    campaignsBody: document.getElementById('campaigns-body'),
    noCampaigns: document.getElementById('no-campaigns'),
    newAccountUrl: document.getElementById('new-account-url'),
    newAccountName: document.getElementById('new-account-name'),
    addAccountBtn: document.getElementById('add-account-btn'),
    accountsList: document.getElementById('accounts-list'),
    lastUpdated: document.getElementById('last-updated'),
  };

  let allData = [];
  let sortField = 'date';
  let sortAsc = false;

  // --- Init ---
  await loadAccounts();
  await loadData();
  renderAll();

  // --- Event listeners ---
  el.collectBtn.addEventListener('click', collectAll);
  el.dateFilter.addEventListener('change', renderAll);
  el.searchInput.addEventListener('input', renderCampaigns);
  el.accountFilter.addEventListener('change', renderCampaigns);
  el.addAccountBtn.addEventListener('click', addAccount);
  el.newAccountUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addAccount();
  });

  document.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (sortField === field) {
        sortAsc = !sortAsc;
      } else {
        sortField = field;
        sortAsc = true;
      }
      renderCampaigns();
    });
  });

  // --- Load saved data ---
  async function loadData() {
    const stored = await chrome.storage.local.get(['dashboardData', 'lastCollected']);
    allData = stored.dashboardData || [];
    if (stored.lastCollected) {
      el.lastUpdated.textContent = 'Последнее обновление: ' + new Date(stored.lastCollected).toLocaleString('ru-RU');
    }
  }

  // --- Load account list ---
  async function loadAccounts() {
    const stored = await chrome.storage.local.get(['tiktokAccounts']);
    const accounts = stored.tiktokAccounts || [];
    renderAccountsList(accounts);
  }

  // --- Add account ---
  async function addAccount() {
    const url = el.newAccountUrl.value.trim();
    const name = el.newAccountName.value.trim();

    if (!url) {
      showStatus('Укажите URL аккаунта', 'error');
      return;
    }

    if (!url.includes('ads.tiktok.com')) {
      showStatus('URL должен быть со страницы ads.tiktok.com', 'error');
      return;
    }

    const stored = await chrome.storage.local.get(['tiktokAccounts']);
    const accounts = stored.tiktokAccounts || [];

    accounts.push({
      id: Date.now().toString(),
      url: url,
      name: name || 'Аккаунт ' + (accounts.length + 1),
    });

    await chrome.storage.local.set({ tiktokAccounts: accounts });
    el.newAccountUrl.value = '';
    el.newAccountName.value = '';
    renderAccountsList(accounts);
    showStatus('Аккаунт добавлен', 'success');
  }

  // --- Remove account ---
  async function removeAccount(id) {
    const stored = await chrome.storage.local.get(['tiktokAccounts']);
    const accounts = (stored.tiktokAccounts || []).filter(a => a.id !== id);
    await chrome.storage.local.set({ tiktokAccounts: accounts });
    renderAccountsList(accounts);
  }

  // --- Render accounts management list ---
  function renderAccountsList(accounts) {
    el.accountsList.innerHTML = '';
    if (accounts.length === 0) {
      el.accountsList.innerHTML = '<div class="empty-hint">Нет добавленных аккаунтов</div>';
      return;
    }
    accounts.forEach(acc => {
      const row = document.createElement('div');
      row.className = 'account-row';
      row.innerHTML = `
        <span class="account-name">${escapeHtml(acc.name)}</span>
        <span class="account-url">${escapeHtml(acc.url.substring(0, 60))}${acc.url.length > 60 ? '...' : ''}</span>
        <button class="btn-remove" data-id="${acc.id}" title="Удалить">&#x2715;</button>
      `;
      row.querySelector('.btn-remove').addEventListener('click', () => removeAccount(acc.id));
      el.accountsList.appendChild(row);
    });
  }

  // --- Collect data from all accounts ---
  async function collectAll() {
    const stored = await chrome.storage.local.get(['tiktokAccounts']);
    const accounts = stored.tiktokAccounts || [];

    if (accounts.length === 0) {
      showStatus('Сначала добавьте аккаунты внизу страницы', 'error');
      return;
    }

    el.collectBtn.disabled = true;
    el.progressSection.classList.remove('hidden');
    el.progressBar.style.width = '0%';

    const collectedData = [];
    let errors = [];

    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      el.progressText.textContent = `Сбор данных: ${acc.name} (${i + 1}/${accounts.length})...`;
      el.progressBar.style.width = ((i / accounts.length) * 100) + '%';

      try {
        const data = await collectFromAccount(acc);
        collectedData.push(...data);
      } catch (err) {
        errors.push(`${acc.name}: ${err.message}`);
      }
    }

    el.progressBar.style.width = '100%';
    el.progressText.textContent = 'Готово!';

    // Merge with existing data: replace entries for the same date+account, add new ones
    const today = new Date().toLocaleDateString('ru-RU');
    // Remove today's entries for collected accounts to avoid duplicates
    const collectedAccountNames = [...new Set(collectedData.map(d => d.account))];
    allData = allData.filter(d => !(d.date === today && collectedAccountNames.includes(d.account)));
    allData.push(...collectedData);

    await chrome.storage.local.set({
      dashboardData: allData,
      lastCollected: Date.now(),
    });

    setTimeout(() => {
      el.progressSection.classList.add('hidden');
    }, 1500);

    el.collectBtn.disabled = false;

    if (errors.length > 0) {
      showStatus(`Собрано ${collectedData.length} записей. Ошибки: ${errors.join('; ')}`, 'error');
    } else {
      showStatus(`Собрано ${collectedData.length} записей из ${accounts.length} аккаунтов`, 'success');
    }

    el.lastUpdated.textContent = 'Последнее обновление: ' + new Date().toLocaleString('ru-RU');
    renderAll();
  }

  // --- Collect from a single account via background tab ---
  function collectFromAccount(account) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'collect_from_account', account },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.success) {
            resolve(response.data);
          } else {
            reject(new Error(response?.error || 'Не удалось собрать данные'));
          }
        }
      );
    });
  }

  // --- Filter data by date ---
  function getFilteredData() {
    const filter = el.dateFilter.value;
    if (filter === 'all') return allData;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return allData.filter(row => {
      const rowDate = parseDate(row.date);
      if (!rowDate) return false;

      switch (filter) {
        case 'today':
          return rowDate >= today;
        case 'yesterday': {
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          return rowDate >= yesterday && rowDate < today;
        }
        case '7days': {
          const weekAgo = new Date(today);
          weekAgo.setDate(weekAgo.getDate() - 7);
          return rowDate >= weekAgo;
        }
        case '30days': {
          const monthAgo = new Date(today);
          monthAgo.setDate(monthAgo.getDate() - 30);
          return rowDate >= monthAgo;
        }
        default:
          return true;
      }
    });
  }

  // --- Parse date string (dd.mm.yyyy) ---
  function parseDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('.');
    if (parts.length === 3) {
      return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    }
    return new Date(dateStr);
  }

  // --- Parse number from string ---
  function parseNum(val) {
    if (!val || val === '-' || val === 'N/A') return 0;
    return parseFloat(String(val).replace(/[^\d.,\-]/g, '').replace(',', '.')) || 0;
  }

  // --- Format number ---
  function fmt(num, decimals = 2) {
    if (num === 0) return '—';
    return num.toLocaleString('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  // --- Render everything ---
  function renderAll() {
    const data = getFilteredData();
    renderSummary(data);
    renderAccountsTable(data);
    renderCampaigns();
    updateAccountFilter(data);
  }

  // --- Render summary cards ---
  function renderSummary(data) {
    if (data.length === 0) {
      el.totalAccounts.textContent = '—';
      el.totalSpend.textContent = '—';
      el.avgCpc.textContent = '—';
      el.avgCpl.textContent = '—';
      el.totalCampaigns.textContent = '—';
      el.totalRows.textContent = '0';
      return;
    }

    const accounts = new Set(data.map(d => d.account).filter(Boolean));
    const campaigns = new Set(data.map(d => d.campaign).filter(Boolean));
    const totalSpend = data.reduce((sum, d) => sum + parseNum(d.spend), 0);

    const cpcValues = data.map(d => parseNum(d.cpc)).filter(v => v > 0);
    const avgCpc = cpcValues.length > 0 ? cpcValues.reduce((a, b) => a + b, 0) / cpcValues.length : 0;

    const cplValues = data.map(d => parseNum(d.cpl)).filter(v => v > 0);
    const avgCpl = cplValues.length > 0 ? cplValues.reduce((a, b) => a + b, 0) / cplValues.length : 0;

    el.totalAccounts.textContent = accounts.size;
    el.totalSpend.textContent = fmt(totalSpend);
    el.avgCpc.textContent = fmt(avgCpc);
    el.avgCpl.textContent = fmt(avgCpl);
    el.totalCampaigns.textContent = campaigns.size;
    el.totalRows.textContent = data.length;
  }

  // --- Render per-account table ---
  function renderAccountsTable(data) {
    el.accountsBody.innerHTML = '';

    if (data.length === 0) {
      el.noAccounts.classList.remove('hidden');
      return;
    }
    el.noAccounts.classList.add('hidden');

    // Group by account
    const grouped = {};
    data.forEach(row => {
      const acc = row.account || 'Неизвестный';
      if (!grouped[acc]) grouped[acc] = [];
      grouped[acc].push(row);
    });

    // Sort accounts by total spend desc
    const sortedAccounts = Object.entries(grouped).sort((a, b) => {
      const spendA = a[1].reduce((s, d) => s + parseNum(d.spend), 0);
      const spendB = b[1].reduce((s, d) => s + parseNum(d.spend), 0);
      return spendB - spendA;
    });

    sortedAccounts.forEach(([accName, rows]) => {
      const totalSpend = rows.reduce((s, d) => s + parseNum(d.spend), 0);
      const cpcVals = rows.map(d => parseNum(d.cpc)).filter(v => v > 0);
      const cplVals = rows.map(d => parseNum(d.cpl)).filter(v => v > 0);
      const avgCpc = cpcVals.length ? cpcVals.reduce((a, b) => a + b, 0) / cpcVals.length : 0;
      const avgCpl = cplVals.length ? cplVals.reduce((a, b) => a + b, 0) / cplVals.length : 0;
      const campaigns = new Set(rows.map(d => d.campaign).filter(Boolean));

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(accName)}</strong></td>
        <td>${fmt(totalSpend)}</td>
        <td>${fmt(avgCpc)}</td>
        <td>${fmt(avgCpl)}</td>
        <td>${campaigns.size}</td>
        <td>${rows.length}</td>
      `;
      el.accountsBody.appendChild(tr);
    });
  }

  // --- Update account filter dropdown ---
  function updateAccountFilter(data) {
    const currentVal = el.accountFilter.value;
    const accounts = [...new Set(data.map(d => d.account).filter(Boolean))].sort();

    el.accountFilter.innerHTML = '<option value="all">Все аккаунты</option>';
    accounts.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc;
      opt.textContent = acc;
      el.accountFilter.appendChild(opt);
    });
    el.accountFilter.value = currentVal;
  }

  // --- Render campaigns table ---
  function renderCampaigns() {
    const data = getFilteredData();
    const search = el.searchInput.value.toLowerCase();
    const accFilter = el.accountFilter.value;

    let filtered = data;
    if (accFilter !== 'all') {
      filtered = filtered.filter(d => d.account === accFilter);
    }
    if (search) {
      filtered = filtered.filter(d =>
        (d.account || '').toLowerCase().includes(search) ||
        (d.campaign || '').toLowerCase().includes(search)
      );
    }

    // Sort
    filtered.sort((a, b) => {
      let valA, valB;
      if (['spend', 'cpc', 'cpl'].includes(sortField)) {
        valA = parseNum(a[sortField]);
        valB = parseNum(b[sortField]);
      } else {
        valA = (a[sortField] || '').toLowerCase();
        valB = (b[sortField] || '').toLowerCase();
      }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });

    el.campaignsBody.innerHTML = '';

    if (filtered.length === 0) {
      el.noCampaigns.classList.remove('hidden');
      return;
    }
    el.noCampaigns.classList.add('hidden');

    filtered.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.account || '-')}</td>
        <td>${escapeHtml(row.campaign || '-')}</td>
        <td>${escapeHtml(row.spend || '-')}</td>
        <td>${escapeHtml(row.cpc || '-')}</td>
        <td>${escapeHtml(row.cpl || '-')}</td>
        <td>${escapeHtml(row.date || '-')}</td>
      `;
      el.campaignsBody.appendChild(tr);
    });
  }

  // --- Status messages ---
  function showStatus(msg, type) {
    el.statusBar.className = `status-bar ${type}`;
    el.statusText.textContent = msg;
    el.statusBar.classList.remove('hidden');
    if (type === 'success' || type === 'error') {
      setTimeout(() => el.statusBar.classList.add('hidden'), 6000);
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
