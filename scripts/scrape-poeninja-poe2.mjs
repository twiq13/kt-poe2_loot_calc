// scripts/scrape-poeninja-poe2.mjs
import fs from "fs";
import { chromium } from "playwright";

const LEAGUE = (process.env.LEAGUE || "vaal").toLowerCase();
const BASE = "https://poe.ninja";

const SECTIONS = [
  { id: "currency",       label: "Currency",        slug: "currency" },
  { id: "fragments",      label: "Fragments",       slug: "fragments" },
  { id: "abyssalBones",   label: "Abyssal Bones",   slug: "abyssal-bones" },
  { id: "uncutGems",      label: "Uncut Gems",      slug: "uncut-gems" },
  { id: "lineageGems",    label: "Lineage Gems",    slug: "lineage-support-gems" },
  { id: "essences",       label: "Essences",        slug: "essences" },
  { id: "soulCores",      label: "Soul Cores",      slug: "soul-cores" },
  { id: "idols",          label: "Idols",           slug: "idols" },
  { id: "runes",          label: "Runes",           slug: "runes" },
  { id: "omens",          label: "Omens",           slug: "omens" },
  { id: "expedition",     label: "Expedition",      slug: "expedition" },
  { id: "liquidEmotions", label: "Liquid Emotions", slug: "liquid-emotions" },
  { id: "catalyst",       label: "Catalyst",        slug: "breach-catalyst" },
];

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

async function findValueColIndex(page) {
  return await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll("table thead th"));
    return ths.findIndex(th => (th.innerText || "").trim().toLowerCase() === "value");
  });
}

/**
 * Force the UI filter "Value Display" to "Exalted Orb"
 * Works on poe.ninja pages using a combobox/listbox style dropdown.
 */
async function forceValueDisplayExalted(page) {
  // Try a few selector strategies (poe.ninja UI can change)
  const candidates = [
    // Often a labeled region with "Value Display"
    'text=Value Display',
    '[aria-label="Value Display"]',
  ];

  // 1) Click the container that includes "Value Display"
  // We'll try to open the dropdown by clicking near the label.
  let opened = false;

  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      try {
        // click on label then press Enter to open
        await el.click({ timeout: 2000 });
        await page.keyboard.press("Enter");
        opened = true;
        break;
      } catch {}
    }
  }

  // 2) If not opened, try clicking a combobox directly
  if (!opened) {
    const combo = page.locator('[role="combobox"]').first();
    try {
      if (await combo.count()) {
        await combo.click({ timeout: 2000 });
        opened = true;
      }
    } catch {}
  }

  // 3) Select "Exalted Orb" in dropdown (listbox/menu)
  // We use text matching.
  const option = page.locator('text=Exalted Orb').first();
  if (await option.count()) {
    try {
      await option.click({ timeout: 4000 });
      await page.waitForTimeout(300);
      return true;
    } catch {}
  }

  // 4) Fallback: type in the combobox if editable
  try {
    const combo = page.locator('[role="combobox"]').first();
    if (await combo.count()) {
      await combo.fill("Exalted Orb");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      return true;
    }
  } catch {}

  return false; // not fatal
}

async function scrapeSection(page, sec) {
  const url = `${BASE}/poe2/economy/${LEAGUE}/${sec.slug}`;
  console.log(`=== Section: ${sec.label} -> ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("table thead th", { timeout: 60000 });
  await page.waitForSelector("table tbody tr", { timeout: 60000 });

  // Force Value Display = Exalted Orb
  await forceValueDisplayExalted(page);

  // Wait a bit for table rerender
  await page.waitForTimeout(600);

  const valueColIndex = await findValueColIndex(page);
  if (valueColIndex < 0) return { url, lines: [] };

  const raw = await page.evaluate(({ valueColIndex }) => {
    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

    const trs = Array.from(document.querySelectorAll("table tbody tr"));
    const out = [];

    for (const tr of trs) {
      const tds = Array.from(tr.querySelectorAll("td"));
      if (!tds.length || tds.length <= valueColIndex) continue;

      const name = norm(tds[0].innerText);
      if (!name) continue;

      const icon = tds[0].querySelector("img")?.getAttribute("src") || "";

      const vCell = tds[valueColIndex];
      const vText = norm(vCell.innerText);

      // first numeric token is the displayed value (now Exalted)
      const tok = vText.split(" ").find(x => /^[0-9]/.test(x)) || "";
      const amount = tok || "";

      // unit icon: in Exalted display it usually contains Exalted icon inside cell
      const imgs = Array.from(vCell.querySelectorAll("img"));
      // try to pick the "target" icon (last one usually)
      const unitIcon = (imgs[imgs.length - 1]?.getAttribute("src")) || "";

      out.push({ name, icon, amount, unitIcon });
    }

    return out;
  }, { valueColIndex });

  const parsed = raw
    .map(x => ({
      section: sec.id,
      name: cleanName(x.name),
      icon: normalizeUrl(x.icon),
      amount: parseCompactNumber(x.amount),
      unit: "Exalted Orb",
      unitIcon: normalizeUrl(x.unitIcon),
      exaltedValue: null, // will set = amount
    }))
    .filter(x => x.name && x.amount !== null);

  // since table is forced in Exalted display:
  for (const it of parsed) it.exaltedValue = it.amount;

  console.log(`Done: ${sec.id} rows=${parsed.length}`);
  return { url, lines: parsed };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    viewport: { width: 1400, height: 900 },
  });

  // speed: abort heavy
  await page.route("**/*", (route) => {
    const t = route.request().resourceType();
    if (t === "font" || t === "media") return route.abort();
    route.continue();
  });

  let all = [];
  let firstUrl = "";

  for (const s of SECTIONS) {
    const r = await scrapeSection(page, s);
    if (!firstUrl) firstUrl = r.url;
    all = all.concat(r.lines);
  }

  await browser.close();

  // Determine Exalted icon + Divine rate (Div in Ex) from currency rows
  const currency = all.filter(x => x.section === "currency");
  const byName = new Map(currency.map(x => [x.name.toLowerCase(), x]));

  const exRow = byName.get("exalted orb");
  const divRow = byName.get("divine orb");

  const baseIcon = exRow?.icon || "";
  const divineIcon = divRow?.icon || "";
  const divineInEx = divRow?.exaltedValue ?? null; // now directly from display

  const out = {
    updatedAt: new Date().toISOString(),
    league: LEAGUE,
    source: firstUrl || `${BASE}/poe2/economy/${LEAGUE}/currency`,
    base: "Exalted Orb",
    baseIcon,
    divineIcon,
    divineInEx, // 1 Divine = X Ex (taken directly from forced display)
    sections: SECTIONS.map(s => ({ id: s.id, label: s.label, slug: s.slug })),
    lines: all
  };

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/prices.json", JSON.stringify(out, null, 2), "utf8");

  const exFound = all.filter(x => typeof x.exaltedValue === "number").length;
  console.log(`OK -> sections=${SECTIONS.length} items=${all.length} exaltedValue=${exFound} | 1Div=${divineInEx}Ex`);
})();
