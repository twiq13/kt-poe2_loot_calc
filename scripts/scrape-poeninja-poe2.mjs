// scripts/scrape-poeninja-poe2.mjs
import fs from "fs";
import { chromium } from "playwright";

const LEAGUE = (process.env.LEAGUE || "vaal").toLowerCase();
const BASE = "https://poe.ninja";

const SECTIONS = [
  { id: "currency", label: "Currency", slug: "currency" },
  { id: "fragments", label: "Fragments", slug: "fragments" },
  { id: "abyssalBones", label: "Abyssal Bones", slug: "abyssal-bones" },
  { id: "uncutGems", label: "Uncut Gems", slug: "uncut-gems" },
  { id: "lineageGems", label: "Lineage Gems", slug: "lineage-support-gems" },
  { id: "essences", label: "Essences", slug: "essences" },
  { id: "soulCores", label: "Soul Cores", slug: "soul-cores" },
  { id: "idols", label: "Idols", slug: "idols" },
  { id: "runes", label: "Runes", slug: "runes" },
  { id: "omens", label: "Omens", slug: "omens" },
  { id: "expedition", label: "Expedition", slug: "expedition" },
  { id: "liquidEmotions", label: "Liquid Emotions", slug: "liquid-emotions" },
  { id: "catalyst", label: "Catalyst", slug: "breach-catalyst" },
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

async function getValueColIndex(page) {
  return await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll("table thead th"));
    return ths.findIndex(th => (th.innerText || "").trim().toLowerCase() === "value");
  });
}

async function scrapeSection(page, sec) {
  const url = `https://poe.ninja/poe2/economy/${LEAGUE}/${sec.slug}?value=exalted`;
  console.log(`=== Section: ${sec.label} -> ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("table tbody tr", { timeout: 60000 });

  const valueCol = await getValueColIndex(page);
  if (valueCol < 0) throw new Error('Could not find "Value" column.');

  const rows = await page.$$("table tbody tr");
  const out = [];

  for (const tr of rows) {
    const tds = await tr.$$("td");
    if (tds.length <= valueCol) continue;

    const nameRaw = ((await tds[0].innerText()) || "").replace(/\s+/g, " ").trim();
    const name = cleanName(nameRaw);
    if (!name) continue;

    let icon = "";
    const img0 = await tds[0].$("img");
    if (img0) icon = normalizeUrl((await img0.getAttribute("src")) || "");

    const valueText = ((await tds[valueCol].innerText()) || "").replace(/\s+/g, " ").trim();
    const token = valueText.split(" ").find(x => /^[0-9]/.test(x)) || null;
    const exVal = parseCompactNumber(token);

    if (exVal === null) continue;

    out.push({
      section: sec.id,
      name,
      icon,
      exaltedValue: exVal
    });
  }

  console.log(`Done: rows=${rows.length} kept=${out.length}`);
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  });

  let lines = [];
  for (const sec of SECTIONS) {
    const part = await scrapeSection(page, sec);
    lines.push(...part);
  }

  // find icons + divine rate
  const byName = new Map(lines.map(x => [x.name.toLowerCase(), x]));
  const exalt = byName.get("exalted orb");
  const divine = byName.get("divine orb");

  const baseIcon = exalt?.icon || "";
  const divineInEx = divine?.exaltedValue || null;

  await browser.close();

  const out = {
    updatedAt: new Date().toISOString(),
    league: LEAGUE,
    sourceBase: `https://poe.ninja/poe2/economy/${LEAGUE}`,
    valueDisplay: "exalted",
    base: "Exalted Orb",
    baseIcon,
    divineInEx, // IMPORTANT: 1 Divine = X Exalted (direct from value=exalted)
    sections: SECTIONS,
    lines
  };

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/prices.json", JSON.stringify(out, null, 2), "utf8");

  console.log(`TOTAL lines=${lines.length}`);
  console.log(`Divine Orb exaltedValue (1 Div in Ex) = ${divineInEx}`);
})();
