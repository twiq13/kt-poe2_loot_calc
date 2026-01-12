/* ==========================================
   PoE2 Build Assistant (client-side)
   STEP 1b: FIX uniques parsing (real poe2db structure)
   ========================================== */

const $ = (id) => document.getElementById(id);

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg;
  console.log(msg);
}

/* ---------------- Cache helpers ---------------- */
function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function cacheSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/* ---------------- Proxy ---------------- */
const PROXY_BASE = "https://poe2-proxy-kt.datrise13.workers.dev/?url=";
const proxify = (url) => PROXY_BASE + encodeURIComponent(url);

/* ---------------- Sources ---------------- */
const SKILLS_URL  = "https://poe2db.tw/us/Skill_Gems";
const UNIQUES_URL = "https://poe2db.tw/us/Unique_item";

const CACHE_SKILLS  = "poe2_skills_v3";
const CACHE_UNIQUES = "poe2_uniques_v3";

/* ---------------- Fetch ---------------- */
async function fetchHtml(url) {
  const res = await fetch(proxify(url));
  if (!res.ok) throw new Error("Fetch failed");
  return await res.text();
}

const htmlToDoc = (html) =>
  new DOMParser().parseFromString(html, "text/html");

/* ---------------- Skill Gems ---------------- */
function parseSkillGems(html) {
  const doc = htmlToDoc(html);
  const rows = Array.from(doc.querySelectorAll("table tr"));
  const out = [];

  for (const tr of rows) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 2) continue;

    const name = tds[1].textContent.trim();
    if (!name) continue;

    const tags = extractTags(tr.textContent);
    out.push({ name, tags });
  }
  return dedupeByName(out);
}

/* ---------------- Uniques (FIXED) ----------------
   Strategy:
   - grab ALL links with visible text
   - filter by text length + capitalization
   - infer weapon from surrounding text
-------------------------------------------------- */
function parseUniques(html) {
  const doc = htmlToDoc(html);
  const out = [];

  const links = Array.from(doc.querySelectorAll("a"));

  for (const a of links) {
    const name = a.textContent?.trim();
    if (!name) continue;

    // Unique item names are Title Case and reasonably long
    if (name.length < 4 || name.length > 60) continue;
    if (!/^[A-Z]/.test(name)) continue;

    const context =
      (a.closest("tr")?.textContent || "") +
      " " +
      (a.parentElement?.textContent || "");

    const gear = inferGearFromText(context + " " + name);

    // discard totally generic garbage
    if (gear === "unknown") continue;

    out.push({ name, gear });
  }

  return dedupeByName(out);
}

/* ---------------- Utilities ---------------- */
function dedupeByName(arr) {
  const map = new Map();
  for (const x of arr) {
    const k = x.name.toLowerCase();
    if (!map.has(k)) map.set(k, x);
  }
  return Array.from(map.values());
}

function extractTags(text) {
  const m = text.match(/([A-Z][A-Za-z]+(?:,\s*[A-Z][A-Za-z]+)+)/);
  return m ? m[1].split(",").map(t => t.trim()) : [];
}

function inferGearFromText(s) {
  const t = s.toLowerCase();
  if (t.includes("bow")) return "bow";
  if (t.includes("crossbow")) return "crossbow";
  if (t.includes("staff")) return "staff";
  if (t.includes("sword")) return "sword";
  if (t.includes("axe")) return "axe";
  if (t.includes("mace")) return "mace";
  if (t.includes("dagger")) return "dagger";
  if (t.includes("shield")) return "shield";
  return "unknown";
}

function compatible(archetype, gear) {
  if (archetype === "Bow") return gear === "bow";
  if (archetype === "Crossbow") return gear === "crossbow";
  if (archetype === "Melee")
    return ["sword","axe","mace","dagger","staff"].includes(gear);
  if (archetype === "Spell")
    return ["staff","dagger"].includes(gear);
  if (archetype === "Minion") return true;
  return false;
}

const esc = (s) =>
  s.replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])
  );

/* ---------------- Render ---------------- */
function renderList(el, items, render) {
  el.innerHTML = "";
  if (!items.length) {
    el.innerHTML = `<div class="muted">No results</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const it of items.slice(0, 40)) {
    const d = document.createElement("div");
    d.innerHTML = render(it);
    frag.appendChild(d.firstElementChild);
  }
  el.appendChild(frag);
}

/* ---------------- Load ---------------- */
async function loadData(force=false) {
  setStatus("Loading data…");

  let skills = !force ? cacheGet(CACHE_SKILLS) : null;
  let uniques = !force ? cacheGet(CACHE_UNIQUES) : null;

  try {
    if (!skills) {
      skills = parseSkillGems(await fetchHtml(SKILLS_URL));
      cacheSet(CACHE_SKILLS, skills);
    }
    if (!uniques) {
      uniques = parseUniques(await fetchHtml(UNIQUES_URL));
      cacheSet(CACHE_UNIQUES, uniques);
    }
  } catch {
    setStatus("Error loading data");
    return null;
  }

  setStatus(`Loaded: ${uniques.length} uniques, ${skills.length} skill gems`);
  return { skills, uniques };
}

/* ---------------- Main ---------------- */
let DATA = null;

async function runSearch() {
  if (!DATA) DATA = await loadData(false);
  if (!DATA) return;

  const archetype = $("tagArchetype").value;

  const uniques = DATA.uniques.filter(u =>
    compatible(archetype, u.gear)
  );

  renderList($("uniquesList"), uniques, u => `
    <div class="result-item">
      <div class="result-icon"></div>
      <div>
        <div class="result-title">${esc(u.name)}</div>
        <div class="result-meta">weapon: ${u.gear}</div>
      </div>
    </div>
  `);

  renderList($("skillsList"), DATA.skills, s => `
    <div class="result-item">
      <div class="result-icon"></div>
      <div>
        <div class="result-title">${esc(s.name)}</div>
        <div class="result-meta">${(s.tags||[]).join(", ")}</div>
      </div>
    </div>
  `);
}

/* ---------------- Boot ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  $("btnSearch").addEventListener("click", runSearch);
  $("btnRefresh").addEventListener("click", async () => {
    localStorage.clear();
    DATA = await loadData(true);
  });

  DATA = await loadData(false);
});
