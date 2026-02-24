/**
 * Content script for TikTok Ads Manager (ads.tiktok.com)
 * Extracts campaign statistics from the dashboard table
 */

(function () {
  'use strict';

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extract_stats') {
      try {
        const data = extractTableData();
        sendResponse({ success: true, data: data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }
    return true; // Keep message channel open for async response
  });

  /**
   * Extract data from TikTok Ads Manager table.
   * TikTok Ads Manager uses a complex table structure.
   * We look for the main data table and parse each row.
   */
  function extractTableData() {
    const results = [];

    // Try to detect the current account name from the page header
    const accountName = detectAccountName();

    // Get today's date for the date column
    const today = new Date().toLocaleDateString('ru-RU');

    // Strategy 1: Look for the main campaign table (standard table structure)
    const tableData = extractFromStandardTable(accountName, today);
    if (tableData.length > 0) return tableData;

    // Strategy 2: Look for data in the new TikTok Ads Manager UI (arco-design based)
    const arcoData = extractFromArcoTable(accountName, today);
    if (arcoData.length > 0) return arcoData;

    // Strategy 3: Generic table extraction as fallback
    const genericData = extractFromGenericTable(accountName, today);
    if (genericData.length > 0) return genericData;

    // Strategy 4: Try to extract from any visible table-like structure
    const flexData = extractFromFlexTable(accountName, today);
    if (flexData.length > 0) return flexData;

    return results;
  }

  function detectAccountName() {
    // Try various selectors for account name
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

    // Try to get from the page title or breadcrumb
    const breadcrumb = document.querySelector('[class*="breadcrumb"]');
    if (breadcrumb) return breadcrumb.textContent.trim().split('/').pop().trim();

    return 'Unknown Account';
  }

  /**
   * Strategy 1: Standard HTML table
   */
  function extractFromStandardTable(accountName, today) {
    const results = [];
    const tables = document.querySelectorAll('table');

    for (const table of tables) {
      const headers = getTableHeaders(table);
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

  /**
   * Strategy 2: Arco Design table (used in newer TikTok Ads Manager)
   */
  function extractFromArcoTable(accountName, today) {
    const results = [];

    // Arco tables use .arco-table or similar class names
    const arcoTables = document.querySelectorAll(
      '[class*="arco-table"], [class*="byted-table"], [class*="semi-table"]'
    );

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

  /**
   * Strategy 3: Generic table extraction
   */
  function extractFromGenericTable(accountName, today) {
    const results = [];

    // Look for common TikTok Ads Manager table wrapper selectors
    const wrappers = document.querySelectorAll(
      '[class*="campaign-table"], [class*="data-table"], [class*="report-table"], ' +
      '[class*="CampaignTable"], [class*="DataTable"], [class*="TableWrapper"]'
    );

    for (const wrapper of wrappers) {
      const rows = wrapper.querySelectorAll('[class*="row"], tr');

      // Find header row
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

      // Get data rows (all rows after header)
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

  /**
   * Strategy 4: Flex/Grid layout table (div-based)
   */
  function extractFromFlexTable(accountName, today) {
    const results = [];

    // Sometimes TikTok uses div-based tables with flex/grid layout
    const possibleHeaders = document.querySelectorAll('[class*="header"]');

    for (const header of possibleHeaders) {
      const text = header.textContent.toLowerCase();
      if (!isHeaderRow(text)) continue;

      // Found a header-like element, look for sibling rows
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

  // Helper functions

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
    ];
    let matches = 0;
    for (const kw of keywords) {
      if (joined.includes(kw)) matches++;
    }
    return matches >= 2;
  }

  function isHeaderRow(text) {
    const keywords = ['cost', 'spend', 'cpc', 'campaign', 'impression', 'click', 'результат', 'расход', 'кампани'];
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

      // Campaign name
      if (h.includes('campaign') || h.includes('кампани') || h.includes('ad group') || h.includes('группа')) {
        if (map.campaign === -1) map.campaign = idx;
      }

      // Spend / Cost
      if (h.includes('cost') || h.includes('spend') || h.includes('расход') || h.includes('затрат') ||
          (h.includes('total') && h.includes('cost'))) {
        if (map.spend === -1) map.spend = idx;
      }

      // CPC
      if (h === 'cpc' || h.includes('cost per click') || h.includes('цена за клик')) {
        map.cpc = idx;
      }

      // CPL / CPA / Cost per result
      if (h === 'cpl' || h === 'cpa' || h.includes('cost per result') ||
          h.includes('cost per lead') || h.includes('цена за результат') ||
          h.includes('цена за лид') || h.includes('cost per conversion')) {
        map.cpl = idx;
      }
    });

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
      // First text column is usually the campaign name
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
    // Remove currency symbols and whitespace, normalize decimal separator
    return text
      .replace(/[$€£¥₽руб\.RUB\s]/gi, '')
      .replace(/,/g, '.')
      .trim();
  }

  function isValidRow(row) {
    // A row is valid if it has at least a campaign name and one metric
    return row.campaign && row.campaign.length > 0 &&
      (row.spend || row.cpc || row.cpl);
  }
})();
