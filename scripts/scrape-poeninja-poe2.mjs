// scripts/scrape-poeninja-poe2.mjs
import fs from "fs";
import { chromium } from "playwright";

const LEAGUE = (process.env.LEAGUE || "vaal").toLowerCase();
const BASE = "https://poe.ninja";

// Toutes les sections UI (slug poe.ninja + id pour ton app)
const SECTIONS = [
  { id: "currency",        label: "Currency",        slug: "currency" },
  { id: "fragments",       label: "Fragments",       slug: "fragments" },
  { id: "abyssalBones",    label: "Abyssal Bones",   slug: "abyssal-bones" },
  { id: "uncutGems",       label: "Uncut Gems",      slug: "uncut-gems" },
  { id: "lineageGems",     label: "Lineage Gems",    slug: "lineage-support-gems" },
  { id: "essences",        label: "Essences",        slug: "essences" },
  { id: "soulCores",       label: "Soul Cores",      slug: "soul-cores" },
  { id: "idols",           label: "Idols",           slug: "idols" },
  { id: "runes",           label: "Runes",           slug: "runes" },
  { id: "omens",           label: "Omens",           slug: "omens" },
  { id: "expedition",      label: "Expedition",      slug: "expedition" },
  { id: "liquidEmotions",  label: "Liquid Emotions", slug: "liquid-emotions" },
  { id: "catalyst",        label: "Catalyst",        slug: "breach-catalyst" },
];

function cleanName(name) {
  return String(name || "").replace(/\s*WIKI\s*$/i, "").trim();
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

function normalizeUrl(u) {
  if (!u) return "";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  if (u.startsWith("//")) return "https:" + u;
  if (u.startsWith("/")) return BASE + u;
  return u;
}

// Scrape une page (1 section)
async function scrapeSection(page, section) {
  const url = `${BASE}/poe2/economy/${LEAGUE}/${section.slug}`;
  console.log(`=== Section: ${section.label} -> ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // attendre table
  await page.waitForSelector("table thead th", { timeout: 60000 });
  await page.waitForSelector("table tbody tr", { timeout: 60000 });
  await page.waitForTimeout(800);

  const valueColIndex = await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll("table thead th"));
    return ths.findIndex(th => (th.innerText || "").trim().toLowerCase() === "value");
  });

  if (valueColIndex < 0) {
    console.log("!! Value column not found, skipping section.");
    return { url, rows: [], valueColIndex: -1 };
  }

  const rows = await page.evaluate(({ valueColIndex }) => {
    const out = [];

    const getText = (el) => (el?.innerText || "").replace(/\s+/g, " ").trim();
    const norm = (u) => u || "";

    const trs = Array.from(document.querySelectorAll("table tbody tr"));
    for (const tr of trs) {
      const tds = Array.from(tr.querySelectorAll("td"));
      if (!tds.length || tds.length <= valueColIndex) continue;

      const nameRaw = getText(tds[0]);
      const name = nameRaw;
      if (!name) continue;

      const icon = tds[0].querySelector("img")?.getAttribute("src") || "";

      const vCell = tds[valueColIndex];

      // On récupère le 1er nombre visible (amount)
      const vText = getText(vCell);
      const token = vText.split(" ").find(x => /^[0-9]/.test(x)) || "";
      const amount = token;

      // unit + unitIcon (souvent l’icône dans la cellule value)
      // On prend le dernier img de la cellule Value comme "unit"
      const imgs = Array.from(vCell.querySelectorAll("img"));
      const unitIcon = imgs.length ? (imgs[imgs.length - 1].getAttribute("src") || "") : "";

      // On tente de lire un "alt/title/aria-label" pour obtenir le nom de l’unité
      const unit =
        imgs.length
          ? (imgs[imgs.length - 1].getAttribute("alt")
            || imgs[imgs.length - 1].getAttribute("title")
            || imgs[imgs.length - 1].getAttribute("aria-label")
            || "")
          : "";

      out.push({
        name,
        icon: norm(icon),
        amount,
        unit: unit || "",       // peut être vide selon poe.ninja
        unitIcon: norm(unitIcon)
      });
    }

    return out;
  }, { valueColIndex });

  // Parse numbers + clean
  const parsed = rows.map(r => ({
    section: section.id,
    name: cleanName(r.name),
    icon: normalizeUrl(r.icon),
    amount: parseCompactNumber(r.amount),
    unit: cleanName(r.unit || ""),
    unitIcon: normalizeUrl(r.unitIcon),
    exaltedValue: null
  })).filter(x => x.name && x.amount !== null);

  return { url, rows: parsed, valueColIndex };
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  });

  // ⚡ speed: bloquer images/fonts/styles inutiles (on garde quand même le HTML + quelques images en src)
  await page.route("**/*", (route) => {
    const rt = route.request().resourceType();
    if (rt === "font" || rt === "media") return route.abort();
    return route.continue();
  });

  const allLines = [];
  let baseIcon = "";
  let currencyUrl = "";

  for (const sec of SECTIONS) {
    const { url, rows } = await scrapeSection(page, sec);
    if (sec.id === "currency") currencyUrl = url;

    // baseIcon = icône de Exalted Orb (uniquement dans currency)
    if (sec.id === "currency" && !baseIcon) {
      const exRow = rows.find(x => x.name.toLowerCase() === "exalted orb");
      baseIcon = exRow?.icon || "";
    }

    allLines.push(...rows);
    console.log(`Done: rows=${rows.length}`);
  }

  await browser.close();

  // ===== POST-PROCESS: calculer exaltedValue pour TOUT =====
  // 1 Ex = X Chaos => pris depuis "Exalted Orb" si unité Chaos
  const currencyLines = allLines.filter(x => x.section === "currency");

  const exRow = currencyLines.find(x => x.name.toLowerCase() === "exalted orb");
  const divRow = currencyLines.find(x => x.name.toLowerCase() === "divine orb");

  let exChaos = null;      // Chaos per Ex
  let divineInEx = null;   // Ex per Divine

  if (exRow && exRow.unit.toLowerCase() === "chaos orb" && exRow.amount > 0) {
    exChaos = exRow.amount;
  }

  // Divine -> Ex : soit direct, soit via chaos / exChaos
  if (divRow) {
    if (divRow.unit.toLowerCase() === "exalted orb" && divRow.amount > 0) {
      divineInEx = divRow.amount;
    } else if (divRow.unit.toLowerCase() === "chaos orb" && divRow.amount > 0 && exChaos) {
      divineInEx = divRow.amount / exChaos;
    }
  }

  // Calcul exaltedValue item par item
  for (const it of allLines) {
    const u = (it.unit || "").toLowerCase();

    if (u === "exalted orb") {
      it.exaltedValue = it.amount;
    } else if (u === "chaos orb" && exChaos) {
      it.exaltedValue = it.amount / exChaos;
    } else if (u === "divine orb" && divineInEx) {
      it.exaltedValue = it.amount * divineInEx;
    } else {
      it.exaltedValue = null;
    }
  }

  const out = {
    updatedAt: new Date().toISOString(),
    league: LEAGUE,
    source: currencyUrl || `${BASE}/poe2/economy/${LEAGUE}/currency`,
    base: "Exalted Orb",
    baseIcon: baseIcon || "",
    exChaos: exChaos ?? null,
    divineInEx: divineInEx ?? null,
    sections: SECTIONS.map(s => ({ id: s.id, label: s.label, slug: s.slug })),
    lines: allLines
  };

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/prices.json", JSON.stringify(out, null, 2), "utf8");

  const exFound = allLines.filter(x => typeof x.exaltedValue === "number").length;
  console.log(`OK -> sections=${SECTIONS.length} items=${allLines.length} exaltedValue=${exFound} exChaos=${exChaos} divineInEx=${divineInEx}`);
})();
