export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/preview") {
      const { prices } = await fetchAllPrices();
      const prev = await loadPrevious(env);
      return new Response(stripHtml(buildMessage(prices, prev)), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname === "/trigger") {
      return json(await fetchAndSend(env, true)); 
    }

    if (url.pathname === "/analysis") {
      return json(await sendAnalysis(env));
    }

    return new Response("Price Bot is running! ✅");
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleSchedule(env));
  },
};

const DATA_URL = "https://call2.tgju.org/ajax.json";

const ADMIN_CHAT_ID = "";

const ITEMS = [
  { key: "price_dollar_rl",   icon: "🇺🇸", name: "دلار" },
  { key: "price_eur",         icon: "🇪🇺", name: "یورو" },
  { key: "price_gbp",         icon: "🇬🇧", name: "پوند" },
  { key: "price_cny",         icon: "🇨🇳", name: "یوان چین" },
  { key: "price_try",         icon: "🇹🇷", name: "لیر ترکیه" },
  { key: "price_aed",         icon: "🇦🇪", name: "درهم" },
  { key: "price_jpy",         icon: "🇯🇵", name: "ین ژاپن" },
  { key: "price_cad",         icon: "🇨🇦", name: "دلار کانادا" },
  { key: "price_omr",         icon: "🇴🇲", name: "ریال عمان" },
  { key: "crypto-tether-irr", icon: "💵", name: "تتر" },
  { key: "ons",               icon: "🥇", name: "انس طلا", usd: true },
  { key: "geram18",           icon: "🥇", name: "طلای ۱۸ عیار" },
];

const RLM = "‏"; // Right-to-Left Mark — ابتدای هر خط
const LRI = "⁦"; // Left-to-Right Isolate
const PDI = "⁩"; // Pop Directional Isolate
const DIVIDER = "━━━━━━━━━━━━━━━";


function tehranNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran", hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date());
  const hour = parseInt(parts.find(p => p.type === "hour").value, 10);
  const minute = parseInt(parts.find(p => p.type === "minute").value, 10);
  return { hour, minute };
}

function clock() {
  const { hour, minute } = tehranNow();
  return toFa(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
}

function jalaliNumeric() {
  try {
    const p = new Intl.DateTimeFormat("en-US-u-ca-persian", {
      timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const g = t => (p.find(x => x.type === t) || {}).value || "";
    const s = `${g("year")}/${g("month")}/${g("day")}`;
    return s.length >= 8 ? toFa(s) : "";
  } catch (e) {
    return "";
  }
}


function tehranDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}


function stamp() {
  const d = jalaliNumeric();
  return d ? `${d} - ${clock()}` : clock();
}

function isWorkingHours() {
  const { hour } = tehranNow();
  return hour >= 8 && hour < 23;
}


async function fetchAllPrices() {
  const results = {};
  let validCount = 0;
  try {
    const response = await fetch(DATA_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.tgju.org/",
      },
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const json = await response.json();
    const current = json.current || {};
    for (const item of ITEMS) {
      const raw = current[item.key];
      const div = item.usd ? 1 : 10; 
      const price = parseNum(raw && raw.p, div);
      if (price) {
        validCount++;
        results[item.key] = { price, high: parseNum(raw.h, div), low: parseNum(raw.l, div) };
      } else {
        results[item.key] = { price: 0, high: null, low: null };
      }
    }
  } catch (e) {
    for (const item of ITEMS) {
      if (!results[item.key]) results[item.key] = { price: 0, high: null, low: null };
    }
  }
  return { ok: validCount > 0, validCount, prices: results };
}


function parseNum(v, divisor) {
  if (!v) return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  if (isNaN(n) || n <= 0) return null;
  return Math.round(n / divisor);
}


async function loadPrevious(env) {
  try {
    const v = await env.PRICE_STORE.get("last_night");
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}
async function savePrevious(env, prices) {
  const snap = {};
  for (const k of Object.keys(prices)) {
    if (prices[k].price > 0) snap[k] = prices[k].price; 
  }
  await env.PRICE_STORE.put("last_night", JSON.stringify(snap));
}


const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
function toFa(s) {
  return String(s).replace(/\d/g, d => FA_DIGITS[d]);
}
function fa(n) {
  return toFa(n.toLocaleString("en-US"));
}
function esc(s) { 
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function stripHtml(s) { 
  return s.replace(/<\/?[^>]+>/g, "");
}
function priceText(value, usd) {
  return usd ? `$${fa(value)}` : fa(value);
}

function num(value, usd) {
  return `${LRI}${priceText(value, usd)}${PDI}`;
}


function circleFor(item, p, prev) {
  if (prev && prev[item.key]) {
    const diff = p.price - prev[item.key];
    if (diff > 0) return "🟢";
    if (diff < 0) return "🔴";
  }
  return "⚪️";
}

function changeText(item, p, prev) {
  if (!prev || !prev[item.key]) return "";
  const diff = p.price - prev[item.key];
  if (diff === 0) return "";
  return `(${diff > 0 ? "+" : "-"}${fa(Math.abs(diff))})`;
}


function row(item, p, prev, isSummary) {
  const ball = circleFor(item, p, prev);
  let line = `${RLM}${ball} ${item.icon} ${esc(item.name)}: <b>${num(p.price, item.usd)}</b>`;
  if (!isSummary) {
    const ch = changeText(item, p, prev);
    if (ch) line += `  ${LRI}${ch}${PDI}`;
  } else if (p.high && p.low) {
    line += `\n${RLM}     کمترین ${num(p.low, item.usd)}   بیشترین ${num(p.high, item.usd)}`;
  }
  return line;
}

function renderRows(prices, prev, isSummary) {
  const lines = [];
  for (const item of ITEMS) {
    const p = prices[item.key];
    if (!p || p.price <= 0) continue; 
    lines.push(row(item, p, prev, isSummary));
  }
  return lines.join("\n");
}


function headerBlock(title) {
  const d = jalaliNumeric();
  const dt = d ? `${d} - ${clock()}` : clock();
  let h = `${RLM}<b>${esc(title)}</b>\n`;
  h += `${RLM}🕐 ${LRI}${dt}${PDI}\n`;
  h += `${RLM}${DIVIDER}\n`;
  return h;
}
const FOOTER = `\n${RLM}${DIVIDER}`;


function buildMessage(prices, prev) {
  return headerBlock("📊 نرخ لحظه‌ای بازار") + renderRows(prices, prev, false) + FOOTER;
}


function buildAnalysis(prices, prev) {
  return headerBlock("🌙 جمع‌بندی پایان روز") + renderRows(prices, prev, true) + FOOTER;
}


async function sendToTelegram(botToken, chatId, text, { silent = false, html = true } = {}) {
  const body = {
    chat_id: chatId, text,
    disable_web_page_preview: true,
    disable_notification: silent,
  };
  if (html) body.parse_mode = "HTML";
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!result.ok) {
    throw new Error(`Telegram API error: ${result.error_code} - ${result.description}`);
  }
  return result;
}


async function notifyAdmin(env, text) {
  try {
    if (env.TELEGRAM_BOT_TOKEN && ADMIN_CHAT_ID) {
      await sendToTelegram(env.TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, text, { html: false });
    }
  } catch (e) { /* اگر نشد، بی‌خیال */ }
}


async function updateHealth(env, result) {
  let wasDown = false;
  try { wasDown = !!(await env.PRICE_STORE.get("api_down")); } catch (e) {}

  if (result && result.success) {
    if (wasDown) {
      await notifyAdmin(env, `✅ ربات قیمت دوباره وصل شد و پیام‌ها ارسال می‌شوند.\n🕓 ${stamp()}`);
      try { await env.PRICE_STORE.delete("api_down"); } catch (e) {}
    }
  } else if (result && result.error) {
    if (!wasDown) {
      await notifyAdmin(env, `⚠️ مشکل در ربات قیمت:\n${result.error}\n🕓 ${stamp()}`);
      try { await env.PRICE_STORE.put("api_down", "1"); } catch (e) {}
    }
  }
}


async function fetchAndSend(env, force) {
  if (!force && !isWorkingHours()) {
    return { success: false, skipped: "خارج از ساعت کاری" };
  }
  try {
    const { ok, validCount, prices } = await fetchAllPrices();
    if (!ok) return { success: false, error: "داده‌ی معتبری از منبع دریافت نشد؛ ارسال نشد" };
    const prev = await loadPrevious(env);
    await sendToTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHANNEL_ID, buildMessage(prices, prev), { silent: true });
    return { success: true, validCount };
  } catch (error) {
    return { success: false, error: error.message };
  }
}


async function sendAnalysis(env) {
  try {
    const { ok, validCount, prices } = await fetchAllPrices();
    if (!ok) return { success: false, error: "داده‌ی معتبری دریافت نشد؛ جمع‌بندی ارسال و ذخیره نشد" };
    const prev = await loadPrevious(env);
    await sendToTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHANNEL_ID, buildAnalysis(prices, prev), { silent: false });
    await savePrevious(env, prices); 
    return { success: true, validCount };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function handleSchedule(env) {
  const { hour } = tehranNow();
  let result;

  if (hour === 23) {
    const today = tehranDateKey();
    if (await env.PRICE_STORE.get(`analysis_sent_${today}`)) {
      return { skipped: true, reason: "analysis already sent today" };
    }
    result = await sendAnalysis(env);
    
    if (result.success) {
      await env.PRICE_STORE.put(`analysis_sent_${today}`, "1", { expirationTtl: 172800 });
    }
  } else if (isWorkingHours()) {
    result = await fetchAndSend(env, false);
  } else {
    return { skipped: true };
  }

  await updateHealth(env, result);
  return result;
}


function json(obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
