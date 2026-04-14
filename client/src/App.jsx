import { useState, useEffect, useCallback } from "react";

// ── All fetch calls use relative URLs (/api/...) so this works identically
// ── on localhost AND through a Cloudflare Tunnel public URL — no hardcoding.

const UP   = "#1D9E75";
const DOWN = "#D85A30";
const NEUT = "#888780";

const pctColor = v => v > 0 ? UP : v < 0 ? DOWN : NEUT;
const fmt = (n, dec = 2) => n == null ? "—" : Number(n).toFixed(dec);
const fmtPct = v => (v == null ? "—" : (v > 0 ? "+" : "") + fmt(v, 2) + "%");
const fmtM = v => {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e9) return "$" + fmt(v / 1e9, 1) + "B";
  if (Math.abs(v) >= 1e6) return "$" + fmt(v / 1e6, 1) + "M";
  if (Math.abs(v) >= 1e3) return "$" + fmt(v / 1e3, 1) + "K";
  return "$" + fmt(v, 0);
};

const daysAgo = d => { const dt = new Date(); dt.setDate(dt.getDate() - d); return dt.toISOString().slice(0,10); };

function ageLabel(dateStr) {
  if (!dateStr) return "—";
  const diff = Math.round((Date.now() - new Date(dateStr)) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7)  return `${diff}d ago`;
  if (diff < 30) return `${Math.round(diff/7)}w ago`;
  return `${Math.round(diff/30)}mo ago`;
}

function ageDotColor(dateStr) {
  if (!dateStr) return NEUT;
  const diff = Math.round((Date.now() - new Date(dateStr)) / 864e5);
  if (diff <= 2)  return UP;
  if (diff <= 7)  return "#EF9F27";
  if (diff <= 21) return "#D85A30";
  return "#A32D2D";
}

function parseRange(str) {
  if (!str) return 0;
  const nums = str.replace(/[^0-9]/g, " ").trim().split(/\s+/).map(Number).filter(Boolean);
  if (!nums.length) return 0;
  if (nums.length === 1) return nums[0];
  return Math.round((nums[0] + nums[nums.length - 1]) / 2);
}

function aggregateCongress(transactions) {
  const map = {};
  for (const t of transactions) {
    const ticker = (t.ticker || "").trim().toUpperCase();
    if (!ticker || ticker === "--" || ticker.length > 5) continue;
    const txType = (t.type || t.transaction_type || "").toLowerCase();
    const type   = txType.includes("sale") || txType.includes("sell") ? "Sale" : "Purchase";
    const date   = (t.transaction_date || t.disclosure_date || "").slice(0, 10);
    const val    = parseRange(t.amount || "");
    const chamber = t.chamber || "House";
    if (!map[ticker]) {
      map[ticker] = { ticker, company: t.asset_description || ticker,
        type, count:0, value:0, latestDate:null, earliestDate:null,
        chambers: new Set(), change1d:null, change1w:null, change1m:null };
    }
    const r = map[ticker];
    r.count++; r.value += val; r.chambers.add(chamber);
    if (date) {
      if (!r.latestDate   || date > r.latestDate)   r.latestDate   = date;
      if (!r.earliestDate || date < r.earliestDate) r.earliestDate = date;
    }
  }
  return Object.values(map)
    .map(r => ({ ...r, chamber: r.chambers.size > 1 ? "Both" : [...r.chambers][0] || "—" }))
    .sort((a, b) => b.count - a.count).slice(0, 20);
}

// ── seed data ────────────────────────────────────────────────────────────────
const SEED_FORM4 = [
  { ticker:"NVDA", company:"NVIDIA Corp",    type:"Buy",  count:14, shares:25000,  pricePerShare:153.60, value:3840000, change1d:2.41,  change1w:5.12,  change1m:18.3,  latestDate:daysAgo(1),  earliestDate:daysAgo(3)  },
  { ticker:"MSFT", company:"Microsoft Corp", type:"Buy",  count:11, shares:5200,   pricePerShare:403.85, value:2100000, change1d:0.88,  change1w:2.34,  change1m:6.7,   latestDate:daysAgo(2),  earliestDate:daysAgo(7)  },
  { ticker:"AMZN", company:"Amazon.com Inc", type:"Buy",  count:9,  shares:8100,   pricePerShare:190.12, value:1540000, change1d:1.22,  change1w:3.87,  change1m:9.1,   latestDate:daysAgo(0),  earliestDate:daysAgo(5)  },
  { ticker:"META", company:"Meta Platforms", type:"Sell", count:8,  shares:1800,   pricePerShare:544.44, value:980000,  change1d:-0.54, change1w:-1.23, change1m:-3.4,  latestDate:daysAgo(4),  earliestDate:daysAgo(12) },
  { ticker:"TSLA", company:"Tesla Inc",      type:"Sell", count:12, shares:7200,   pricePerShare:244.44, value:1760000, change1d:-1.87, change1w:-4.55, change1m:-11.2, latestDate:daysAgo(1),  earliestDate:daysAgo(9)  },
  { ticker:"GOOGL", company:"Alphabet Inc",  type:"Buy",  count:7,  shares:5100,   pricePerShare:170.59, value:870000,  change1d:0.34,  change1w:1.67,  change1m:4.8,   latestDate:daysAgo(3),  earliestDate:daysAgo(14) },
  { ticker:"AAPL", company:"Apple Inc",      type:"Buy",  count:6,  shares:3100,   pricePerShare:209.68, value:650000,  change1d:0.12,  change1w:0.88,  change1m:2.3,   latestDate:daysAgo(6),  earliestDate:daysAgo(18) },
  { ticker:"JPM",  company:"JPMorgan Chase", type:"Buy",  count:5,  shares:2000,   pricePerShare:215.00, value:430000,  change1d:0.67,  change1w:1.44,  change1m:5.6,   latestDate:daysAgo(8),  earliestDate:daysAgo(22) },
  { ticker:"AMD",  company:"Advanced Micro", type:"Buy",  count:10, shares:10500,  pricePerShare:117.14, value:1230000, change1d:3.12,  change1w:7.44,  change1m:22.1,  latestDate:daysAgo(0),  earliestDate:daysAgo(4)  },
  { ticker:"INTC", company:"Intel Corp",     type:"Sell", count:9,  shares:24000,  pricePerShare:22.50,  value:540000,  change1d:-2.34, change1w:-5.67, change1m:-14.8, latestDate:daysAgo(11), earliestDate:daysAgo(28) },
  { ticker:"CRM",  company:"Salesforce Inc", type:"Buy",  count:4,  shares:1100,   pricePerShare:281.82, value:310000,  change1d:0.55,  change1w:2.11,  change1m:7.3,   latestDate:daysAgo(5),  earliestDate:daysAgo(16) },
  { ticker:"NFLX", company:"Netflix Inc",    type:"Sell", count:3,  shares:320,    pricePerShare:906.25, value:290000,  change1d:-0.88, change1w:-2.44, change1m:-6.7,  latestDate:daysAgo(19), earliestDate:daysAgo(35) },
];

const SEED_CONGRESS = [
  { ticker:"NVDA", company:"NVIDIA Corp",    chamber:"House",  type:"Purchase", count:23, value:4200000, change1d:2.41,  change1w:5.12,  change1m:18.3,  latestDate:daysAgo(3),  earliestDate:daysAgo(38) },
  { ticker:"MSFT", company:"Microsoft Corp", chamber:"Senate", type:"Purchase", count:18, value:3100000, change1d:0.88,  change1w:2.34,  change1m:6.7,   latestDate:daysAgo(7),  earliestDate:daysAgo(42) },
  { ticker:"AAPL", company:"Apple Inc",      chamber:"Both",   type:"Purchase", count:16, value:2900000, change1d:0.12,  change1w:0.88,  change1m:2.3,   latestDate:daysAgo(2),  earliestDate:daysAgo(29) },
  { ticker:"AMZN", company:"Amazon.com Inc", chamber:"House",  type:"Sale",     count:14, value:2200000, change1d:1.22,  change1w:3.87,  change1m:9.1,   latestDate:daysAgo(12), earliestDate:daysAgo(44) },
  { ticker:"TSLA", company:"Tesla Inc",      chamber:"House",  type:"Purchase", count:11, value:1800000, change1d:-1.87, change1w:-4.55, change1m:-11.2, latestDate:daysAgo(5),  earliestDate:daysAgo(40) },
  { ticker:"LMT",  company:"Lockheed Martin",chamber:"Both",   type:"Purchase", count:19, value:5400000, change1d:1.34,  change1w:3.22,  change1m:8.9,   latestDate:daysAgo(1),  earliestDate:daysAgo(33) },
  { ticker:"RTX",  company:"RTX Corp",       chamber:"Senate", type:"Purchase", count:15, value:3800000, change1d:0.77,  change1w:2.11,  change1m:5.4,   latestDate:daysAgo(9),  earliestDate:daysAgo(45) },
  { ticker:"GS",   company:"Goldman Sachs",  chamber:"House",  type:"Sale",     count:8,  value:1900000, change1d:-0.34, change1w:-1.22, change1m:-2.8,  latestDate:daysAgo(18), earliestDate:daysAgo(44) },
  { ticker:"UNH",  company:"UnitedHealth",   chamber:"Senate", type:"Purchase", count:12, value:2700000, change1d:0.91,  change1w:2.67,  change1m:7.1,   latestDate:daysAgo(4),  earliestDate:daysAgo(37) },
  { ticker:"XOM",  company:"ExxonMobil",     chamber:"Both",   type:"Purchase", count:17, value:4100000, change1d:1.55,  change1w:3.88,  change1m:10.2,  latestDate:daysAgo(6),  earliestDate:daysAgo(41) },
  { ticker:"PFE",  company:"Pfizer Inc",     chamber:"House",  type:"Sale",     count:9,  value:1100000, change1d:-1.22, change1w:-3.44, change1m:-8.6,  latestDate:daysAgo(22), earliestDate:daysAgo(45) },
  { ticker:"CVX",  company:"Chevron Corp",   chamber:"Senate", type:"Purchase", count:13, value:3300000, change1d:1.11,  change1w:2.99,  change1m:7.8,   latestDate:daysAgo(8),  earliestDate:daysAgo(43) },
];

function MiniBar({ val, max }) {
  const w = Math.min(100, Math.abs((val ?? 0) / max) * 100);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
      <div style={{ flex:1, height:4, background:"var(--color-border-tertiary)", borderRadius:2, overflow:"hidden" }}>
        <div style={{ width:`${w}%`, height:"100%", background:(val??0)>=0?UP:DOWN, borderRadius:2 }} />
      </div>
      <span style={{ fontSize:12, minWidth:52, textAlign:"right", color:pctColor(val??0) }}>{fmtPct(val)}</span>
    </div>
  );
}

function ChamberBadge({ chamber }) {
  const bg    = chamber==="Both"?"#EAF3DE":chamber==="Senate"?"#E6F1FB":"#EEEDFE";
  const color = chamber==="Both"?"#3B6D11":chamber==="Senate"?"#185FA5":"#534AB7";
  return <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4, background:bg, color, whiteSpace:"nowrap" }}>{chamber||"—"}</span>;
}

function FreshnessCell({ latestDate, earliestDate }) {
  const dot  = ageDotColor(latestDate);
  const same = latestDate === earliestDate;
  return (
    <td style={{ padding:"10px 12px", whiteSpace:"nowrap" }}>
      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
        <span style={{ width:7, height:7, borderRadius:"50%", background:dot, flexShrink:0, display:"inline-block" }} />
        <div>
          <div style={{ fontSize:12, fontWeight:500, color:"var(--color-text-primary)" }}>{ageLabel(latestDate)}</div>
          {!same && <div style={{ fontSize:11, color:"var(--color-text-secondary)" }}>first: {ageLabel(earliestDate)}</div>}
        </div>
      </div>
    </td>
  );
}

function compareField(a, b, key, dir) {
  let av = a[key], bv = b[key];
  // Treat null, undefined, NaN as sortable bottom values
  const aNull = av == null || (typeof av === "number" && isNaN(av));
  const bNull = bv == null || (typeof bv === "number" && isNaN(bv));
  if (aNull && bNull) return 0;
  if (aNull) return 1;  // nulls always sort to bottom
  if (bNull) return -1;
  if (typeof av === "string" || typeof bv === "string") {
    return dir==="asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  }
  return dir==="asc" ? av - bv : bv - av;
}

function multiSort(data, sorts) {
  if (!sorts.length) return data;
  return [...data].sort((a, b) => {
    for (const { col, dir } of sorts) {
      const cmp = compareField(a, b, col, dir);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

function handleSortClick(setSorts, col, shiftKey) {
  setSorts(prev => {
    const idx = prev.findIndex(s => s.col === col);
    if (shiftKey) {
      // Shift+click: add or toggle within multi-sort
      if (idx >= 0) {
        return prev.map((s, i) => i === idx ? { ...s, dir: s.dir === "desc" ? "asc" : "desc" } : s);
      }
      return [...prev, { col, dir: "desc" }];
    }
    // Regular click: if already sole sort, toggle; otherwise set as sole sort
    if (prev.length === 1 && idx === 0) {
      return [{ col, dir: prev[0].dir === "desc" ? "asc" : "desc" }];
    }
    return [{ col, dir: "desc" }];
  });
}

function Th({ label, col, sorts, setSorts, align="right" }) {
  const idx    = sorts.findIndex(s => s.col === col);
  const active = idx >= 0;
  const entry  = active ? sorts[idx] : null;
  const multi  = sorts.length > 1;
  return (
    <th onClick={(e) => handleSortClick(setSorts, col, e.shiftKey)}
      style={{ padding:"10px 12px", fontSize:11, fontWeight:500,
        color:active?"var(--color-text-primary)":"var(--color-text-secondary)",
        textAlign:align, cursor:"pointer", whiteSpace:"nowrap", userSelect:"none",
        borderBottom:"0.5px solid var(--color-border-tertiary)", background:"var(--color-background-secondary)" }}>
      {label}
      {active && (entry.dir==="desc"?" \u2193":" \u2191")}
      {active && multi && <span style={{ fontSize:9, opacity:0.6, marginLeft:2 }}>{idx+1}</span>}
    </th>
  );
}

function SortChips({ sorts, setSorts }) {
  if (sorts.length <= 1) return null;
  return (
    <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
      <span style={{ fontSize:11, color:"var(--color-text-secondary)" }}>Sort:</span>
      {sorts.map((s, i) => (
        <span key={s.col} style={{ fontSize:11, padding:"2px 8px", borderRadius:4,
          background:"var(--color-background-secondary)", border:"0.5px solid var(--color-border-tertiary)",
          color:"var(--color-text-primary)", display:"inline-flex", alignItems:"center", gap:4 }}>
          {s.col}{s.dir==="desc"?" \u2193":" \u2191"}
          <span onClick={(e) => { e.stopPropagation(); setSorts(prev => prev.filter((_, j) => j !== i)); }}
            style={{ cursor:"pointer", opacity:0.5, fontSize:10, marginLeft:2 }}>\u2715</span>
        </span>
      ))}
      <span onClick={() => setSorts([sorts[0]])}
        style={{ fontSize:11, color:"var(--color-text-secondary)", cursor:"pointer", textDecoration:"underline" }}>
        clear
      </span>
    </div>
  );
}

function fmtShares(n) {
  if (n == null || n === 0) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

function fmtPrice(n) {
  if (n == null || n === 0) return "—";
  return "$" + n.toFixed(2);
}

// Compact delta formatter: (+3), (-$72), (+1.2K)
function fmtDeltaNum(n) {
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  const abs = Math.abs(n);
  let out;
  if (abs >= 1e6) out = (n / 1e6).toFixed(1) + "M";
  else if (abs >= 1e3) out = (n / 1e3).toFixed(1) + "K";
  else out = Math.round(n).toString();
  return `(${sign}${out})`;
}
function fmtDeltaMoney(n) {
  const sign = n > 0 ? "+$" : n < 0 ? "-$" : "$";
  const abs = Math.abs(n);
  let out;
  if (abs >= 1e6) out = (abs / 1e6).toFixed(1) + "M";
  else if (abs >= 1e3) out = (abs / 1e3).toFixed(1) + "K";
  else out = Math.round(abs).toString();
  return `(${sign}${out})`;
}
function fmtDeltaPrice(n) {
  const sign = n > 0 ? "+$" : n < 0 ? "-$" : "$";
  return `(${sign}${Math.abs(n).toFixed(2)})`;
}

function Delta({ value, active, kind = "num" }) {
  if (!active || value === 0 || value == null) return null;
  const color = value > 0 ? UP : DOWN;
  const text = kind === "money" ? fmtDeltaMoney(value)
            : kind === "price" ? fmtDeltaPrice(value)
            : fmtDeltaNum(value);
  return <span style={{ fontSize: 10, color, marginLeft: 4, whiteSpace: "nowrap" }}>{text}</span>;
}

function FlagBadge({ kind }) {
  const styles = {
    NEW:    { bg: "#FFF4DB", color: "#8C6B00" },
    RISING: { bg: "#E0EEFF", color: "#1C4FB2" }
  };
  const s = styles[kind] || styles.NEW;
  return (
    <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 600,
      background: s.bg, color: s.color, marginLeft: 4, letterSpacing: 0.5, verticalAlign: "middle" }}>
      {kind}
    </span>
  );
}

function Form4Table({ data, filter, sorts, setSorts, search }) {
  const filtered = data.filter(r =>
    (filter==="All"||r.type===filter) &&
    (!search || r.ticker.toLowerCase().includes(search) || (r.company||"").toLowerCase().includes(search))
  );
  const sorted   = multiSort(filtered, sorts);
  const maxCount  = Math.max(...filtered.map(r=>r.count),1);
  const maxShares = Math.max(...filtered.map(r=>r.shares||0),1);
  return (
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
        <thead><tr>
          <Th label="Ticker"        col="ticker"        sorts={sorts} setSorts={setSorts} align="left" />
          <Th label="Action"        col="type"          sorts={sorts} setSorts={setSorts} align="left" />
          <Th label="Insiders"      col="count"         sorts={sorts} setSorts={setSorts} />
          <Th label="Shares"        col="shares"        sorts={sorts} setSorts={setSorts} />
          <Th label="Price"         col="pricePerShare"  sorts={sorts} setSorts={setSorts} />
          <Th label="Value"         col="value"         sorts={sorts} setSorts={setSorts} />
          <Th label="Latest filing" col="latestDate"    sorts={sorts} setSorts={setSorts} align="left" />
          <Th label="1d"            col="change1d"      sorts={sorts} setSorts={setSorts} />
          <Th label="1w"            col="change1w"      sorts={sorts} setSorts={setSorts} />
          <Th label="1m"            col="change1m"      sorts={sorts} setSorts={setSorts} />
        </tr></thead>
        <tbody>
          {sorted.map((r,i) => (
            <tr key={r.ticker} style={{ background:i%2===0?"transparent":"var(--color-background-secondary)" }}>
              <td style={{ padding:"10px 12px", fontWeight:500 }}>
                <div>
                  {r.ticker}
                  {r.isNew && <FlagBadge kind="NEW" />}
                  {r.isRising && <FlagBadge kind="RISING" />}
                </div>
                <div style={{ fontSize:11, color:"var(--color-text-secondary)", fontWeight:400 }}>{r.company}</div>
              </td>
              <td style={{ padding:"10px 12px" }}>
                <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4,
                  background:r.type==="Buy"?"#E1F5EE":"#FAECE7", color:r.type==="Buy"?"#0F6E56":"#993C1D" }}>{r.type}</span>
              </td>
              <td style={{ padding:"10px 12px", textAlign:"right" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ flex:1, height:4, background:"var(--color-border-tertiary)", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ width:`${Math.round((r.count/maxCount)*100)}%`, height:"100%", background:r.type==="Buy"?UP:DOWN, borderRadius:2 }} />
                  </div>
                  <span style={{ minWidth:20, fontWeight:500 }}>
                    {r.count}<Delta value={r.deltas?.count?.value} active={r.deltas?.count?.active} />
                  </span>
                </div>
              </td>
              <td style={{ padding:"10px 12px", textAlign:"right" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ flex:1, height:4, background:"var(--color-border-tertiary)", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ width:`${Math.round(((r.shares||0)/maxShares)*100)}%`, height:"100%", background:r.type==="Buy"?UP:DOWN, borderRadius:2 }} />
                  </div>
                  <span style={{ minWidth:50 }}>
                    {fmtShares(r.shares)}<Delta value={r.deltas?.shares?.value} active={r.deltas?.shares?.active} />
                  </span>
                </div>
              </td>
              <td style={{ padding:"10px 12px", textAlign:"right", whiteSpace:"nowrap" }}>
                {fmtPrice(r.pricePerShare)}<Delta value={r.deltas?.price?.value} active={r.deltas?.price?.active} kind="price" />
              </td>
              <td style={{ padding:"10px 12px", textAlign:"right", whiteSpace:"nowrap" }}>
                {fmtM(r.value)}<Delta value={r.deltas?.value?.value} active={r.deltas?.value?.active} kind="money" />
              </td>
              <FreshnessCell latestDate={r.latestDate} earliestDate={r.earliestDate} />
              <td style={{ padding:"10px 12px" }}><MiniBar val={r.change1d} max={5} /></td>
              <td style={{ padding:"10px 12px" }}><MiniBar val={r.change1w} max={10} /></td>
              <td style={{ padding:"10px 12px" }}><MiniBar val={r.change1m} max={25} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CongressTable({ data, filter, chamberFilter, sorts, setSorts, search }) {
  const filtered = data.filter(r =>
    (filter==="All"||r.type===filter) &&
    (chamberFilter==="All"||r.chamber===chamberFilter||r.chamber==="Both") &&
    (!search || r.ticker.toLowerCase().includes(search) || (r.company||"").toLowerCase().includes(search))
  );
  const sorted   = multiSort(filtered, sorts);
  const maxCount = Math.max(...filtered.map(r=>r.count),1);
  const maxVal   = Math.max(...filtered.map(r=>r.value),1);
  return (
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
        <thead><tr>
          <Th label="Ticker"        col="ticker"     sorts={sorts} setSorts={setSorts} align="left" />
          <Th label="Action"        col="type"       sorts={sorts} setSorts={setSorts} align="left" />
          <Th label="Chamber"       col="chamber"    sorts={sorts} setSorts={setSorts} align="left" />
          <Th label="Members"       col="count"      sorts={sorts} setSorts={setSorts} />
          <Th label="Est. value"    col="value"      sorts={sorts} setSorts={setSorts} />
          <Th label="Latest filing" col="latestDate" sorts={sorts} setSorts={setSorts} align="left" />
          <Th label="1d"            col="change1d"   sorts={sorts} setSorts={setSorts} />
          <Th label="1w"            col="change1w"   sorts={sorts} setSorts={setSorts} />
          <Th label="1m"            col="change1m"   sorts={sorts} setSorts={setSorts} />
        </tr></thead>
        <tbody>
          {sorted.map((r,i) => (
            <tr key={r.ticker} style={{ background:i%2===0?"transparent":"var(--color-background-secondary)" }}>
              <td style={{ padding:"10px 12px", fontWeight:500 }}>
                <div>
                  {r.ticker}
                  {r.isNew && <FlagBadge kind="NEW" />}
                  {r.isRising && <FlagBadge kind="RISING" />}
                </div>
                <div style={{ fontSize:11, color:"var(--color-text-secondary)", fontWeight:400 }}>{r.company}</div>
              </td>
              <td style={{ padding:"10px 12px" }}>
                <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4,
                  background:r.type==="Purchase"?"#E1F5EE":"#FAECE7", color:r.type==="Purchase"?"#0F6E56":"#993C1D" }}>{r.type}</span>
              </td>
              <td style={{ padding:"10px 12px" }}><ChamberBadge chamber={r.chamber} /></td>
              <td style={{ padding:"10px 12px", textAlign:"right" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ flex:1, height:4, background:"var(--color-border-tertiary)", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ width:`${Math.round((r.count/maxCount)*100)}%`, height:"100%", background:r.type==="Purchase"?UP:DOWN, borderRadius:2 }} />
                  </div>
                  <span style={{ minWidth:20, fontWeight:500 }}>
                    {r.count}<Delta value={r.deltas?.count?.value} active={r.deltas?.count?.active} />
                  </span>
                </div>
              </td>
              <td style={{ padding:"10px 12px", textAlign:"right" }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ flex:1, height:4, background:"var(--color-border-tertiary)", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ width:`${Math.round((r.value/maxVal)*100)}%`, height:"100%", background:"#378ADD", borderRadius:2 }} />
                  </div>
                  <span style={{ minWidth:50 }}>
                    {fmtM(r.value)}<Delta value={r.deltas?.value?.value} active={r.deltas?.value?.active} kind="money" />
                  </span>
                </div>
              </td>
              <FreshnessCell latestDate={r.latestDate} earliestDate={r.earliestDate} />
              <td style={{ padding:"10px 12px" }}><MiniBar val={r.change1d} max={5} /></td>
              <td style={{ padding:"10px 12px" }}><MiniBar val={r.change1w} max={10} /></td>
              <td style={{ padding:"10px 12px" }}><MiniBar val={r.change1m} max={25} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatCard({ label, value, sub, subColor }) {
  return (
    <div style={{ background:"var(--color-background-secondary)", borderRadius:8, padding:"12px 16px" }}>
      <div style={{ fontSize:11, color:"var(--color-text-secondary)", marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:500 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:subColor||"var(--color-text-secondary)", marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function StatusBadge({ live }) {
  return (
    <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4,
      background:live?"#E1F5EE":"#FAEEDA", color:live?"#0F6E56":"#854F0B" }}>
      {live?"Live data":"Seed data — server not reachable"}
    </span>
  );
}

function FilterBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{ fontSize:12, padding:"4px 12px", borderRadius:6, cursor:"pointer",
      border:active?"0.5px solid var(--color-border-primary)":"0.5px solid var(--color-border-tertiary)",
      background:active?"var(--color-background-primary)":"transparent",
      color:active?"var(--color-text-primary)":"var(--color-text-secondary)" }}>{label}</button>
  );
}

export default function App() {
  const [tab,       setTab]       = useState("form4");
  const [f4Data,    setF4Data]    = useState(SEED_FORM4);
  const [f4Live,    setF4Live]    = useState(false);
  const [f4Filter,  setF4Filter]  = useState("All");
  const [f4Sort,    setF4Sort]    = useState([{ col:"count", dir:"desc" }]);
  const [f4Loading, setF4Loading] = useState(false);
  const [cgData,    setCgData]    = useState(SEED_CONGRESS);
  const [cgLive,    setCgLive]    = useState(false);
  const [cgFilter,  setCgFilter]  = useState("All");
  const [cgChamber, setCgChamber] = useState("All");
  const [cgSort,    setCgSort]    = useState([{ col:"count", dir:"desc" }]);
  const [cgLoading, setCgLoading] = useState(false);
  const [search,    setSearch]    = useState("");

  // Relative URLs — work on localhost AND through Cloudflare Tunnel
  const fetchForm4 = useCallback(async () => {
    setF4Loading(true);
    try {
      const res  = await fetch("/api/form4");
      if (!res.ok) throw new Error();
      const json = await res.json();
      const rows = json?.data || [];
      if (rows.length) {
        setF4Data(rows);
        setF4Live(true);
      }
    } catch { /* keep seed */ }
    finally { setF4Loading(false); }
  }, []);

  const fetchCongress = useCallback(async () => {
    setCgLoading(true);
    try {
      const res  = await fetch("/api/congress");
      if (!res.ok) throw new Error();
      const json = await res.json();
      const rows = json?.data || [];
      if (rows.length) { setCgData(rows); setCgLive(true); }
    } catch { /* keep seed */ }
    finally { setCgLoading(false); }
  }, []);

  useEffect(() => { fetchForm4(); fetchCongress(); }, []);

  const f4Buys  = f4Data.filter(r=>r.type==="Buy").length;
  const f4Sells = f4Data.filter(r=>r.type==="Sell").length;
  const f4TotalShares = f4Data.reduce((s,r)=>s+(r.shares||0),0);
  const f4TotalValue  = f4Data.reduce((s,r)=>s+(r.value||0),0);
  const f4Top   = [...f4Data].sort((a,b)=>(b.shares||0)-(a.shares||0))[0];
  const cgBuys  = cgData.filter(r=>r.type==="Purchase").length;
  const cgSells = cgData.filter(r=>r.type==="Sale").length;
  const cgTotal = cgData.reduce((s,r)=>s+r.value,0);
  const cgTop   = [...cgData].sort((a,b)=>b.count-a.count)[0];

  const TAB = {
    base:    { padding:"8px 16px", fontSize:13, fontWeight:500, cursor:"pointer", border:"none", background:"none", borderRadius:"var(--border-radius-md)", transition:"all .15s" },
    active:  { background:"var(--color-background-primary)", border:"0.5px solid var(--color-border-tertiary)", color:"var(--color-text-primary)" },
    inactive:{ color:"var(--color-text-secondary)" },
  };
  const LEGEND = [[UP,"≤2d"],["#EF9F27","≤1w"],["#D85A30","≤3w"],["#A32D2D","Older"]];

  return (
    <div style={{ padding:"0 0 2rem" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:500 }}>Trade flow tracker</h2>
          <p style={{ margin:"4px 0 0", fontSize:13, color:"var(--color-text-secondary)" }}>
            Insider &amp; congressional trades — 100% free, zero API keys required
          </p>
        </div>
        <button onClick={() => { fetchForm4(); fetchCongress(); }}
          style={{ fontSize:12, padding:"6px 14px", cursor:"pointer", borderRadius:6,
            border:"0.5px solid var(--color-border-secondary)", background:"var(--color-background-secondary)", color:"var(--color-text-primary)" }}>
          Refresh
        </button>
      </div>

      <div style={{ display:"flex", gap:4, marginBottom:20, background:"var(--color-background-secondary)",
        padding:4, borderRadius:"var(--border-radius-md)", width:"fit-content" }}>
        {[["form4","Form 4 — insiders"],["congress","Congress — STOCK Act"]].map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ ...TAB.base, ...(tab===id?TAB.active:TAB.inactive) }}>{label}</button>
        ))}
      </div>

      {tab==="form4" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, flexWrap:"wrap", gap:8 }}>
            <StatusBadge live={f4Live} />
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <input type="text" placeholder="Search ticker or company…" value={search}
                onChange={e => setSearch(e.target.value.toLowerCase())}
                style={{ fontSize:12, padding:"4px 10px", borderRadius:6, border:"0.5px solid var(--color-border-tertiary)",
                  background:"var(--color-background-secondary)", color:"var(--color-text-primary)", width:180, outline:"none" }} />
              {["All","Buy","Sell"].map(f=><FilterBtn key={f} label={f} active={f4Filter===f} onClick={()=>setF4Filter(f)} />)}
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:12, marginBottom:20 }}>
            <StatCard label="Unique tickers"   value={f4Data.length} />
            <StatCard label="Buy signals"      value={f4Buys}  subColor={UP}   sub="tracked stocks" />
            <StatCard label="Sell signals"     value={f4Sells} subColor={DOWN} sub="tracked stocks" />
            <StatCard label="Total shares"     value={fmtShares(f4TotalShares)} sub={fmtM(f4TotalValue) + " value"} />
            <StatCard label="Most shares"      value={fmtShares(f4Top?.shares)} sub={f4Top?.ticker} />
          </div>
          <SortChips sorts={f4Sort} setSorts={setF4Sort} />
          <div style={{ border:"0.5px solid var(--color-border-tertiary)", borderRadius:"var(--border-radius-lg)", overflow:"hidden", marginTop: f4Sort.length > 1 ? 8 : 0 }}>
            {f4Loading
              ? <div style={{ padding:40, textAlign:"center", color:"var(--color-text-secondary)", fontSize:13 }}>Fetching SEC EDGAR Form 4 filings…</div>
              : <Form4Table data={f4Data} filter={f4Filter} sorts={f4Sort} setSorts={setF4Sort} search={search} />}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:16, marginTop:10, flexWrap:"wrap" }}>
            <p style={{ fontSize:11, color:"var(--color-text-secondary)", margin:0 }}>
              Source: SEC EDGAR · Free · No key · 2-day reporting window · Click to sort, Shift+click to multi-sort
            </p>
            <div style={{ display:"flex", gap:12, fontSize:11, color:"var(--color-text-secondary)" }}>
              {LEGEND.map(([c,l])=>(
                <span key={l} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ width:7, height:7, borderRadius:"50%", background:c, display:"inline-block" }} />{l}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab==="congress" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, flexWrap:"wrap", gap:8 }}>
            <StatusBadge live={cgLive} />
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
              <input type="text" placeholder="Search ticker or company…" value={search}
                onChange={e => setSearch(e.target.value.toLowerCase())}
                style={{ fontSize:12, padding:"4px 10px", borderRadius:6, border:"0.5px solid var(--color-border-tertiary)",
                  background:"var(--color-background-secondary)", color:"var(--color-text-primary)", width:180, outline:"none" }} />
              {["All","Purchase","Sale"].map(f=><FilterBtn key={f} label={f} active={cgFilter===f} onClick={()=>setCgFilter(f)} />)}
              <div style={{ width:"0.5px", background:"var(--color-border-tertiary)", margin:"0 4px" }} />
              {["All","House","Senate"].map(f=><FilterBtn key={f} label={f} active={cgChamber===f} onClick={()=>setCgChamber(f)} />)}
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:12, marginBottom:20 }}>
            <StatCard label="Unique tickers"   value={cgData.length} />
            <StatCard label="Purchases"        value={cgBuys}  subColor={UP}   sub="across members" />
            <StatCard label="Sales"            value={cgSells} subColor={DOWN} sub="across members" />
            <StatCard label="Est. total value" value={fmtM(cgTotal)} />
            <StatCard label="Most traded"      value={cgTop?.count+" members"} sub={cgTop?.ticker} />
          </div>
          <SortChips sorts={cgSort} setSorts={setCgSort} />
          <div style={{ border:"0.5px solid var(--color-border-tertiary)", borderRadius:"var(--border-radius-lg)", overflow:"hidden", marginTop: cgSort.length > 1 ? 8 : 0 }}>
            {cgLoading
              ? <div style={{ padding:40, textAlign:"center", color:"var(--color-text-secondary)", fontSize:13 }}>Fetching congressional disclosures…</div>
              : <CongressTable data={cgData} filter={cgFilter} chamberFilter={cgChamber} sorts={cgSort} setSorts={setCgSort} search={search} />}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:16, marginTop:10, flexWrap:"wrap" }}>
            <p style={{ fontSize:11, color:"var(--color-text-secondary)", margin:0 }}>
              Sources: Quiver Quantitative · Free · No key · Up to 45-day lag · Click to sort, Shift+click to multi-sort
            </p>
            <div style={{ display:"flex", gap:12, fontSize:11, color:"var(--color-text-secondary)" }}>
              {LEGEND.map(([c,l])=>(
                <span key={l} style={{ display:"flex", alignItems:"center", gap:4 }}>
                  <span style={{ width:7, height:7, borderRadius:"50%", background:c, display:"inline-block" }} />{l}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
