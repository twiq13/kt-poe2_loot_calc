/* ==========================================
   PoE2 Build Assistant (client-side)
   STEP 1: Robust uniques parsing by archetype
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

/* ---------------- Proxy config ---------------- */
const PROXY_BASE = "https://poe2-proxy-kt.datrise13.workers.dev/?url=";

function proxify(url) {
  return PROXY_BASE + encodeURIComponent(url);
}

/* ---------------- Sources ---------------- */
const SKILLS_URL  = "https://poe2db.tw/us/Skill_Gems";
const UNIQUES_URL = "https://poe2db.tw/us/Unique_item";

const CACHE_SKILLS  = "poe2_skills_v2";
const CACHE_UNIQUES = "poe2_uniques_v2";

/* ---------------- Fetch helpers ---------------- */
async function fetchHtml(url) {
  const res = await fetch(proxify(url));
  if (!res.ok) throw new Error("Fetch failed");
  return await res.text();
}

function htmlToDoc(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

/* ---------------- Parsing: Skill Gems ---------------- */
function parseSkillGems(html) {
  const doc = htmlToDoc(html);
  const rows = Array.from(doc.querySelectorAll("table tr"));
  const out = [];

  for (const tr of rows) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 2) continue;

    const name = tds[1].textContent.trim();
    if (!name) continue;

    const text = tr.textContent;
    const tags = extractTags(text);

    out.push({ name, tags });
  }
  return dedupeByName(out);
}

/* ---------------- Parsing: Uniques (ROBUST) ----------------
   We only extract:
   - name
   - inferred weapon compatibility
------------------------------------------------------------- */
function parseUniques(html) {
  const doc = htmlToDoc(html);
  const out = [];

  const links = Array.from(doc.querySelectorAll("a"));
  for (const a of links) {
    const name = a.textContent?.trim();
    if (!name || name.length < 3) continue;

    const href = a.getAttribute("href") || "";
    if (!href.includes("/Unique")) continue;

    const context = a.parentElement?.textContent || "";
    const gear = inferGearFromText(context + " " + name);

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
  if (!m) return [];
  return m[1].split(",").map(t => t.trim());
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
  return "generic";
}

function compatible(archetype, gear) {
  if (archetype === "Bow") return gear === "bow";
  if (archetype === "Crossbow") return gear === "crossbow";
  if (archetype === "Melee") return ["sword","axe","mace","dagger","staff"].includes(gear);
  if (archetype === "Spell") return ["staff","dagger"].includes(gear);
  if (archetype === "Minion") return true;
  return false;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

/* ---------------- Render helpers ---------------- */
function renderList(el, items, renderer) {
  el.innerHTML = "";
  if (!items.length) {
    el.innerHTML = `<div class="muted">No results</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const it of items.slice(0, 40)) {
    const d = document.createElement("div");
    d.innerHTML = renderer(it);
    frag.appendChild(d.firstElementChild);
  }
  el.appendChild(frag);
}

/* ---------------- Load data ---------------- */
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
  } catch (e) {
    setStatus("Error loading data");
    return null;
  }

  setStatus(`Loaded: ${uniques.length} uniques, ${skills.length} skill gems`);
  return { skills, uniques };
}

/* ---------------- Main logic ---------------- */
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
        <div class="result-title">${escapeHtml(u.name)}</div>
        <div class="result-meta">weapon: ${u.gear}</div>
      </div>
    </div>
  `);

  renderList($("skillsList"), DATA.skills, s => `
    <div class="result-item">
      <div class="result-icon"></div>
      <div>
        <div class="result-title">${escapeHtml(s.name)}</div>
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
