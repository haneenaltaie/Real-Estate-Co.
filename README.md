# Real Estate CCO Dashboard

A fully featured **Chief Commercial Officer dashboard** built for a real estate developer. Designed to replace disconnected spreadsheets and give the sales leadership team a single source of truth for inventory, pipeline, financials, and AI-assisted deal support.

---

## What It Does

- **Live inventory grid** — all units with status (available, reserved, sold), pricing, floor/view filters, and color-coded occupancy
- **Sales pipeline & CRM** — tracks deals from first contact to close, logs client interactions, flags at-risk leads
- **Financial modeling** — payment plan builder, mortgage calculator with live bank rates (NBE integration), sensitivity analysis on price vs. absorption
- **Market comps** — comparable project benchmarking to support pricing decisions
- **AI assistant** — GPT-4o powered chat and voice input for instant deal Q&A ("What's the best unit for a client with a 20% down budget?")
- **Export** — one-click XLSX export of deals and pipeline data

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS, HTML5, CSS3 — zero framework dependencies |
| AI backend | Cloudflare Worker (proxy) → OpenAI GPT-4o + Whisper |
| Security | API key stored as Cloudflare Worker secret, CORS lock, per-IP rate limiting, app token auth |
| Data | JSON-driven unit inventory and bank rate tables served from the Worker |
| Deploy | Static HTML (no build step) + `wrangler deploy` for the Worker |

---

## Architecture

```
Browser (Dashboard HTML)
        │
        │  POST /chat, /transcribe
        │  GET  /units, /nbe
        ▼
Cloudflare Worker  ◄── OPENAI_API_KEY (secret, never in source)
        │
        ▼
   OpenAI API (GPT-4o / Whisper)
```

The Worker acts as a secure proxy — the OpenAI key never reaches the browser, and only requests from the authorised domain are accepted.

---

## Security Features

- **No exposed API keys** — all secrets stored via `wrangler secret`, injected at runtime only
- **CORS restriction** — Worker rejects requests from unknown origins
- **App token** — shared secret header (`X-App-Token`) required on every call
- **Rate limiting** — 30 requests/min per IP using Cloudflare's cache layer
- **Honeypot routes** — unknown paths return 404 and log the attempt

---

## Project Structure

```
├── apex_cco_dashboard_v24_preview.html   # Latest dashboard (preview)
├── apex_cco_dashboard_v23_1.html         # Stable production build
└── worker/
    ├── worker.js          # Cloudflare Worker (AI proxy + data endpoints)
    ├── wrangler.toml      # Worker config
    ├── SETUP.md           # Deployment guide
    └── data/
        ├── units.json     # Unit inventory
        ├── nbe.json       # Bank rate table
        └── comps.json     # Market comparables
```

---

## Setup & Deployment

See [`worker/SETUP.md`](worker/SETUP.md) for the full deployment guide. The short version:

```bash
# 1. Deploy the Worker
cd worker
npm install -g wrangler
wrangler login
wrangler deploy

# 2. Store your OpenAI key securely
wrangler secret put OPENAI_API_KEY

# 3. Point the dashboard at your Worker URL
# Edit AI_PROXY_URL in the HTML file, then open it in a browser
```

---

## Key Design Decisions

**Why a single HTML file?** The client needed something that could be opened locally on any laptop or tablet, with no server or installation required. A self-contained HTML file was the simplest path to that.

**Why Cloudflare Workers for the AI proxy?** Zero cold-start latency, free tier covers the usage volume, and secrets management is built in — no backend server to maintain.

**Why vanilla JS?** Dashboard needs to load fast and work offline. No framework overhead, no build pipeline to break.

---

## What I Built

This was a full end-to-end build — from initial wireframes to a production-deployed dashboard used daily by the sales team. I handled:
- UX design and information architecture
- All frontend development
- Cloudflare Worker backend
- Security hardening (API key exposure fix, rate limiting, CORS)
- Data modelling for units, pipeline, and financial scenarios
