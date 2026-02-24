/**
 * Content script for TikTok Ads Manager (ads.tiktok.com)
 * Extracts campaign statistics from the dashboard table.
 * Auto-reports data to background script for server aggregation.
 */

(function () {
  'use strict';

  const DEBUG = true;
  function log(...args) {
    if (DEBUG) console.log('[TikTok Stats]', ...args);
  }
  function logWarn(...args) {
    if (DEBUG) console.warn('[TikTok Stats]', ...args);
  }

  log('Content script loaded on:', location.href);

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extract_stats') {
      try {
        const data = extractTableData();
        log('Manual extract result:', data.length, 'rows');
        sendResponse({ success: true, data: data });
      } catch (err) {
        logWarn('Manual extract error:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    }
    return true;
  });

  // --- Auto-report: extract data after page loads and send to background ---
  let autoReportDone = false;

  function tryAutoReport() {
    if (autoReportDone) return;

    log('Attempting auto-report...');
    try {
      const data = extractTableData();
      log('Auto-report extracted', data.length, 'rows');
      if (data && data.length > 0) {
        autoReportDone = true;
        const accountName = detectAccountName();
        log('Sending to background. Account:', accountName);
        chrome.runtime.sendMessage({
          action: 'auto_report_stats',
          data: data,
          accountName: accountName,
        });
        showNotification(`Собрано ${data.length} кампаний`, 'success');
      } else {
        log('No data found. Page tables:', document.querySelectorAll('table').length,
            'Arco tables:', document.querySelectorAll('[class*="arco-table"], [class*="byted-table"]').length);
        logTableDebugInfo();
      }
    } catch (err) {
      logWarn('Auto-report error:', err.message, err.stack);
    }
  }

  function logTableDebugInfo() {
    // Log all tables and their headers for debugging
    const tables = document.querySelectorAll('table');
    tables.forEach((t, i) => {
      const headers = Array.from(t.querySelectorAll('th, thead td')).map(h => h.textContent.trim());
      log(`Table #${i} headers:`, headers);
      log(`Table #${i} rows:`, t.querySelectorAll('tbody tr').length);
    });

    // Log arco/byted tables
    const arcoTables = document.querySelectorAll('[class*="arco-table"], [class*="byted-table"], [class*="semi-table"]');
    arcoTables.forEach((t, i) => {
      const headerRow = t.querySelector('[class*="header"] tr, thead tr');
      if (headerRow) {
        const headers = Array.from(headerRow.querySelectorAll('th, [class*="th"], [class*="header-cell"]'))
          .map(h => h.textContent.trim());
        log(`ArcoTable #${i} headers:`, headers);
      } else {
        log(`ArcoTable #${i}: no header row found`);
      }
    });

    // Log any elements that look like table rows
    const allDivTables = document.querySelectorAll('[class*="table"], [class*="Table"]');
    log('Elements with "table" in class:', allDivTables.length);
    allDivTables.forEach((el, i) => {
      if (i < 5) log(`  [${i}] class="${el.className}", children=${el.children.length}`);
    });
  }

  // Try auto-report after page loads (with delays for dynamic content)
  // TikTok Ads loads data dynamically, so we try multiple times
  if (document.readyState === 'complete') {
    setTimeout(tryAutoReport, 3000);
    setTimeout(tryAutoReport, 8000);
    setTimeout(tryAutoReport, 15000);
  } else {
    window.addEventListener('load', () => {
      setTimeout(tryAutoReport, 3000);
      setTimeout(tryAutoReport, 8000);
      setTimeout(tryAutoReport, 15000);
    });
  }

  // Also try when URL changes (SPA navigation)
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      autoReportDone = false;
      setTimeout(tryAutoReport, 4000);
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

  // --- Data extraction functions ---

  function extractTableData() {
    const accountName = detectAccountName();
    const today = new Date().toLocaleDateString('ru-RU');

    // Strategy 1: Standard table
    const tableData = extractFromStandardTable(accountName, today);
    if (tableData.length > 0) return tableData;

    // Strategy 2: Arco Design table
    const arcoData = extractFromArcoTable(accountName, today);
    if (arcoData.length > 0) return arcoData;

    // Strategy 3: Generic table
    const genericData = extractFromGenericTable(accountName, today);
    if (genericData.length > 0) return genericData;

    // Strategy 4: Flex/Grid table
    const flexData = extractFromFlexTable(accountName, today);
    if (flexData.length > 0) return flexData;

    // Strategy 5: Brute-force — any table with at least a name and numeric columns
    log('All strategies failed, trying brute-force...');
    const bruteData = extractBruteForce(accountName, today);
    if (bruteData.length > 0) return bruteData;

    return [];
  }

  function detectAccountName() {
    const selectors = [
      '.advertiser-name',
      '[class*="advertiser"] [class*="name"]',
      '[class*="account-name"]',
      '[class*="AccountName"]',
      '.header-account-name',
      '[data-testid="account-name"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        return el.textContent.trim();
      }
    }

    const breadcrumb = document.querySelector('[class*="breadcrumb"]');
    if (breadcrumb) return breadcrumb.textContent.trim().split('/').pop().trim();

    return 'Unknown Account';
  }

  function extractFromStandardTable(accountName, today) {
    const results = [];
    const tables = document.querySelectorAll('table');
    log('Strategy 1 (Standard): found', tables.length, 'tables');

    for (const table of tables) {
      const headers = getTableHeaders(table);
      log('Strategy 1: table headers:', headers);
      if (!hasRelevantHeaders(headers)) continue;

      const headerMap = mapHeaders(headers);
      const rows = table.querySelectorAll('tbody tr');

      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) continue;

        const rowData = extractRowData(cells, headerMap, accountName, today);
        if (rowData && isValidRow(rowData)) {
          results.push(rowData);
        }
      }
    }

    return results;
  }

  function extractFromArcoTable(accountName, today) {
    const results = [];
    const arcoTables = document.querySelectorAll(
      '[class*="arco-table"], [class*="byted-table"], [class*="semi-table"]'
    );
    log('Strategy 2 (Arco): found', arcoTables.length, 'arco/byted tables');

    for (const tableWrapper of arcoTables) {
      const headerRow = tableWrapper.querySelector(
        '[class*="header"] tr, thead tr, [class*="thead"] [class*="tr"]'
      );
      if (!headerRow) continue;

      const headerCells = headerRow.querySelectorAll('th, [class*="th"], [class*="header-cell"]');
      const headers = Array.from(headerCells).map(h => h.textContent.trim().toLowerCase());

      if (!hasRelevantHeaders(headers)) continue;

      const headerMap = mapHeaders(headers);
      const bodyRows = tableWrapper.querySelectorAll(
        'tbody tr, [class*="tbody"] [class*="tr"], [class*="body"] [class*="row"]'
      );

      for (const row of bodyRows) {
        const cells = row.querySelectorAll('td, [class*="td"], [class*="cell"]');
        if (cells.length < 2) continue;

        const rowData = extractRowData(cells, headerMap, accountName, today);
        if (rowData && isValidRow(rowData)) {
          results.push(rowData);
        }
      }
    }

    return results;
  }

  function extractFromGenericTable(accountName, today) {
    const results = [];
    const wrappers = document.querySelectorAll(
      '[class*="campaign-table"], [class*="data-table"], [class*="report-table"], ' +
      '[class*="CampaignTable"], [class*="DataTable"], [class*="TableWrapper"]'
    );

    for (const wrapper of wrappers) {
      const rows = wrapper.querySelectorAll('[class*="row"], tr');

      let headerRow = null;
      for (const row of rows) {
        const text = row.textContent.toLowerCase();
        if (isHeaderRow(text)) {
          headerRow = row;
          break;
        }
      }

      if (!headerRow) continue;

      const headerCells = headerRow.querySelectorAll('th, td, [class*="cell"], [class*="col"]');
      const headers = Array.from(headerCells).map(h => h.textContent.trim().toLowerCase());
      const headerMap = mapHeaders(headers);

      let foundHeader = false;
      for (const row of rows) {
        if (row === headerRow) {
          foundHeader = true;
          continue;
        }
        if (!foundHeader) continue;

        const cells = row.querySelectorAll('td, [class*="cell"], [class*="col"]');
        if (cells.length < 2) continue;

        const rowData = extractRowData(cells, headerMap, accountName, today);
        if (rowData && isValidRow(rowData)) {
          results.push(rowData);
        }
      }
    }

    return results;
  }

  function extractFromFlexTable(accountName, today) {
    const results = [];
    const possibleHeaders = document.querySelectorAll('[class*="header"]');

    for (const header of possibleHeaders) {
      const text = header.textContent.toLowerCase();
      if (!isHeaderRow(text)) continue;

      const parent = header.parentElement;
      if (!parent) continue;

      const headerCells = header.querySelectorAll('[class*="cell"], [class*="col"], span, div');
      const headers = Array.from(headerCells)
        .map(h => h.textContent.trim().toLowerCase())
        .filter(h => h.length > 0 && h.length < 50);

      if (!hasRelevantHeaders(headers)) continue;

      const headerMap = mapHeaders(headers);
      const siblings = parent.children;
      let foundHeader = false;

      for (const sibling of siblings) {
        if (sibling === header) {
          foundHeader = true;
          continue;
        }
        if (!foundHeader) continue;

        const cells = sibling.querySelectorAll('[class*="cell"], [class*="col"], span, div');
        const filteredCells = Array.from(cells).filter(c =>
          c.children.length === 0 || c.querySelector('span, a')
        );
        if (filteredCells.length < 2) continue;

        const rowData = extractRowData(filteredCells, headerMap, accountName, today);
        if (rowData && isValidRow(rowData)) {
          results.push(rowData);
        }
      }
    }

    return results;
  }

  function extractBruteForce(accountName, today) {
    const results = [];
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      const allHeaders = getTableHeaders(table);
      log('Brute-force: table headers:', allHeaders);

      if (allHeaders.length < 2) continue;

      // Try to find ANY name-like column (first text column) and ANY numeric columns
      const rows = table.querySelectorAll('tbody tr');
      if (rows.length === 0) continue;

      // Map: first column = name, find columns with numbers
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) continue;

        const cellTexts = Array.from(cells).map(c => c.textContent.trim());

        // First non-empty text cell = campaign/ad name
        let nameIdx = -1;
        let spendIdx = -1;

        for (let i = 0; i < cellTexts.length; i++) {
          const t = cellTexts[i];
          if (nameIdx === -1 && t.length > 0 && !/^[\d.,\s$€₽%-]+$/.test(t)) {
            nameIdx = i;
          }
          if (spendIdx === -1 && nameIdx !== -1 && i !== nameIdx && /[\d.,]+/.test(t) && parseFloat(t.replace(/[^\d.,]/g, '').replace(',', '.')) > 0) {
            spendIdx = i;
          }
        }

        if (nameIdx >= 0 && spendIdx >= 0) {
          results.push({
            account: accountName,
            campaign: cellTexts[nameIdx],
            spend: cleanNumber(cellTexts[spendIdx]),
            cpc: '',
            cpl: '',
            date: today,
          });
        }
      }

      if (results.length > 0) {
        log('Brute-force found', results.length, 'rows from standard table');
        return results;
      }
    }

    return results;
  }

  // --- Helper functions ---

  function getTableHeaders(table) {
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr:first-child');
    if (!headerRow) return [];
    const cells = headerRow.querySelectorAll('th, td');
    return Array.from(cells).map(c => c.textContent.trim().toLowerCase());
  }

  function hasRelevantHeaders(headers) {
    const joined = headers.join(' ');
    const keywords = [
      'cost', 'spend', 'расход', 'затрат',
      'cpc', 'cpl', 'cpa',
      'campaign', 'кампани',
      'click', 'клик',
      'impression', 'показ',
      'result', 'результат',
      'budget', 'бюджет',
      // Creative page headers
      'ad name', 'ad group', 'creative', 'креатив',
      'total cost', 'conversion',
      'status', 'статус',
    ];
    let matches = 0;
    for (const kw of keywords) {
      if (joined.includes(kw)) matches++;
    }
    log('hasRelevantHeaders: joined="' + joined.substring(0, 200) + '", matches=' + matches);
    return matches >= 2;
  }

  function isHeaderRow(text) {
    const keywords = [
      'cost', 'spend', 'cpc', 'campaign', 'impression', 'click',
      'результат', 'расход', 'кампани',
      'ad name', 'creative', 'total cost', 'conversion', 'ad group',
      'креатив', 'status',
    ];
    let matches = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) matches++;
    }
    return matches >= 2;
  }

  function mapHeaders(headers) {
    const map = {
      campaign: -1,
      spend: -1,
      cpc: -1,
      cpl: -1,
    };

    headers.forEach((header, idx) => {
      const h = header.toLowerCase();

      // Campaign / Ad name / Creative name column
      if (h.includes('campaign') || h.includes('кампани') || h.includes('ad group') || h.includes('группа') ||
          h.includes('ad name') || h.includes('creative') || h.includes('креатив') ||
          h.includes('название')) {
        if (map.campaign === -1) map.campaign = idx;
      }

      // Spend / Cost column
      if (h.includes('cost') || h.includes('spend') || h.includes('расход') || h.includes('затрат') ||
          h.includes('total cost')) {
        if (map.spend === -1) map.spend = idx;
      }

      // CPC column
      if (h === 'cpc' || h.includes('cost per click') || h.includes('цена за клик')) {
        map.cpc = idx;
      }

      // CPL / CPA / Cost per result column
      if (h === 'cpl' || h === 'cpa' || h.includes('cost per result') ||
          h.includes('cost per lead') || h.includes('цена за результат') ||
          h.includes('цена за лид') || h.includes('cost per conversion') ||
          h.includes('cost per action')) {
        map.cpl = idx;
      }
    });

    log('mapHeaders result:', JSON.stringify(map), 'from headers:', headers.slice(0, 10));
    return map;
  }

  function extractRowData(cells, headerMap, accountName, today) {
    const cellTexts = Array.from(cells).map(c => c.textContent.trim());

    const data = {
      account: accountName,
      campaign: '',
      spend: '',
      cpc: '',
      cpl: '',
      date: today,
    };

    if (headerMap.campaign >= 0 && headerMap.campaign < cellTexts.length) {
      data.campaign = cellTexts[headerMap.campaign];
    } else if (cellTexts.length > 0) {
      data.campaign = cellTexts[0];
    }

    if (headerMap.spend >= 0 && headerMap.spend < cellTexts.length) {
      data.spend = cleanNumber(cellTexts[headerMap.spend]);
    }

    if (headerMap.cpc >= 0 && headerMap.cpc < cellTexts.length) {
      data.cpc = cleanNumber(cellTexts[headerMap.cpc]);
    }

    if (headerMap.cpl >= 0 && headerMap.cpl < cellTexts.length) {
      data.cpl = cleanNumber(cellTexts[headerMap.cpl]);
    }

    return data;
  }

  function cleanNumber(text) {
    if (!text || text === '-' || text === '--' || text === 'N/A') return '';
    return text
      .replace(/[$€£¥₽руб\.RUB\s]/gi, '')
      .replace(/,/g, '.')
      .trim();
  }

  function isValidRow(row) {
    return row.campaign && row.campaign.length > 0 &&
      (row.spend || row.cpc || row.cpl);
  }

  // --- Notification on TikTok Ads page ---
  function showNotification(message, type) {
    const existing = document.getElementById('ttstats-notification');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.id = 'ttstats-notification';
    div.className = `ttstats-notify ttstats-notify-${type}`;
    div.textContent = `TikTok Stats: ${message}`;
    document.body.appendChild(div);

    setTimeout(() => div.remove(), 4000);
  }
})();
