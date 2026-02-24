const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data', 'stats.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize data file if needed
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ accounts: {}, lastUpdated: null }));
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve dashboard
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Read stored data from file
 */
function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { accounts: {}, lastUpdated: null };
  }
}

/**
 * Write data to file
 */
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/**
 * POST /api/stats
 * Receives stats from an extension instance.
 * Body: { accountName: string, campaigns: [...], date: string }
 */
app.post('/api/stats', (req, res) => {
  try {
    const { accountName, campaigns, date } = req.body;

    if (!accountName || !Array.isArray(campaigns)) {
      return res.status(400).json({ error: 'accountName и campaigns обязательны' });
    }

    const data = readData();

    // Initialize account if doesn't exist
    if (!data.accounts[accountName]) {
      data.accounts[accountName] = { entries: [] };
    }

    const today = date || new Date().toLocaleDateString('ru-RU');

    // Remove old entries for this account + date to avoid duplicates
    data.accounts[accountName].entries = data.accounts[accountName].entries.filter(
      e => e.date !== today
    );

    // Add new entries
    campaigns.forEach(c => {
      data.accounts[accountName].entries.push({
        campaign: c.campaign || '',
        spend: c.spend || '',
        cpc: c.cpc || '',
        cpl: c.cpl || '',
        date: today,
        collectedAt: new Date().toISOString(),
      });
    });

    data.lastUpdated = new Date().toISOString();
    writeData(data);

    console.log(`[${new Date().toLocaleTimeString()}] Получено ${campaigns.length} кампаний от "${accountName}"`);
    res.json({ success: true, count: campaigns.length });
  } catch (err) {
    console.error('Ошибка при сохранении:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stats
 * Returns all aggregated data.
 * Optional query params: ?days=7 (filter by last N days)
 */
app.get('/api/stats', (req, res) => {
  try {
    const data = readData();
    const days = parseInt(req.query.days);

    // Flatten all entries with account name
    let allEntries = [];
    for (const [accountName, accountData] of Object.entries(data.accounts)) {
      accountData.entries.forEach(entry => {
        allEntries.push({
          account: accountName,
          ...entry,
        });
      });
    }

    // Filter by days if requested
    if (days > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      allEntries = allEntries.filter(e => {
        const d = parseRuDate(e.date);
        return d && d >= cutoff;
      });
    }

    res.json({
      entries: allEntries,
      accountCount: Object.keys(data.accounts).length,
      lastUpdated: data.lastUpdated,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/stats
 * Clear all data
 */
app.delete('/api/stats', (req, res) => {
  writeData({ accounts: {}, lastUpdated: null });
  console.log('Все данные очищены');
  res.json({ success: true });
});

/**
 * DELETE /api/stats/:accountName
 * Remove a specific account's data
 */
app.delete('/api/stats/:accountName', (req, res) => {
  const data = readData();
  const name = decodeURIComponent(req.params.accountName);
  delete data.accounts[name];
  writeData(data);
  console.log(`Данные аккаунта "${name}" удалены`);
  res.json({ success: true });
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

function parseRuDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('.');
  if (parts.length === 3) {
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  }
  return new Date(dateStr);
}

app.listen(PORT, () => {
  console.log('');
  console.log('===========================================');
  console.log('  TikTok Stats Server запущен');
  console.log(`  Дашборд: http://localhost:${PORT}`);
  console.log(`  API:     http://localhost:${PORT}/api/stats`);
  console.log('===========================================');
  console.log('');
  console.log('Ожидание данных от расширений...');
});
