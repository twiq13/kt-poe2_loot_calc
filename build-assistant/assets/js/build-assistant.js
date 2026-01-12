/* ==========================================
   PoE2 Build Assistant (client-side)
   - Fetch + cache poe2db pages
   - Parse tags (heuristic)
   - Filter + compatibility rules
   File: /assets/js/build-assistant.js
   ========================================== */

const $ = (id) => document.getElementById(id);

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg;
  console.log(msg);
}

// ---- Cache helpers (localStorage) ----
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
  } catch {
    // ignore quota errors
  }
}

// ---- Config ----
// Using your Cloudflare Worker as CORS proxy
// IMPORTANT: keep "?url=" at the end
const PROXY_BASE = "https://poe2-proxy-kt.datrise13.workers.dev/?url=";

function proxify(url) {
  return PROXY_BASE ? (PROXY_BASE + encodeURIComponent(url)) : url;
}

// Sources
const SKILLS_URL  = "https://poe2db.tw/us/Skill_Gems";
const UNIQUES_URL = "https://poe2db.tw/us/Unique_item";

// cache keys
const CACHE_SKILLS  = "poe2_skills_v1";
const CACHE_UNIQUES = "poe2_uniques_v1";

// ---- Fetch HTML safely ----
async function fetchHtml(url) {
  const res = await fetch(proxify(url), {
    headers: { "Accept": "text/html" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function htmlToDoc(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

// ---- Parsing ----
function parseSkillGems(html) {
  const doc = htmlToDoc(html);
  const results = [];
  const rows = Array.from(doc.querySelectorAll("table tr"));

  for (const tr of rows) {
    const tds = tr.querySelectorAll("td");
    if (!tds || tds.length < 2) continue;

    const name = (tds[1].textContent || "").trim();
    if (!name) continue;

    const rowText = tr.textContent || "";
    const tags = extractTagsFromText(rowText);

    results.push({ name, tags });
  }

  return dedupeByName(results);
}

function parseUniques(html) {
  const doc = htmlToDoc(html);
  const results = [];
  const rows = Array.from(doc.querySelectorAll("table tr"));

  for (const tr of rows) {
    const tds = tr.querySelectorAll("td");
    if (!tds || tds.length < 2) continue;

    const name = (tds[1].textContent || "").trim();
    if (!name) continue;

    const rowText = (tr.textContent || "").trim();
    const tags = extractTagsFromText(rowText);
    const gear = inferGearFromText(rowText);

    results.push({ name, tags, gear });
  }

  return dedupeByName(results);
}

// ---- Utilities ----
function dedupeByName(arr) {
  const map = new Map();
  for (const x of arr) {
    const k = (x.name || "").toLowerCase();
    if (!k) continue;
    if (!map.has(k)) map.set(k, x);
  }
  return Array.from(map.values());
}

function extractTagsFromText(s) {
  // Heuristic: detect a comma-separated tag list like "Attack, AoE, Melee, Slam"
  // Keep conservative to avoid junk.
  const maybe = (s || "")
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean)
    .join(" ");

  // Find a segment with multiple comma tokens
  const m = maybe.match(/\b([A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)*)\s*,\s*([A-Z][A-Za-z].+?)\b/);
  if (!m) return [];

  const segment = m[0];
  return segment
    .split(",")
    .map(t => t.trim())
    .filter(t => t.length >= 3 && t.length <= 24);
}

function inferGearFromText(s) {
  const lower = (s || "").toLowerCase();
  if (lower.includes("bow")) return { slot: "mainhand", weapon: "bow" };
  if (lower.includes("crossbow")) return { slot: "mainhand", weapon: "crossbow" };
  if (lower.includes("quarterstaff") || lower.includes("staff")) return { slot: "mainhand", weapon: "staff" };
  if (lower.includes("shield") || lower.includes("buckler")) return { slot: "offhand", weapon: "shield" };
  if (lower.includes("quiver")) return { slot: "offhand", weapon: "quiver" };
  return { slot: "unknown", weapon: "unknown" };
}

// Compatibility rules (minimal starter)
function isCompatible(archetype, item, strict) {
  if (!strict) return true;

  if (archetype === "Bow") {
    if (item.gear?.weapon === "shield" || item.gear?.weapon === "buckler" || item.gear?.weapon === "focus") return false;
  }
  if (archetype === "Crossbow") {
    if (item.gear?.weapon === "quiver") return false;
  }
  return true;
}

function hasAllTags(entityTags, requiredTags) {
  const set = new Set((entityTags || []).map(t => t.toLowerCase()));
  return requiredTags.every(t => set.has(t.toLowerCase()));
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

function tagsToBadges(tags = []) {
  if (!tags.length) return "";
  const safe = tags.slice(0, 8).map(t => `<span class="badge">${escapeHtml(t)}</span>`).join("");
  return `<div class="badges">${safe}</div>`;
}

function renderActiveTags(archetype, theme) {
  const el = $("activeTags");
  if (!el) return;

  el.innerHTML = `
    <span class="chip">${escapeHtml(archetype)}</span>
    <span class="chip">${escapeHtml(theme)}</span>
  `;
}

// ---- Data loading ----
async function loadData(force = false) {
  setStatus("Loading data…");

  let skills = !force ? cacheGet(CACHE_SKILLS) : null;
  let uniques = !force ? cacheGet(CACHE_UNIQUES) : null;

  try {
    if (!skills) {
      const html = await fetchHtml(SKILLS_URL);
      skills = parseSkillGems(html);
      cacheSet(CACHE_SKILLS, skills);
    }
    if (!uniques) {
      const html = await fetchHtml(UNIQUES_URL);
      uniques = parseUniques(html);
      cacheSet(CACHE_UNIQUES, uniques);
    }
  } catch (e) {
    console.error(e);
    setStatus("Error: fetch blocked or parse failed. Check console.");
    return null;
  }

  setStatus(`Loaded: ${uniques.length} uniques, ${skills.length} skill gems`);
  return { skills, uniques };
}

// ---- Render ----
function renderList(el, items, formatter) {
  if (!el) return;

  el.innerHTML = "";
  if (!items.length) {
    el.innerHTML = `<div class="muted">No results</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const it of items.slice(0, 50)) {
    const wrap = document.createElement("div");
    wrap.innerHTML = formatter(it);
    if (wrap.firstElementChild) frag.appendChild(wrap.firstElementChild);
  }
  el.appendChild(frag);
}

// ---- Main ----
let DATA = null;

async function runSearch() {
  if (!DATA) DATA = await loadData(false);
  if (!DATA) return;

  const archetype = $("tagArchetype")?.value || "Bow";
  const theme = $("tagTheme")?.value || "Chaos";
  const strict = $("strictCompat")?.checked ?? true;

  renderActiveTags(archetype, theme);

  // Required tags (starter mapping – refine after observing real poe2db tags)
  const reqSkillTags = [];
  if (archetype === "Bow") reqSkillTags.push("Projectile");
  if (archetype === "Crossbow") reqSkillTags.push("Projectile");
  if (archetype === "Melee") reqSkillTags.push("Melee");
  if (archetype === "Spell") reqSkillTags.push("Spell");
  if (archetype === "Minion") reqSkillTags.push("Minion");
  reqSkillTags.push(theme);

  const reqItemTags = [theme];

  const skills = DATA.skills
    .filter(s => hasAllTags(s.tags, reqSkillTags))
    .slice(0, 200);

  const uniques = DATA.uniques
    .filter(u => hasAllTags(u.tags, reqItemTags))
    .filter(u => isCompatible(archetype, u, strict))
    .slice(0, 200);

  renderList($("skillsList"), skills, (s) => `
    <div class="result-item">
      <div class="result-icon" aria-hidden="true"></div>
      <div>
        <div class="result-title">${escapeHtml(s.name)}</div>
        <div class="result-meta">${escapeHtml((s.tags || []).join(", "))}</div>
        ${tagsToBadges(s.tags || [])}
      </div>
    </div>
  `);

  renderList($("uniquesList"), uniques, (u) => `
    <div class="result-item">
      <div class="result-icon" aria-hidden="true"></div>
      <div>
        <div class="result-title">${escapeHtml(u.name)}</div>
        <div class="result-meta">${escapeHtml((u.tags || []).join(", "))}</div>
        <div class="result-meta">gear: ${escapeHtml(u.gear?.weapon || "unknown")}</div>
        ${tagsToBadges(u.tags || [])}
      </div>
    </div>
  `);
}

document.addEventListener("DOMContentLoaded", async () => {
  $("btnSearch")?.addEventListener("click", runSearch);

  $("btnRefresh")?.addEventListener("click", async () => {
    localStorage.removeItem(CACHE_SKILLS);
    localStorage.removeItem(CACHE_UNIQUES);
    DATA = await loadData(true);
  });

  DATA = await loadData(false);
  // Optional auto-run
  // await runSearch();
});
