document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = window.location.origin;

  const el = {
    dateFilter: document.getElementById('date-filter'),
    refreshBtn: document.getElementById('refresh-btn'),
    statusBar: document.getElementById('status-bar'),
    statusText: document.getElementById('status-text'),
    connectionStatus: document.getElementById('connection-status'),
    connectionText: document.getElementById('connection-text'),
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
    lastUpdated: document.getElementById('last-updated'),
    autoRefresh: document.getElementById('auto-refresh'),
    clearDataBtn: document.getElementById('clear-data-btn'),
  };

  let allData = [];
  let sortField = 'date';
  let sortAsc = false;
  let refreshTimer = null;

  // --- Init ---
  fetchData();
  setupAutoRefresh();

  // --- Event listeners ---
  el.refreshBtn.addEventListener('click', fetchData);
  el.dateFilter.addEventListener('change', renderAll);
  el.searchInput.addEventListener('input', renderCampaigns);
  el.accountFilter.addEventListener('change', renderCampaigns);
  el.autoRefresh.addEventListener('change', setupAutoRefresh);
  el.clearDataBtn.addEventListener('click', clearData);

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

  // --- Fetch data from server ---
  async function fetchData() {
    try {
      el.connectionStatus.className = 'connection-indicator loading';
      el.connectionText.textContent = 'Загрузка...';

      const resp = await fetch(`${API_BASE}/api/stats`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      allData = data.entries || [];

      el.connectionStatus.className = 'connection-indicator connected';
      el.connectionText.textContent = `Подключено | ${data.accountCount} аккаунтов`;

      if (data.lastUpdated) {
        el.lastUpdated.textContent = 'Последнее обновление: ' + new Date(data.lastUpdated).toLocaleString('ru-RU');
      }

      renderAll();
    } catch (err) {
      el.connectionStatus.className = 'connection-indicator disconnected';
      el.connectionText.textContent = 'Сервер недоступен';
      showStatus('Не удалось загрузить данные: ' + err.message, 'error');
    }
  }

  // --- Auto refresh ---
  function setupAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    const interval = parseInt(el.autoRefresh.value);
    if (interval > 0) {
      refreshTimer = setInterval(fetchData, interval * 1000);
    }
  }

  // --- Clear all data ---
  async function clearData() {
    if (!confirm('Удалить все данные? Это действие нельзя отменить.')) return;
    try {
      await fetch(`${API_BASE}/api/stats`, { method: 'DELETE' });
      allData = [];
      renderAll();
      showStatus('Все данные удалены', 'success');
    } catch (err) {
      showStatus('Ошибка при удалении: ' + err.message, 'error');
    }
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

  function parseDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('.');
    if (parts.length === 3) {
      return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    }
    return new Date(dateStr);
  }

  function parseNum(val) {
    if (!val || val === '-' || val === 'N/A') return 0;
    return parseFloat(String(val).replace(/[^\d.,\-]/g, '').replace(',', '.')) || 0;
  }

  function fmt(num, decimals = 2) {
    if (num === 0) return '\u2014';
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
      el.totalAccounts.textContent = '\u2014';
      el.totalSpend.textContent = '\u2014';
      el.avgCpc.textContent = '\u2014';
      el.avgCpl.textContent = '\u2014';
      el.totalCampaigns.textContent = '\u2014';
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

    const grouped = {};
    data.forEach(row => {
      const acc = row.account || 'Неизвестный';
      if (!grouped[acc]) grouped[acc] = [];
      grouped[acc].push(row);
    });

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
      const campaignSet = new Set(rows.map(d => d.campaign).filter(Boolean));

      // Find latest collectedAt
      const latestTime = rows
        .map(r => r.collectedAt)
        .filter(Boolean)
        .sort()
        .pop();

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${escapeHtml(accName)}</strong></td>
        <td>${fmt(totalSpend)}</td>
        <td>${fmt(avgCpc)}</td>
        <td>${fmt(avgCpl)}</td>
        <td>${campaignSet.size}</td>
        <td>${rows.length}</td>
        <td>${latestTime ? new Date(latestTime).toLocaleString('ru-RU') : '\u2014'}</td>
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
