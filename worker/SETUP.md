# Mirad AI Proxy — Setup

This Worker keeps your OpenAI key on Cloudflare's servers, never in the dashboard HTML.

## 1. Prerequisites
- A Cloudflare account (free tier is fine)
- Node.js installed
- Your NEW OpenAI key (the old one must be revoked at platform.openai.com → API keys)

## 2. Deploy the Worker

```bash
npm install -g wrangler
cd worker
wrangler login
wrangler deploy
```

This prints a URL like:
`https://mirad-ai-proxy.<your-subdomain>.workers.dev`

## 3. Set the OpenAI key as a secret (never in code)

```bash
wrangler secret put OPENAI_API_KEY
```

Paste your new `sk-proj-...` key when prompted. It is stored encrypted by Cloudflare and only injected at runtime.

## 4. Lock down CORS

In `worker.js`, edit `ALLOWED_ORIGINS` to match the domain(s) that will load
`mirad_cco_dashboard_v23_1.html` (e.g. `https://mirad.co`). Redeploy with
`wrangler deploy`.

## 5. Point the dashboard at your Worker

In `mirad_cco_dashboard_v23_1.html`, find:

```js
const AI_PROXY_URL='https://mirad-ai-proxy.<your-subdomain>.workers.dev';
```

Replace with the real URL from step 2.

## 6. Cloudflare dashboard extras (from the checklist)

- **Bot Fight Mode**: Security → Bots → enable. Free, no code change.
- **Custom rule / honeypot**: Security → WAF → Custom rules → block requests
  to fake paths like `/.env` or `/wp-admin` and auto-block the IP.
- These apply to your main domain (mirad.co), separate from this Worker.

## What changed in the dashboard

- Removed the hardcoded OpenAI key (was exposed to every visitor).
- Removed the "enter your API key" prompt/modal flow — no longer needed.
- All 3 AI calls (chat x2, voice transcription) now go through
  `AI_PROXY_URL/chat` and `AI_PROXY_URL/transcribe`.
- The Worker rate-limits each IP (30 req/min) and returns clean errors on
  upstream failure instead of crashing — the "graceful fallback" from the
  checklist.

## Reminder

The OpenAI key you shared in this chat must be treated as already
compromised once typed in plain text — after setting it as a Wrangler
secret, consider rotating it again from platform.openai.com for good
hygiene.
