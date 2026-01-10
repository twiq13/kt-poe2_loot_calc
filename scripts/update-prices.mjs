import fs from "fs";

const LEAGUE = "vaal"; // mets "vaal" si tu veux la ligue vaal
const URL = `https://poe.ninja/poe2/economy/${LEAGUE}/currency`;

function stripTags(html) {
  return (html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumberBefore(text, token) {
  // ex: "2.4 Divine Orb" => 2.4
  const re = new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*${token}`, "i");
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}

const res = await fetch(URL, {
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Accept": "text/html,*/*",
  },
});

const html = await res.text();

if (!html || html.length < 5000) {
  console.error("HTML trop petit / bloqué. First 500 chars:\n", html.slice(0, 500));
  process.exit(1);
}

// 1) Récupérer toutes les lignes de tableau
const rowMatches = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);

const lines = [];

for (const rowHtml of rowMatches) {
  const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
  if (tds.length < 2) continue;

  // 2) Nom : souvent dans la 1ère colonne
  const nameText = stripTags(tds[0]);
  if (!nameText || nameText.toLowerCase() === "currency") continue;

  // 3) Chercher une colonne contenant "Divine Orb" ou "Exalted Orb"
  const allColsText = tds.map(stripTags);

  let divinePrice = null;
  let exaltPrice = null;

  for (const col of allColsText) {
    if (divinePrice === null && /Divine Orb/i.test(col)) {
      divinePrice = parseNumberBefore(col, "Divine Orb");
    }
    if (exaltPrice === null && /Exalted Orb/i.test(col)) {
      exaltPrice = parseNumberBefore(col, "Exalted Orb");
    }
  }

  // On garde au moins une des 2 valeurs
  if (divinePrice === null && exaltPrice === null) continue;

  lines.push({
    name: nameText,
    divinePrice,
    exaltPrice,
  });
}

if (!lines.length) {
  console.error("Aucune ligne parsée. Possible changement HTML poe.ninja.");
  console.error("First 800 chars:\n", html.slice(0, 800));
  process.exit(1);
}

const out = {
  updatedAt: new Date().toISOString(),
  source: URL,
  league: LEAGUE,
  lines,
};

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/prices.json", JSON.stringify(out, null, 2), "utf8");

console.log(`OK -> ${lines.length} currencies écrites dans data/prices.json`);
