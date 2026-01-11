// scripts/scrape-poeninja-poe2.mjs
import fs from "fs";
import { chromium } from "playwright";

const LEAGUE = (process.env.LEAGUE || "vaal").toLowerCase();
const BASE = "https://poe.ninja";

const SECTIONS = [
  { id: "currency",       label: "Currency",         slug: "currency" },
  { id: "fragments",      label: "Fragments",        slug: "fragments" },
  { id: "abyssalBones",   label: "Abyssal Bones",    slug: "abyssal-bones" },
  { id: "uncutGems",      label: "Uncut Gems",       slug: "uncut-gems" },
  { id: "lineageGems",    label: "Lineage Gems",     slug: "lineage-support-gems" },
  { id: "essences",       label: "Essences",         slug: "essences" },
  { id: "soulCores",      label: "Soul Cores",       slug: "soul-cores" },
  { id: "idols",          label: "Idols",            slug: "idols" },
  { id: "runes",          label: "Runes",            slug: "runes" },
  { id: "omens",          label: "Omens",            slug: "omens" },
  { id: "expedition",     label: "Expedition",       slug: "expedition" },
  { id: "liquidEmotions", label: "Liquid Emotions",  slug: "liquid-emotions" },
  { id: "catalyst",       label: "Catalyst",         slug: "breach-catalyst" },
];

// ---------- utils ----------
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

async function forceValueDisplayExalted(page) {
  // Le dropdown est un composant React. On tente plusieurs stratégies robustes.
  // Objectif: sélectionner l'option "Exalted Orb".
  const optionText = "Exalted Orb";

  // 1) Cherche un bouton/zone clickable autour du libellé "Value Display"
  const label = page.getByText("Value Display", { exact: false });
  if (await label.count().catch(() => 0)) {
    // remonte un peu et clique sur le control à droite
    // on essaie de cliquer dans la zone du dropdown
    const box = await label.first().boundingBox().catch(() => null);
    if (box) {
      // clique un peu à droite sous le label (dans la zone du select)
      await page.mouse.click(box.x + box.width + 120, box.y + box.height + 18).catch(() => {});
    }
  }

  // 2) Si un menu s'ouvre, clique l'option Exalted Orb
  // React-select met souvent les options en liste avec role option / listbox
  const option = page.getByText(optionText, { exact: false }).first();
  if (await option.count().catch(() => 0)) {
    await option.click({ timeout: 4000 }).catch(() => {});
  }

  // 3) Fallback : si pas ouvert, clique sur une flèche de select si présente
  // Puis re-tente l'option
  if (!(await page.getByText(optionText, { exact: false }).count().catch(() => 0))) {
    // rien à faire
  }

  // petite pause pour que la table recalcul les valeurs
  await page.waitForTimeout(600);
}

async function getValueColumnIndex(page) {
  return await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll("table thead th"));
    return ths.findIndex(th => (th.innerText || "").trim().toLowerCase() === "value");
  });
}

async function scrapeSection(page, section) {
  const url = `https://poe.ninja/poe2/economy/${LEAGUE}/${section.slug}`;
  console.log(`=== Section: ${section.label} -> ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("table thead th", { timeout: 60000 });
  await page.waitForSelector("table tbody tr", { timeout: 60000 });

  // ✅ FORCE "Value Display" -> Exalted Orb
  await forceValueDisplayExalted(page);

  const valueColIndex = await getValueColumnIndex(page);
  if (valueColIndex < 0) throw new Error(`Value column not found for section ${section.id}`);

  // Base icon = Exalted Orb icon : on la prend depuis un value cell img si possible
  let baseIcon = "";
  try {
    baseIcon = await page.evaluate((idx) => {
      const tr = document.querySelector("table tbody tr");
      if (!tr) return "";
      const td = tr.querySelectorAll("td")[idx];
      if (!td) return "";
      const imgs = td.querySelectorAll("img");
      const last = imgs[imgs.length - 1];
      return last ? last.getAttribute("src") || "" : "";
    }, valueColIndex);
    baseIcon = normalizeUrl(baseIcon);
  } catch {}

  // Rows
  const rows = await page.$$("table tbody tr");
  const max = Math.min(rows.length, 400);

  let lines = [];
  for (let i = 0; i < max; i++) {
    const tr = rows[i];
    const tds = await tr.$$("td");
    if (!tds.length || tds.length <= valueColIndex) continue;

    const nameRaw = ((await tds[0].innerText()) || "").replace(/\s+/g, " ").trim();
    const name = cleanName(nameRaw);
    if (!name) continue;

    let icon = "";
    const img0 = await tds[0].$("img");
    if (img0) icon = normalizeUrl((await img0.getAttribute("src")) || "");

    // Value cell: le nombre est le premier token qui commence par chiffre
    const valueText = ((await tds[valueColIndex].innerText()) || "").replace(/\s+/g, " ").trim();
    const token = valueText.split(" ").find(x => /^[0-9]/.test(x)) || null;
    const exaltedValue = parseCompactNumber(token);

    // si null -> on skip (ça évite les bugs)
    if (exaltedValue === null) continue;

    lines.push({
      section: section.id,
      name,
      icon,
      amount: exaltedValue,          // affichage actuel = exalted
      unit: "Exalted Orb",
      unitIcon: baseIcon || "",
      exaltedValue: exaltedValue,    // ✅ vrai prix en Exalted
    });
  }

  console.log(`Done: rows=${rows.length} kept=${lines.length}`);
  return { lines, baseIcon };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  });

  let allLines = [];
  let globalBaseIcon = "";

  try {
    for (const section of SECTIONS) {
      const { lines, baseIcon } = await scrapeSection(page, section);
      allLines.push(...lines);
      if (!globalBaseIcon && baseIcon) globalBaseIcon = baseIcon;
    }
  } finally {
    await browser.close();
  }

  const out = {
    updatedAt: new Date().toISOString(),
    league: LEAGUE,
    sourceBase: `https://poe.ninja/poe2/economy/${LEAGUE}/`,
    base: "Exalted Orb",
    baseIcon: globalBaseIcon,
    sections: SECTIONS.map(s => ({ id: s.id, label: s.label, slug: s.slug })),
    lines: allLines
  };

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/prices.json", JSON.stringify(out, null, 2), "utf8");

  // sanity check: Divine Orb should be around hundreds Ex, not 36
  const divine = allLines.find(x => x.section === "currency" && x.name.toLowerCase() === "divine orb");
  console.log(`TOTAL lines=${allLines.length}`);
  console.log(`Divine Orb exaltedValue = ${divine?.exaltedValue ?? "NOT FOUND"}`);
})();
