// ───────────────────────────────────────────────────────────────
//  Price Bot — نرخ لحظه‌ای ارز و طلا برای کانال تلگرام
//  • هر ۱۵ دقیقه (۸ صبح تا ۲۲:۴۵) نرخ لحظه‌ای + تغییر نسبت به ۱۱ شب دیشب
//  • ساعت ۲۳ هر شب: جمع‌بندی پایان روز + ذخیرهٔ مبنای فردا
//  • هیچ‌وقت پیام خراب/خالی به کانال نمی‌رود
//  • در صورت قطعی منبع، هشدار خصوصی به ادمین می‌رود (و هنگام وصل‌شدن، اطلاع)
//
//  چیدمان هر ردیف (راست‌چین):  توپ‌رنگی  پرچم  نام: قیمت  (تغییر)
// ───────────────────────────────────────────────────────────────

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

    // مسیرهای حساس فقط با کلید مخفی (?key=... یا هدر X-Trigger-Key)
    if (url.pathname === "/status") {
      if (!authorized(request, url, env)) return new Response("Not found", { status: 404 });
      return json(await status(env));
    }

    if (url.pathname === "/cron" || url.pathname === "/trigger" || url.pathname === "/analysis") {
      if (!authorized(request, url, env)) return new Response("Not found", { status: 404 });

      // /cron : پشتیبانِ کرونِ کلادفلر — دقیقاً مثل یک تیک زمان‌بندی رفتار می‌کند
      if (url.pathname === "/cron") {
        const r = await handleSchedule(env);
        await armTicker(env);
        return json(r);
      }
      // /trigger : ارسال اجباری (برای تست دستی)
      if (url.pathname === "/trigger") return json(await fetchAndSend(env, true));
      return json(await sendAnalysis(env));
    }

    return new Response("Price Bot is running! ✅");
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(beat(env, "last_cron_ms"));
    ctx.waitUntil(handleSchedule(env));
    ctx.waitUntil(armTicker(env)); // زمان‌بندِ پشتیبان همیشه مسلح بماند
  },
};

const DATA_URL = "https://call2.tgju.org/ajax.json";

// شناسهٔ چت خصوصیِ ادمین برای هشدارها (@iamashkaan)
// نکته: این کاربر باید یک‌بار ربات را Start کرده باشد وگرنه تلگرام اجازهٔ پیام خصوصی نمی‌دهد.
const ADMIN_CHAT_ID = "241301009";

// کلید مخفیِ مسیرهای حساس. تا وقتی ست نشده باشد، آن مسیرها بسته‌اند.
function authorized(request, url, env) {
  const secret = env.TRIGGER_SECRET;
  if (!secret) return false;
  const given = url.searchParams.get("key") || request.headers.get("X-Trigger-Key") || "";
  return safeEqual(given, secret);
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ثبت ضربانِ هر زمان‌بند، برای اینکه در /status معلوم باشد کدام‌یک زنده است
async function beat(env, key) {
  try { await env.PRICE_STORE.put(key, String(Date.now())); } catch (e) {}
}

// شناسهٔ اسلاتِ ۱۵ دقیقه‌ایِ جاری به وقت تهران (مثل 2026-08-25-13-1 برای ۱۳:۱۵)
// هر اسلات فقط یک پیام می‌گیرد؛ پس کرون و آلارمِ پشتیبان هرگز پیام تکراری نمی‌فرستند
// و پیام‌ها دقیقاً سرِ :۰۰ / :۱۵ / :۳۰ / :۴۵ می‌مانند.
function slotKey() {
  const { hour, minute } = tehranNow();
  return `${tehranDateKey()}-${hour}-${Math.floor(minute / 15)}`;
}
async function slotAlreadySent(env, slot) {
  try {
    return (await env.PRICE_STORE.get("sent_slot")) === slot;
  } catch (e) {
    return false;
  }
}

// قلم‌ها. ارزها ریالی‌اند → ÷۱۰ = تومان. انس طلا دلاری است (usd) → بدون تقسیم، با $.
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

// نشانه‌های جهت (Bidi) برای نمایش درست اعداد در متن راست‌چین
const RLM = "‏"; // Right-to-Left Mark — ابتدای هر خط
const LRI = "⁦"; // Left-to-Right Isolate
const PDI = "⁩"; // Pop Directional Isolate
const DIVIDER = "━━━━━━━━━━━━━━━";

// ===== زمان تهران =====
function tehranNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran", hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date());
  const hour = parseInt(parts.find(p => p.type === "hour").value, 10);
  const minute = parseInt(parts.find(p => p.type === "minute").value, 10);
  return { hour, minute };
}

// ساعت تهران به‌صورت فارسی (مثل ۱۴:۱۵)
function clock() {
  const { hour, minute } = tehranNow();
  return toFa(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
}

// تاریخ شمسیِ عددی به وقت تهران (مثل ۱۴۰۵/۰۳/۱۳)
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

// کلید تاریخ تهران (YYYY-MM-DD) برای جلوگیری از ارسال دوبارهٔ تحلیل
function tehranDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// مهر زمانی برای هشدار ادمین
function stamp() {
  const d = jalaliNumeric();
  return d ? `${d} - ${clock()}` : clock();
}

// ساعت کاری: ۸ صبح تا ۲۳ (نرخ لحظه‌ای)؛ ساعت ۲۳ مخصوص جمع‌بندی است
function isWorkingHours() {
  const { hour } = tehranNow();
  return hour >= 8 && hour < 23;
}

// ===== گرفتن قیمت‌ها =====
// خروجی: { ok, validCount, prices }   (ok=false یعنی داده‌ی معتبری نیامده)
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
      const div = item.usd ? 1 : 10; // ارزها ریالی (÷۱۰)، انس طلا دلاری (÷۱)
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

// رشتهٔ عددیِ با کاما → عدد صحیح (تقسیم بر divisor، گرد شده). یا null اگر نامعتبر.
function parseNum(v, divisor) {
  if (!v) return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  if (isNaN(n) || n <= 0) return null;
  return Math.round(n / divisor);
}

// ===== ذخیره/خواندن قیمت‌های دیشب (مبنای ساعت ۲۳) =====
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
    if (prices[k].price > 0) snap[k] = prices[k].price; // فقط قیمت‌های معتبر را مبنا کن
  }
  await env.PRICE_STORE.put("last_night", JSON.stringify(snap));
}

// ===== ابزار قالب‌بندی =====
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
function toFa(s) {
  return String(s).replace(/\d/g, d => FA_DIGITS[d]);
}
function fa(n) {
  return toFa(n.toLocaleString("en-US"));
}
function esc(s) { // فرار دادن کاراکترهای HTML
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function stripHtml(s) { // برای پیش‌نمایش متنی
  return s.replace(/<\/?[^>]+>/g, "");
}
function priceText(value, usd) {
  return usd ? `$${fa(value)}` : fa(value);
}
// عدد ایزوله‌شده برای راست‌چینیِ درست
function num(value, usd) {
  return `${LRI}${priceText(value, usd)}${PDI}`;
}

// توپ رنگی بر اساس تغییر نسبت به دیشب (⚪️ وقتی مبنا نداریم)
function circleFor(item, p, prev) {
  if (prev && prev[item.key]) {
    const diff = p.price - prev[item.key];
    if (diff > 0) return "🟢";
    if (diff < 0) return "🔴";
  }
  return "⚪️";
}
// متن تغییر داخل پرانتز (بدون فلش)؛ "" اگر بدون مبنا یا بدون تغییر
function changeText(item, p, prev) {
  if (!prev || !prev[item.key]) return "";
  const diff = p.price - prev[item.key];
  if (diff === 0) return "";
  return `(${diff > 0 ? "+" : "-"}${fa(Math.abs(diff))})`;
}

// ===== یک ردیف قیمت =====
//  توپ  پرچم  نام: قیمت(بولد)  (تغییر)
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
    if (!p || p.price <= 0) continue; // قلم‌های بدون داده نمایش داده نمی‌شوند
    lines.push(row(item, p, prev, isSummary));
  }
  return lines.join("\n");
}

// ===== هدر مشترک =====
function headerBlock(title) {
  const d = jalaliNumeric();
  const dt = d ? `${d} - ${clock()}` : clock();
  let h = `${RLM}<b>${esc(title)}</b>\n`;
  h += `${RLM}🕐 ${LRI}${dt}${PDI}\n`;
  h += `${RLM}${DIVIDER}\n`;
  return h;
}
const FOOTER = `\n${RLM}${DIVIDER}`;

// ===== پیام لحظه‌ای =====
function buildMessage(prices, prev) {
  return headerBlock("📊 نرخ لحظه‌ای بازار") + renderRows(prices, prev, false) + FOOTER;
}

// ===== پیام جمع‌بندی پایان روز =====
function buildAnalysis(prices, prev) {
  return headerBlock("🌙 جمع‌بندی پایان روز") + renderRows(prices, prev, true) + FOOTER;
}

// ===== ارسال به تلگرام =====
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

// هشدار خصوصی به ادمین (بهترین‌تلاش؛ هرگز throw نمی‌کند)
async function notifyAdmin(env, text) {
  try {
    if (env.TELEGRAM_BOT_TOKEN && ADMIN_CHAT_ID) {
      await sendToTelegram(env.TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, text, { html: false });
    }
  } catch (e) { /* اگر نشد، بی‌خیال */ }
}

// مدیریت وضعیت سلامت: هشدار هنگام قطعی و اطلاع هنگام وصل‌شدن (بدون اسپم)
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

// ===== ارسال نرخ لحظه‌ای =====
async function fetchAndSend(env, force) {
  if (!force && !isWorkingHours()) {
    return { success: false, skipped: "خارج از ساعت کاری" };
  }
  const slot = slotKey();
  if (!force && (await slotAlreadySent(env, slot))) {
    return { success: false, skipped: "این ربع‌ساعت قبلاً ارسال شده" };
  }
  try {
    const { ok, validCount, prices } = await fetchAllPrices();
    if (!ok) return { success: false, error: "داده‌ی معتبری از منبع دریافت نشد؛ ارسال نشد" };
    const prev = await loadPrevious(env);
    await sendToTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHANNEL_ID, buildMessage(prices, prev), { silent: true });
    try {
      await env.PRICE_STORE.put("sent_slot", slot);
      await env.PRICE_STORE.put("last_sent_ms", String(Date.now()));
    } catch (e) {}
    return { success: true, validCount };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ===== ارسال جمع‌بندی شب + ذخیرهٔ مبنای فردا =====
async function sendAnalysis(env) {
  try {
    const { ok, validCount, prices } = await fetchAllPrices();
    if (!ok) return { success: false, error: "داده‌ی معتبری دریافت نشد؛ جمع‌بندی ارسال و ذخیره نشد" };
    const prev = await loadPrevious(env);
    await sendToTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHANNEL_ID, buildAnalysis(prices, prev), { silent: false });
    await savePrevious(env, prices); // فقط با دادهٔ معتبر، مبنای فردا به‌روز می‌شود
    return { success: true, validCount };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ===== مدیریت زمان‌بندی (هر ۱۵ دقیقه) =====
async function handleSchedule(env) {
  const { hour } = tehranNow();
  let result;

  if (hour === 23) {
    const today = tehranDateKey();
    if (await env.PRICE_STORE.get(`analysis_sent_${today}`)) {
      return { skipped: true, reason: "analysis already sent today" };
    }
    result = await sendAnalysis(env);
    // پرچم فقط در صورت موفقیت تا اگر خطا شد، تیک بعدیِ ساعت ۲۳ دوباره تلاش کند
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

// پاسخ JSON برای endpointها
function json(obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}

// ───────────────────────────────────────────────────────────────
//  زمان‌بندِ پشتیبان (Durable Object Alarm)
//  کرونِ کلادفلر گاهی شلیک نمی‌کند؛ این آلارم مستقل از آن هر ۵ دقیقه
//  بیدار می‌شود و اگر تیکِ کرون جا مانده باشد، جایش را پر می‌کند.
//  قفلِ اسلاتِ ۱۵ دقیقه‌ای تضمین می‌کند پیام تکراری به کانال نرود.
// ───────────────────────────────────────────────────────────────
const TICK_MS = 5 * 60 * 1000;
const TICK_OFFSET_MS = 15 * 1000; // کمی بعد از سرِ دقیقه، تا اسلات درست محاسبه شود

// لحظهٔ تیکِ بعدی، هم‌تراز با ساعتِ دیواری: ...:00:15، :05:15، :10:15 و ...
// چون اختلاف تهران با UTC مضرب ۳۰ دقیقه است، مرزهای ربع‌ساعت در هر دو یکی‌اند.
function nextTickAt(now = Date.now()) {
  return Math.floor((now - TICK_OFFSET_MS) / TICK_MS) * TICK_MS + TICK_MS + TICK_OFFSET_MS;
}

export class Ticker {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // فقط برای مسلح‌کردن آلارم (اگر خاموش بود)
  async fetch(request) {
    let next = await this.state.storage.getAlarm();
    if (next === null) {
      next = nextTickAt();
      await this.state.storage.setAlarm(next);
    }
    return new Response(JSON.stringify({ next_alarm_ms: next }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async alarm() {
    // اول زنجیره را ادامه بده تا هیچ خطایی آلارم بعدی را قطع نکند
    await this.state.storage.setAlarm(nextTickAt());
    await beat(this.env, "last_alarm_ms");
    try {
      await handleSchedule(this.env);
    } catch (e) { /* بی‌خیال؛ تیک بعدی دوباره تلاش می‌کند */ }
  }
}

// مطمئن شدن از اینکه آلارمِ پشتیبان مسلح است (بهترین‌تلاش)
async function armTicker(env) {
  try {
    const id = env.TICKER.idFromName("main");
    const r = await env.TICKER.get(id).fetch("https://ticker/arm");
    return await r.json();
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}

// ===== وضعیت سلامت: کدام زمان‌بند زنده است و آخرین پیام کِی رفت =====
async function status(env) {
  const now = Date.now();
  const ago = ms => (ms ? Math.round((now - Number(ms)) / 1000) : null);
  const read = async k => { try { return await env.PRICE_STORE.get(k); } catch (e) { return null; } };

  const [sent, cron, alarm] = await Promise.all([
    read("last_sent_ms"), read("last_cron_ms"), read("last_alarm_ms"),
  ]);
  const ticker = await armTicker(env);
  const { hour, minute } = tehranNow();

  return {
    tehran: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    working_hours: isWorkingHours(),
    slot: slotKey(),
    slot_sent: await slotAlreadySent(env, slotKey()),
    last_message_sec_ago: ago(sent),
    last_cron_tick_sec_ago: ago(cron),
    last_alarm_tick_sec_ago: ago(alarm),
    next_alarm_in_sec: ticker && ticker.next_alarm_ms
      ? Math.round((Number(ticker.next_alarm_ms) - now) / 1000)
      : null,
    ticker_error: (ticker && ticker.error) || null,
  };
}
