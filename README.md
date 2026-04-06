# Trade Flow Tracker

A self-hosted dashboard that monitors stock trading activity by corporate insiders (SEC Form 4) and members of the US Congress (STOCK Act disclosures). All data comes from free public sources — no API keys, no paid subscriptions.

## What it shows

### Form 4 — Insider Trading

Corporate insiders (executives, directors, 10%+ shareholders) must report stock trades to the SEC within 2 business days. The dashboard aggregates these filings and surfaces:

- Tickers with the most insider activity
- Buy vs. sell breakdown
- Number of shares traded and price per share
- Filing dates with freshness indicators

### Congress — STOCK Act

Members of the House and Senate must disclose stock trades within 45 days. The dashboard shows:

- Most-traded tickers across both chambers
- Purchase vs. sale activity
- Chamber breakdown (House, Senate, or both)
- Estimated dollar ranges

## Features

- **Multi-column sorting** — Click to sort, Shift+click to add sort levels
- **NEW badge** — Ticker first seen within the last 24 hours
- **RISING badge** — Insider/member count increased 2+ times within 72 hours
- **Delta indicators** — Parenthetical change values (e.g., `+3`, `-$72K`) showing movement within a 72-hour tracking window
- **Freshness dots** — Color-coded recency: green (0-2d), amber (3-7d), orange (8-21d), red (22d+)
- **Filter by action** — Show only buys, sells, or all
- **Filter by chamber** — House, Senate, or both (Congress tab)
- **Persistent state tracking** — Server maintains historical baselines to compute deltas across restarts
- **Background polling** — Server refreshes data hourly to keep state current

## Data Sources

| Source | Provides | Lag | Cost |
|--------|----------|-----|------|
| [SEC EDGAR](https://www.sec.gov/edgar/searchedgar/companysearch) | Form 4 filings, CIK-to-ticker mapping, transaction XML | ~2 business days | Free |
| [Quiver Quantitative](https://www.quiverquant.com/congresstrading/) | House + Senate stock trade disclosures | Up to 45 days | Free |

## Architecture

```
client/ (React + Vite)
  src/App.jsx          ← Single-page dashboard UI
  src/index.css        ← CSS custom properties, dark mode support

server/ (Express)
  index.js             ← API proxy routes + static file serving + background poller
  state-store.js       ← Persistent state tracking for NEW/RISING/delta indicators
```

The Express server serves the compiled React app as static files and proxies three data routes (`/api/form4`, `/api/congress`, `/api/house`, `/api/senate`). A single process handles everything — no separate frontend server needed.

## Setup

### Prerequisites

- Node.js 18+
- (Optional) [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for remote access

### Installation

```bash
git clone https://github.com/dyuhaus/trade-flow-tracker.git
cd trade-flow-tracker

# Install server dependencies
cd server && npm install && cd ..

# Install client dependencies and build
cd client && npm install && npm run build && cd ..
```

### Configuration

Create a `.env` file in the `server/` directory (optional):

```
SEC_USER_AGENT=TradeFlowTracker/3.0 your-email@example.com
PORT=3001
```

SEC EDGAR requires a `User-Agent` header with a valid contact email. If not set, a placeholder is used. Replace it with your own email to comply with [SEC's fair access policy](https://www.sec.gov/os/webmaster-faq#developers).

### Running

```bash
cd server
node index.js
```

Open `http://localhost:3001` in your browser.

### Production (pm2)

```bash
npm install -g pm2
cd server
pm2 start index.js --name trade-tracker
pm2 save
```

On Windows, install `pm2-windows-startup` for auto-start on boot:

```bash
npm install -g pm2-windows-startup
pm2-startup install
```

### Remote Access (Cloudflare Tunnel)

To expose the dashboard to the internet:

1. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
2. Log in: `cloudflared tunnel login`
3. Create a tunnel: `cloudflared tunnel create trade-tracker`
4. Configure `~/.cloudflared/config.yml`:

```yaml
tunnel: <YOUR-TUNNEL-UUID>
credentials-file: <PATH-TO-UUID>.json

ingress:
  - hostname: your-subdomain.yourdomain.com
    service: http://localhost:3001
  - service: http_status:404
```

5. Route DNS: `cloudflared tunnel route dns trade-tracker your-subdomain.yourdomain.com`
6. Run: `cloudflared tunnel run trade-tracker`

## Deploying Frontend Changes

After editing any file in `client/src/`:

```bash
cd client && npm run build && cd ..
pm2 restart trade-tracker   # or restart node manually
```

## Disclaimer

This dashboard displays publicly available government filing data. It is not investment advice, does not make recommendations, and should not be the sole basis for any financial decision. Filing data is delayed — SEC filings by ~2 business days, congressional disclosures by up to 45 days.

## License

MIT
