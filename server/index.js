require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const path    = require('path');
const { enrichRows } = require('./state-store');
const app     = express();

const USER_AGENT = process.env.SEC_USER_AGENT || 'TradeFlowTracker/3.0 your-email@example.com';
const HEADERS    = { 'User-Agent': USER_AGENT };

app.use(cors());

// ── CIK → Ticker cache ───────────────────────────────────────
let cikToTicker = {};
let cikToName   = {};

async function loadTickerMap() {
  try {
    const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: HEADERS });
    const data = await r.json();
    for (const entry of Object.values(data)) {
      const cik = String(entry.cik_str);
      cikToTicker[cik] = entry.ticker;
      cikToName[cik]   = entry.title;
    }
    console.log(`Loaded ${Object.keys(cikToTicker).length} CIK→ticker mappings`);
  } catch (e) {
    console.error('Failed to load ticker map:', e.message);
  }
}

// ── Parse Form 4 XML for transaction details ──────────────────
// Extract <value> directly inside a parent element, ignoring footnotes
function extractValue(block, parentTag) {
  const pattern = new RegExp(`<${parentTag}>\\s*<value>([^<]+)<`, 's');
  const m = block.match(pattern);
  return m ? m[1].trim() : null;
}

function parseTxBlock(block) {
  const code    = (block.match(/<transactionCode>([^<]+)</) || [])[1] || '';
  const shares  = parseFloat(extractValue(block, 'transactionShares')) || 0;
  const price   = parseFloat(extractValue(block, 'transactionPricePerShare')) || 0;
  const acqDisp = extractValue(block, 'transactionAcquiredDisposedCode') || '';
  return { code, shares, price, value: shares * price, acqDisp };
}

function parseForm4Xml(xml) {
  const transactions = [];
  const ticker = (xml.match(/<issuerTradingSymbol>([^<]+)</) || [])[1] || null;
  const issuer = (xml.match(/<issuerName>([^<]+)</) || [])[1] || null;

  // Non-derivative transactions (direct stock buys/sells/exercises)
  const ndPattern = /<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g;
  let match;
  while ((match = ndPattern.exec(xml)) !== null) {
    transactions.push(parseTxBlock(match[1]));
  }

  // Derivative transactions (options/warrants — often have exercise price)
  const dPattern = /<derivativeTransaction>([\s\S]*?)<\/derivativeTransaction>/g;
  while ((match = dPattern.exec(xml)) !== null) {
    const block = match[1];
    const tx = parseTxBlock(block);
    // Use exercise price if the per-share price is 0
    if (tx.price === 0) {
      const exPrice = parseFloat(extractValue(block, 'conversionOrExercisePrice')) || 0;
      if (exPrice > 0) {
        tx.price = exPrice;
        tx.value = tx.shares * exPrice;
      }
    }
    transactions.push(tx);
  }

  return { ticker, issuer, transactions };
}

// ── Price returns from Yahoo Finance ──────────────────────────
let priceCache = {};
const PRICE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function fetchReturns(ticker) {
  const now = Date.now();
  if (priceCache[ticker] && (now - priceCache[ticker].fetched) < PRICE_CACHE_TTL) {
    return priceCache[ticker].returns;
  }
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1mo&interval=1d`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const data = await r.json();
    const result = (data.chart && data.chart.result && data.chart.result[0]) || {};
    const closes = (result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close) || [];
    // Filter out nulls
    const valid = closes.filter(c => c != null);
    if (valid.length < 2) {
      priceCache[ticker] = { returns: null, fetched: now };
      return null;
    }
    const current = valid[valid.length - 1];
    const prev1d  = valid.length >= 2 ? valid[valid.length - 2] : null;
    const prev1w  = valid.length >= 6 ? valid[valid.length - 6] : null;
    const prev1m  = valid[0];

    const pct = (cur, prev) => prev && prev !== 0 ? Math.round(((cur - prev) / prev) * 10000) / 100 : null;

    const returns = {
      currentPrice: current,
      change1d: pct(current, prev1d),
      change1w: pct(current, prev1w),
      change1m: pct(current, prev1m)
    };
    priceCache[ticker] = { returns, fetched: now };
    return returns;
  } catch {
    priceCache[ticker] = { returns: null, fetched: now };
    return null;
  }
}

async function attachReturns(rows) {
  // Fetch in parallel, with a concurrency limit to avoid hammering Yahoo
  const BATCH_SIZE = 10;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(row => fetchReturns(row.ticker)));
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r) {
        batch[j].change1d = r.change1d;
        batch[j].change1w = r.change1w;
        batch[j].change1m = r.change1m;
        // Fill in missing price/value using current market price
        if (r.currentPrice > 0 && (!batch[j].pricePerShare || batch[j].pricePerShare === 0)) {
          batch[j].pricePerShare = Math.round(r.currentPrice * 100) / 100;
          if (batch[j].shares > 0) {
            batch[j].value = Math.round(batch[j].shares * r.currentPrice);
          }
        }
      }
    }
  }
  return rows;
}

// ── Form 4 — SEC EDGAR (enriched) ────────────────────────────
app.get('/api/form4', async (req, res) => {
  const days  = parseInt(req.query.days) || 30;

  try {
    // Step 1: Query EFTS in weekly chunks so we get coverage across the
    // full date range (EFTS returns newest-first, so a single 30-day
    // query only yields the most recent few days within 500 hits).
    const allHits = [];
    const CHUNK_DAYS = 7;
    const HITS_PER_CHUNK = 100; // 1 page per week keeps it fast
    const now = Date.now();

    for (let offset = 0; offset < days; offset += CHUNK_DAYS) {
      const chunkEnd   = new Date(now - offset * 864e5).toISOString().slice(0, 10);
      const chunkStart = new Date(now - Math.min(offset + CHUNK_DAYS, days) * 864e5).toISOString().slice(0, 10);
      const url = `https://efts.sec.gov/LATEST/search-index?forms=4` +
        `&dateRange=custom&startdt=${chunkStart}&enddt=${chunkEnd}&hits.hits._source=true&from=0`;
      const r = await fetch(url, { headers: HEADERS });
      const data = await r.json();
      const hits = (data.hits && data.hits.hits) || [];
      allHits.push(...hits.slice(0, HITS_PER_CHUNK));
    }

    // Step 2: Group filings by issuer CIK, resolve tickers
    const issuerMap = {};
    for (const h of allHits) {
      const src  = h._source || {};
      const ciks = src.ciks || [];
      const date = (src.file_date || '').slice(0, 10);
      const id   = h._id || '';
      // Issuer CIK is typically the last in the array
      const issuerCik = ciks.length > 0 ? ciks[ciks.length - 1].replace(/^0+/, '') : null;
      if (!issuerCik) continue;

      const ticker = cikToTicker[issuerCik] || null;
      if (!ticker) continue; // Skip non-public companies

      if (!issuerMap[ticker]) {
        issuerMap[ticker] = {
          ticker,
          company: cikToName[issuerCik] || ticker,
          cik: issuerCik,
          count: 0,
          filingIds: [],
          latestDate: null,
          earliestDate: null
        };
      }
      const entry = issuerMap[ticker];
      entry.count++;
      entry.filingIds.push(id);
      if (date) {
        if (!entry.latestDate || date > entry.latestDate)     entry.latestDate = date;
        if (!entry.earliestDate || date < entry.earliestDate) entry.earliestDate = date;
      }
    }

    // Step 3: Sort by filing count, take top 30
    const top = Object.values(issuerMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);

    // Step 4: Fetch one XML per ticker to get shares, price, and type
    const enriched = await Promise.all(top.map(async (entry) => {
      let type = 'Buy';
      let shares = 0;
      let pricePerShare = 0;
      let value = 0;
      try {
        const filingId = entry.filingIds[0];
        const [adsh, xmlFile] = filingId.split(':');
        const seq = adsh.replace(/-/g, '');
        const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${entry.cik}/${seq}/${xmlFile}`;
        const r = await fetch(xmlUrl, { headers: HEADERS });
        const xml = await r.text();
        const parsed = parseForm4Xml(xml);

        if (parsed.ticker) entry.ticker = parsed.ticker;
        if (parsed.issuer) entry.company = parsed.issuer;

        // Aggregate shares and determine buy/sell from all transactions
        let acquiredShares = 0, disposedShares = 0;
        let acquiredVal = 0, disposedVal = 0;
        const prices = [];
        for (const tx of parsed.transactions) {
          if (tx.acqDisp === 'A') {
            acquiredShares += tx.shares;
            acquiredVal += tx.value;
          } else if (tx.acqDisp === 'D') {
            disposedShares += tx.shares;
            disposedVal += tx.value;
          }
          if (tx.price > 0) prices.push(tx.price);
        }
        // Fall back to transaction code if acqDisp is missing
        if (acquiredShares === 0 && disposedShares === 0) {
          for (const tx of parsed.transactions) {
            if (tx.code === 'P' || tx.code === 'M' || tx.code === 'A') {
              acquiredShares += tx.shares;
              acquiredVal += tx.value;
            }
            if (tx.code === 'S' || tx.code === 'F') {
              disposedShares += tx.shares;
              disposedVal += tx.value;
            }
            if (tx.price > 0) prices.push(tx.price);
          }
        }
        type = disposedVal > acquiredVal ? 'Sell' : 'Buy';
        shares = type === 'Sell' ? disposedShares : acquiredShares;
        value = type === 'Sell' ? disposedVal : acquiredVal;
        // Weighted average price from this filing
        pricePerShare = shares > 0 ? value / shares : (prices.length > 0 ? prices[0] : 0);
      } catch {
        // keep defaults
      }

      return {
        ticker: entry.ticker,
        company: entry.company,
        type,
        count: entry.count,
        shares: Math.round(shares),
        pricePerShare: Math.round(pricePerShare * 100) / 100,
        value: Math.round(value),
        latestDate: entry.latestDate,
        earliestDate: entry.earliestDate,
        change1d: null,
        change1w: null,
        change1m: null
      };
    }));

    await attachReturns(enriched);
    res.json({ source: 'sec-edgar', data: enrichRows('form4', enriched) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ── Congress STOCK Act (House + Senate via Quiver Quantitative) ──
// Original S3 sources are dead. Quiver Quantitative provides both
// chambers with recent data, no API key required.
let congressCache = { data: null, fetched: 0 };

async function fetchCongressData() {
  const now = Date.now();
  // Cache for 30 minutes to avoid hammering the API
  if (congressCache.data && (now - congressCache.fetched) < 30 * 60 * 1000) {
    return congressCache.data;
  }
  const url = 'https://api.quiverquant.com/beta/live/congresstrading';
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    }
  });
  const data = await r.json();
  if (!Array.isArray(data)) {
    throw new Error('Unexpected response from Quiver API: ' + JSON.stringify(data).slice(0, 200));
  }
  congressCache = { data, fetched: now };
  return data;
}

// Parse amount range string like "$1,001 - $15,000" into midpoint
function parseAmountRange(str) {
  if (!str) return 0;
  const nums = (str + '').replace(/[^0-9]/g, ' ').trim().split(/\s+/).map(Number).filter(Boolean);
  if (!nums.length) return 0;
  if (nums.length === 1) return nums[0];
  return Math.round((nums[0] + nums[nums.length - 1]) / 2);
}

// Server-side aggregation of congressional transactions by ticker
function aggregateCongress(records) {
  const map = {};
  for (const r of records) {
    const ticker = (r.Ticker || '').trim().toUpperCase();
    if (!ticker || ticker === '--' || ticker.length > 5) continue;
    const txType  = (r.Transaction || '').toLowerCase();
    const type    = txType.includes('sale') || txType.includes('sell') ? 'Sale' : 'Purchase';
    const date    = r.TransactionDate || '';
    const val     = parseAmountRange(r.Range || '');
    const chamber = r.House === 'Senate' ? 'Senate' : 'House';

    if (!map[ticker]) {
      map[ticker] = {
        ticker, company: r.Description || ticker, type,
        count: 0, value: 0, latestDate: null, earliestDate: null,
        chambers: new Set(), change1d: null, change1w: null, change1m: null
      };
    }
    const entry = map[ticker];
    entry.count++;
    entry.value += val;
    entry.chambers.add(chamber);
    if (date) {
      if (!entry.latestDate   || date > entry.latestDate)   entry.latestDate = date;
      if (!entry.earliestDate || date < entry.earliestDate) entry.earliestDate = date;
    }
  }
  return Object.values(map)
    .map(r => ({ ...r, chamber: r.chambers.size > 1 ? 'Both' : [...r.chambers][0] || '—', chambers: undefined }))
    .sort((a, b) => b.count - a.count);
}

app.get('/api/congress', async (req, res) => {
  try {
    const all = await fetchCongressData();
    const chamberFilter = req.query.chamber; // optional: House, Senate, All
    const filtered = chamberFilter && chamberFilter !== 'All'
      ? all.filter(r => chamberFilter === 'House' ? r.House === 'Representatives' : r.House === 'Senate')
      : all;
    const aggregated = aggregateCongress(filtered).slice(0, 50);
    await attachReturns(aggregated);
    res.json({ data: enrichRows('congress', aggregated) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/house', async (req, res) => {
  try {
    const all = await fetchCongressData();
    const houseTx = all
      .filter(r => r.House === 'Representatives')
      .map(r => ({
        ticker: r.Ticker || '--',
        asset_description: r.Description || r.Ticker || '',
        type: r.Transaction || '',
        transaction_date: r.TransactionDate || '',
        disclosure_date: r.ReportDate || '',
        amount: r.Range || '',
        representative: r.Representative || '',
        party: r.Party || '',
        chamber: 'House'
      }));
    res.json({ data: houseTx });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/api/senate', async (req, res) => {
  try {
    const all = await fetchCongressData();
    const senateTx = all
      .filter(r => r.House === 'Senate')
      .map(r => ({
        ticker: r.Ticker || '--',
        asset_description: r.Description || r.Ticker || '',
        type: r.Transaction || '',
        transaction_date: r.TransactionDate || '',
        disclosure_date: r.ReportDate || '',
        amount: r.Range || '',
        senator: r.Representative || '',
        party: r.Party || '',
        transactions: [{
          ticker: r.Ticker || '--',
          asset_description: r.Description || r.Ticker || '',
          type: r.Transaction || '',
          transaction_date: r.TransactionDate || '',
          amount: r.Range || ''
        }]
      }));
    // Group by ticker to match expected format
    const grouped = {};
    for (const tx of senateTx) {
      const t = tx.ticker;
      if (!grouped[t]) grouped[t] = { ticker: t, transactions: [] };
      grouped[t].transactions.push(...tx.transactions);
    }
    res.json(Object.values(grouped));
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ── Serve React build ─────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../client/dist')));

// ── Catch-all: return React app for any non-API route ─────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// ── Background poller: refresh state periodically ────────────
const PORT = process.env.PORT || 3001;

async function pollInternal(path) {
  try {
    const r = await fetch(`http://localhost:${PORT}${path}`, { headers: HEADERS });
    await r.json();
    console.log(`[poller] ${path} refreshed`);
  } catch (e) {
    console.error(`[poller] ${path} failed:`, e.message);
  }
}

function startPoller() {
  // Poll every 60 minutes to keep state.json current
  const POLL_INTERVAL = 60 * 60 * 1000;
  setTimeout(() => pollInternal('/api/form4'), 30 * 1000);
  setTimeout(() => pollInternal('/api/congress'), 60 * 1000);
  setInterval(() => {
    pollInternal('/api/form4');
    pollInternal('/api/congress');
  }, POLL_INTERVAL);
}

// ── Start ─────────────────────────────────────────────────────
loadTickerMap().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startPoller();
  });
});
