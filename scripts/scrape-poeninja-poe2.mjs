// scripts/scrape-poeninja-poe2.mjs
import fs from "fs";
import { chromium } from "playwright";

const LEAGUE = process.env.LEAGUE || "standard"; // ex: "vaal" ou "standard"
const URL = `https://poe.ninja/poe2/economy/${LEAGUE}/currency`;

// "2.5k" => 2500, "800" => 800, "1.2" => 1.2
function parseCompactNumber(s) {
  if (!s) return null;
  const t = String(s).trim().toLowerCase().replace(/,/g, ".");
  const m = t.match(/^([0-9]+(\.[0-9]+)?)(k)?$/i);
  if (!m) return null;
  let n = Number(m[1]);
  if (m[3]) n *= 1000;
  return Number.isFinite(n) ? n : null;
}

function stripTags(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// essaie de récupérer le nom de la currency du logo dans la cellule Value
function extractIconNameFromHtml(html) {
  // alt="Exalted Orb" / title="Divine Orb" etc.
  const alt = html.match(/alt="([^"]+)"/i)?.[1];
  const title = html.match(/title="([^"]+)"/i)?.[1];
  return (alt || title || null);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  });

  console.log("Opening:", URL);

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Attendre que le tableau SPA se charge vraiment
  await page.waitForSelector("table thead th", { timeout: 60000 });
  await page.waitForSelector("table tbody tr", { timeout: 60000 });
  await page.waitForTimeout(2500);

  // Trouver l’index de la colonne "Value"
  const valueColIndex = await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll("table thead th"));
    const idx = ths.findIndex(
      (th) => (th.innerText || "").trim().toLowerCase() === "value"
    );
    return idx;
  });

  console.log("Value column index =", valueColIndex);

  if (valueColIndex < 0) {
    console.error('Impossible de trouver la colonne "Value".');
    process.exitCode = 1;
    await browser.close();
    return;
  }

  // Extraire les lignes : name + HTML de la cellule Value
  const rows = await page.evaluate((valueIdx) => {
    const trs = Array.from(document.querySelectorAll("table tbody tr"));
    return trs.slice(0, 400).map((tr) => {
      const tds = Array.from(tr.querySelectorAll("td"));
      const name = (tds[0]?.innerText || "").replace(/\s+/g, " ").trim();
      const valueHtml = tds[valueIdx]?.innerHTML || "";
      const valueText = (tds[valueIdx]?.innerText || "").replace(/\s+/g, " ").trim();
      return { name, valueHtml, valueText };
    }).filter(r => r.name);
  }, valueColIndex);

  await browser.close();

  if (!rows.length) {
    console.error("Aucune ligne trouvée dans le tableau.");
    process.exit(1);
  }

  // Parse rows -> {name, amount, unit}
  const lines = rows.map((r) => {
    // On prend en priorité innerText (plus fiable), sinon stripTags(html)
    const txt = r.valueText || stripTags(r.valueHtml);

    // Trouver le premier token qui ressemble à un nombre (ex: "2.5k" / "800" / "5.3")
    const token = txt.split(" ").find((x) => /^[0-9]/.test(x)) || null;
    const amount = parseCompactNumber(token);

    const unit = extractIconNameFromHtml(r.valueHtml); // peut être null si pas d'alt/title

    return {
      name: r.name,
      amount,
      unit,
    };
  }).filter(x => x.amount !== null);

  if (!lines.length) {
    console.error("Lignes trouvées mais aucun montant parsé.");
    console.error("Exemple:", rows[0]);
    process.exit(1);
  }

  const out = {
    updatedAt: new Date().toISOString(),
    league: LEAGUE,
    source: URL,
    lines,
  };

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/prices.json", JSON.stringify(out, null, 2), "utf8");

  console.log(`OK -> ${lines.length} currencies écrites dans data/prices.json`);
})();
