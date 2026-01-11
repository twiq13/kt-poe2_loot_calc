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

async function getValueColumnIndex(page) {
  return await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll("table thead th"));
    return ths.findIndex(th => (th.innerText || "").trim().toLowerCase() === "value");
  });
}

/**
 * Force "Value Display" -> "Exalted Orb"
 * Méthode robuste:
 * - trouver le bloc qui contient le texte "Value Display"
 * - cliquer le control (dropdown)
 * - taper "Exalted Orb" + Enter
 * - vérifier que la valeur de Divine Orb devient > 100 (sinon retry)
 */
async function forceValueDisplayExalted(page) {
  const desired = "Exalted Orb";

  for (let attempt = 1; attempt <= 4; attempt++) {
    // Clique le control proche du texte "Value Display"
    const container = page.locator("div", { hasText: "Value Display" }).first();

    // Plusieurs UI possibles : on clique dans le container puis on utilise clavier
    await container.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);

    // si dropdown pas ouvert, parfois il faut cliquer un élément frère (le select)
    // on tente un clic un peu à droite du container
    const box = await container.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.click(box.x + box.width - 10, box.y + box.height - 10).catch(() => {});
    }

    await page.waitForTimeout(250);

    // Taper au clavier puis Enter (react-select / listbox)
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.type(desired, { delay: 30 }).catch(() => {});
    await page.keyboard.press("Enter").catch(() => {});

    // Attendre que la table se recalcul
    await page.waitForTimeout(900);

    // Vérif: lire la valeur de Divine Orb dans la table (section currency uniquement)
    // (si la table est en Exalted, Divine vaut souvent plusieurs centaines Ex)
    const divineVal = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      const row = rows.find(r => (r.innerText || "").toLowerCase().includes("divine orb"));
      if (!row) return null;

      const tds = Array.from(row.querySelectorAll("td"));
      // on prend la cellule "Value" en trouvant l'entête
      const ths = Array.from(document.querySelectorAll("table thead th"));
      const idx = ths.findIndex(th => (th.innerText || "").trim().toLowerCase() === "value");
      if (idx < 0 || !tds[idx]) return null;

      const txt = (tds[idx].innerText || "").replace(/\s+/g, " ").trim();
      const token = txt.split(" ").find(x => /^[0-9]/.test(x));
      return token || null;
    });

    const divineParsed = parseCompactNumber(divineVal);

    // Si Divine devient > 100, on considère que c'est bien en Exalted
    if (divineParsed && divineParsed > 100) {
      console.log(`Value Display OK ✅ (Divine ~ ${divineParsed} Ex)`);
      return true;
    }

    console.log(`Value Display retry ${attempt}/4 (Divine token="${divineVal}" parsed=${divineParsed})`);
  }

  console.log("⚠️ Could not force Value Display to Exalted (continuing anyway).");
  return false;
}

async function getBaseExaltedIconFromValueCell(page, valueColIndex) {
  try {
    const src = await page.evaluate((idx) => {
      const tr = document.querySelector("table tbody tr");
      if (!tr) return "";
      const td = tr.querySelectorAll("td")[idx];
      if (!td) return "";
      const imgs = td.querySelectorAll("img");
      const last = imgs[imgs.length - 1];
      return last ? (last.getAttribute("src") || "") : "";
    }, valueColIndex);
    return normalizeUrl(src);
  } catch {
    return "";
  }
}

async function scrapeSection(page, section) {
  const url = `https://poe.ninja/poe2/economy/${LEAGUE}/${section.slug}`;
  console.log(`=== Section: ${section.label} -> ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("table thead th", { timeout: 60000 });
  await page.waitForSelector("table tbody tr", { timeout: 60000 });

  // Force Value Display
  await forceValueDisplayExalted(page);

  const valueColIndex = await getValueColumnIndex(page);
  if (valueColIndex < 0) throw new Error(`Value column not found in section ${section.id}`);

  const baseIcon = await getBaseExaltedIconFromValueCell(page, valueColIndex);

  const rows = await page.$$("table tbody tr");
  const max = Math.min(rows.length, 450);

  const lines = [];
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

    const valueText = ((await tds[valueColIndex].innerText()) || "").replace(/\s+/g, " ").trim();
    const token = valueText.split(" ").find(x => /^[0-9]/.test(x)) || null;
    const exVal = parseCompactNumber(token);

    if (exVal === null) continue;

    lines.push({
      section: section.id,
      name,
      icon,
      amount: exVal,
      unit: "Exalted Orb",
      unitIcon: baseIcon,
      exaltedValue: exVal,
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

  const divine = allLines.find(
    x => x.section === "currency" && x.name.toLowerCase() === "divine orb"
  );
  console.log(`TOTAL lines=${allLines.length}`);
  console.log(`Divine Orb exaltedValue = ${divine?.exaltedValue ?? "NOT FOUND"}`);
})();
