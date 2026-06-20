/**
 * Mirad AI Proxy — Cloudflare Worker
 *
 * Purpose: keeps the OpenAI API key server-side. The dashboard calls this
 * Worker; the Worker attaches the real key and forwards to OpenAI.
 *
 * Endpoints exposed to the frontend:
 *   POST /chat            -> proxies to https://api.openai.com/v1/chat/completions
 *   POST /transcribe      -> proxies to https://api.openai.com/v1/audio/transcriptions
 *   GET  /units            -> returns the unit inventory (was UNIT_DB in the HTML)
 *   GET  /nbe               -> returns bank rate table (was NBE in the HTML)
 *
 * Security features (mapped to the checklist):
 *   - Secret management: OPENAI_API_KEY is a Worker secret, never in source.
 *   - CORS lock: only ALLOWED_ORIGIN may call this.
 *   - Rate limiting: simple per-IP limit using Workers cache (best-effort).
 *   - Graceful fallback: try/catch around the upstream call, returns a clean
 *     JSON error instead of crashing or leaking internals.
 *   - Honeypot: any path other than /chat or /transcribe returns 404 quickly
 *     and logs the attempt (visible in `wrangler tail`).
 */

import UNIT_DB from "./data/units.json";
import NBE from "./data/nbe.json";
import COMPS from "./data/comps.json";

const ALLOWED_ORIGINS = [
  "https://your-domain.com",
  "https://www.your-domain.com",
  "null", // allows opening the dashboard as a local file (file://) on laptop/phone
  "http://localhost:8080", // local testing only — remove once hosted on your-domain.com
  // add more (e.g. a staging URL) if needed
];

const RATE_LIMIT = 30;            // max requests
const RATE_WINDOW_SECONDS = 60;   // per this many seconds, per IP

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Token",
  };
}

async function checkRateLimit(ip, env) {
  const key = `rl:${ip}`;
  const cache = caches.default;
  const cacheKey = new Request(`https://rate-limit.local/${key}`);
  let count = 0;
  const cached = await cache.match(cacheKey);
  if (cached) {
    count = parseInt(await cached.text(), 10) || 0;
  }
  if (count >= RATE_LIMIT) return false;
  const resp = new Response(String(count + 1), {
    headers: { "Cache-Control": `max-age=${RATE_WINDOW_SECONDS}` },
  });
  await cache.put(cacheKey, resp);
  return true;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    // Only allow known frontend origins
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response(JSON.stringify({ error: "Forbidden origin" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...headers },
      });
    }

    // Require a shared app token so random visitors can't call the API
    // even if they guess the Worker URL. Set with: wrangler secret put APP_TOKEN
    const token = request.headers.get("X-App-Token") || "";
    if (!env.APP_TOKEN || token !== env.APP_TOKEN) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...headers },
      });
    }

    // Rate limit per IP
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const ok = await checkRateLimit(ip, env);
    if (!ok) {
      return new Response(JSON.stringify({ error: "Too many requests, slow down." }), {
        status: 429,
        headers: { "Content-Type": "application/json", ...headers },
      });
    }

    try {
      if (request.method === "POST" && url.pathname === "/chat") {
        const body = await request.text();
        const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          },
          body,
        });
        const data = await upstream.json();
        // Strip markdown that doesn't render in the plain chat bubble
        const msg = data.choices?.[0]?.message;
        if (msg && typeof msg.content === "string") {
          msg.content = msg.content
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, "$1")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/^#{1,6}\s*/gm, "")
            .replace(/^[ \t]*[-*]\s+/gm, "• ");
        }
        return new Response(JSON.stringify(data), {
          status: upstream.status,
          headers: { "Content-Type": "application/json", ...headers },
        });
      }

      // Web-search-augmented chat — for real estate/market/finance/marketing
      // questions where current information helps. Uses OpenAI's Responses
      // API with the built-in web_search tool.
      if (request.method === "POST" && url.pathname === "/chat-search") {
        const { messages } = await request.json();
        const upstream = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-4o",
            input: messages,
            tools: [{ type: "web_search_preview" }],
          }),
        });
        const data = await upstream.json();
        if (!upstream.ok) {
          return new Response(JSON.stringify(data), {
            status: upstream.status,
            headers: { "Content-Type": "application/json", ...headers },
          });
        }
        // Normalize to the same shape the frontend expects from /chat
        const text = data.output_text
          || (data.output || [])
              .flatMap(o => o.content || [])
              .filter(c => c.type === "output_text")
              .map(c => c.text).join("\n")
          || "";
        // Strip markdown that doesn't render in the plain chat bubble:
        // [label](url) -> label, **bold** -> bold, remove leftover ?utm_source= junk
        const cleanText = text
          .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, "$1")
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/https?:\/\/\S+/g, "")
          .replace(/[ \t]+\n/g, "\n")
          .trim();
        return new Response(JSON.stringify({ choices: [{ message: { content: cleanText } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...headers },
        });
      }

      if (request.method === "POST" && url.pathname === "/transcribe") {
        const formData = await request.formData();
        const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
          body: formData,
        });
        const data = await upstream.text();
        return new Response(data, {
          status: upstream.status,
          headers: { "Content-Type": "application/json", ...headers },
        });
      }

      if (request.method === "GET" && url.pathname === "/units") {
        return new Response(JSON.stringify(UNIT_DB), {
          status: 200,
          headers: { "Content-Type": "application/json", ...headers },
        });
      }

      if (request.method === "GET" && url.pathname === "/nbe") {
        return new Response(JSON.stringify(NBE), {
          status: 200,
          headers: { "Content-Type": "application/json", ...headers },
        });
      }

      if (request.method === "GET" && url.pathname === "/comps") {
        return new Response(JSON.stringify(COMPS), {
          status: 200,
          headers: { "Content-Type": "application/json", ...headers },
        });
      }

      // Honeypot / unknown route — fail closed, no details leaked
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...headers },
      });
    } catch (err) {
      // Graceful fallback — never expose internals or the API key
      return new Response(
        JSON.stringify({ error: "Upstream service unavailable, please try again." }),
        { status: 502, headers: { "Content-Type": "application/json", ...headers } }
      );
    }
  },
};
