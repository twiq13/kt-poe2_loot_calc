// scripts/scrape-poeninja-poe2.mjs
import fs from "fs";
import { chromium } from "playwright";

const LEAGUE = (process.env.LEAGUE || "standard").toLowerCase();
const BASE = "https://poe.ninja";

function cleanName(name) {
  return String(name || "").replace(/\s*WIKI\s*$/i, "").trim();
}

function normalizeUrl(u) {
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("/")) return BASE + u;
  return u;
}

function parseCompactNumber(s) {
  if (!s) return null;
  const t = String(s).trim().toLowerCase().replace(/,/g, ".");
  const m = t.match(/^([0-9]+(\.[0-9]+)?)(k|m)?$/i);
  if (!m) return null;
  let n = Number(m[1]);
  if (m[3] === "k") n *= 1000;
  if (m[3] === "m") n *= 1000000;
  return Number.isFinite(n) ? n : null;
}

async function safeGoto(page, url) {
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const status = res?.status?.() ?? 0;
    if (status >= 400) return { ok: false, status };
    return { ok: true, status };
  } catch {
    return { ok: false, status: 0 };
  }
}

// tooltip reader (best effort)
async function getTooltipText(page) {
  return await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll('[role="tooltip"], .tooltip, [data-popper-placement]')
    );
    const visible = candidates.filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const el = visible[visible.length - 1] || null;
    return el ? (el.innerText || "").replace(/\s+/g, " ").trim() : "";
  });
}

// Try to parse an "X Exalted Orb" from tooltip
function parseExaltedFromTooltip(tip) {
  if (!tip) return null;

  // prefer a value that is NOT the "1.0 Exalted Orb" anchor when possible
  // example tooltip strings can vary; we grab the first meaningful number before "Exalted Orb"
  const matches = [...tip.matchAll(/([0-9]+([.,][0-9]+)?(k|m)?)\s*Exalted\s*Orb/gi)];
  if (!matches.length) return null;

  // choose the first number that isn't 1 or 1.0 (common anchor)
  for (const m of matches) {
    const n = parseCompactNumber(m[1]);
    if (n !== null && Math.abs(n - 1) > 1e-9) return n;
  }
  // otherwise fallback to first
  return parseCompactNumber(matches[0][1]);
}

// get value cell "amount + unit + unitIcon" by DOM (not innerText)
async function extractValueCellInfo(tdHandle) {
  return await tdHandle.evaluate(td => {
    // number: first numeric token in textContent
    const raw = (td.textContent || "").replace(/\s+/g, " ").trim();
    const token = raw.split(" ").find(x => /^[0-9]/.test(x)) || "";
    const amountText = token || "";

    // unit: try aria-label / alt / title from imgs inside the td (often the last icon)
    const imgs = Array.from(td.querySelectorAll("img"));
    const last = imgs[imgs.length - 1] || null;

    const unit =
      (last?.getAttribute("aria-label") ||
        last?.getAttribute("alt") ||
        last?.getAttribute("title") ||
        "")?.trim();

    const unitIcon = last?.getAttribute("src") || "";

    return {
      amountText,
      unit,
      unitIcon
    };
  });
}

async function scrapeSection(page, sectionKey, url) {
  console.log(`\n[${sectionKey}] Opening: ${url}`);

  const nav = await safeGoto(page, url);
  if (!nav.ok) {
    console.log(`[${sectionKey}] SKIP (HTTP ${nav.status})`);
    return { ok: false, lines: [], baseIcon: "" };
  }

  // Wait table
  try {
    await page.waitForSelector("table thead th", { timeout: 60000 });
    await page.waitForSelector("table tbody tr", { timeout: 60000 });
    await page.waitForTimeout(2500);
  } catch {
    console.log(`[${sectionKey}] SKIP (table not found)`);
    return { ok: false, lines: [], baseIcon: "" };
  }

  // find "Value" column index
  const valueColIndex = await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll("table thead th"));
    return ths.findIndex(th => (th.innerText || "").trim().toLowerCase() === "value");
  });

  if (valueColIndex < 0) {
    console.log(`[${sectionKey}] SKIP (Value column not found)`);
    return { ok: false, lines: [], baseIcon: "" };
  }

  const rowHandles = await page.$$("table tbody tr");
  if (!rowHandles.length) {
    console.log(`[${sectionKey}] SKIP (no rows)`);
    return { ok: false, lines: [], baseIcon: "" };
  }

  // baseIcon (Exalted) for UI: only reliable from currency page, but we attempt anyway
  let exaltIcon = "";
  for (const tr of rowHandles.slice(0, 80)) {
    const txt = (await tr.innerText()).replace(/\s+/g, " ").trim().toLowerCase();
    if (txt.startsWith("exalted orb") || txt.startsWith("perfect exalted orb")) {
      const img = await tr.$("td img");
      if (img) exaltIcon = normalizeUrl((await img.getAttribute("src")) || "");
      break;
    }
  }

  const lines = [];
  const max = Math.min(rowHandles.length, 300);

  for (let i = 0; i < max; i++) {
    const tr = rowHandles[i];
    const tds = await tr.$$("td");
    if (!tds.length || tds.length <= valueColIndex) continue;

    const nameRaw = ((await tds[0].innerText()) || "").replace(/\s+/g, " ").trim();
    const name = cleanName(nameRaw);
    if (!name) continue;

    // item icon
    let icon = "";
    const img0 = await tds[0].$("img");
    if (img0) icon = normalizeUrl((await img0.getAttribute("src")) || "");

    // value cell: amount/unit/unitIcon
    const { amountText, unit, unitIcon } = await extractValueCellInfo(tds[valueColIndex]);
    const amount = parseCompactNumber(amountText);

    // tooltip hover to get exaltedValue (best effort)
    let exaltedValue = null;
    try {
      // try hover on value cell (or one of its imgs)
      const imgs = await tds[valueColIndex].$$("img");
      if (imgs.length) {
        // hover last icon (usually the currency icon)
        await imgs[imgs.length - 1].hover({ timeout: 5000 });
      } else {
        await tds[valueColIndex].hover({ timeout: 5000 });
      }

      await page.waitForTimeout(120);
      const tip = await getTooltipText(page);
      exaltedValue = parseExaltedFromTooltip(tip);
    } catch {
      exaltedValue = null;
    }

    lines.push({
      section: sectionKey,
      name,
      icon,
      amount: amount ?? null,
      unit: cleanName(unit || ""),
      unitIcon: normalizeUrl(unitIcon || ""),
      exaltedValue: (exaltedValue !== null && Number.isFinite(exaltedValue)) ? exaltedValue : null
    });
  }

  const okCount = lines.filter(x => x.exaltedValue !== null).length;
  console.log(`[${sectionKey}] OK -> ${lines.length} lines | exaltedValue=${okCount}`);

  return { ok: true, lines, baseIcon: exaltIcon };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  });

  // Sections requested + slug fallbacks
  const sections = [
    { key: "currency", slugs: ["currency"] },
    { key: "fragments", slugs: ["fragments"] },
    { key: "abyssalBones", slugs: ["abyssal-bones", "abyssalbones"] },
    { key: "uncutGems", slugs: ["uncut-gems", "uncutgems"] },
    { key: "lineageGems", slugs: ["lineage-support-gems", "lineagegems"] },
    { key: "essences", slugs: ["essences"] },
    { key: "soulCores", slugs: ["soul-cores", "soulcores"] },
    { key: "idols", slugs: ["idols"] },
    { key: "runes", slugs: ["runes"] },
    { key: "omens", slugs: ["omens"] },
    { key: "expedition", slugs: ["expedition"] },
    { key: "liquidEmotions", slugs: ["liquid-emotions", "liquidemotions"] },
    { key: "catalyst", slugs: ["breach-catalyst", "catalysts"] },
  ];

  const outSections = {};
  let baseIcon = "";

  for (const sec of sections) {
    let done = false;
    for (const slug of sec.slugs) {
      const url = `${BASE}/poe2/economy/${LEAGUE}/${slug}`;
      const res = await scrapeSection(page, sec.key, url);
      if (res.ok && res.lines.length) {
        outSections[sec.key] = res.lines;
        if (!baseIcon && res.baseIcon) baseIcon = res.baseIcon;
        done = true;
        break;
      }
    }
    if (!done) outSections[sec.key] = [];
  }

  await browser.close();

  // flat lines (compat)
  const flat = Object.values(outSections).flat();

  const out = {
    updatedAt: new Date().toISOString(),
    league: LEAGUE,
    sourceBase: `${BASE}/poe2/economy/${LEAGUE}/`,
    base: "Exalted Orb",
    baseIcon,
    sections: outSections,
    lines: flat
  };

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/prices.json", JSON.stringify(out, null, 2), "utf8");

  console.log(`\nDONE ✅ sections=${Object.keys(outSections).length} | totalLines=${flat.length}`);
})();
