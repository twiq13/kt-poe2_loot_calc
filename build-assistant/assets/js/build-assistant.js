/* ==========================================
   PoE2 Build Assistant (client-side)
   - Cloudflare proxy (CORS)
   - Parse poe2db Skill Gems + Uniques
   - Group uniques by: Weapons / Jewellery / Gear
   - Filter skill gems by archetype + theme (scored)
   ========================================== */

const $ = (id) => document.getElementById(id);

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg;
  console.log(msg);
}

/* ---------------- Cache ---------------- */
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

const CACHE_SKILLS  = "poe2_skills_v4";
const CACHE_UNIQUES = "poe2_uniques_v4";

/* ---------------- Fetch ---------------- */
async function fetchHtml(url) {
  const res = await fetch(proxify(url));
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return await res.text();
}

const htmlToDoc = (html) =>
  new DOMParser().parseFromString(html, "text/html");

/* ---------------- Utils ---------------- */
function dedupeByKey(arr, keyFn) {
  const map = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!k) continue;
    if (!map.has(k)) map.set(k, x);
  }
  return Array.from(map.values());
}

function esc(s) {
  return (s || "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])
  );
}

function inferWeaponFromText(s) {
  const t = (s || "").toLowerCase();
  if (t.includes("bow")) return "bow";
  if (t.includes("crossbow")) return "crossbow";
  if (t.includes("staff")) return "staff";
  if (t.includes("sword")) return "sword";
  if (t.includes("axe")) return "axe";
  if (t.includes("mace")) return "mace";
  if (t.includes("dagger")) return "dagger";
  if (t.includes("shield") || t.includes("buckler")) return "shield";
  if (t.includes("quiver")) return "quiver";
  return "unknown";
}

function getSkillWantedTags(archetype, theme) {
  const tags = [];
  // Archetype → tags (à affiner plus tard, mais déjà beaucoup mieux)
  if (archetype === "Bow" || archetype === "Crossbow") tags.push("Projectile");
  if (archetype === "Melee") tags.push("Melee");
  if (archetype === "Spell") tags.push("Spell");
  if (archetype === "Minion") tags.push("Minion");

  // Theme tag (si présent dans poe2db)
  if (theme) tags.push(theme);

  return tags;
}

function scoreTags(entityTags, wantedTags) {
  const set = new Set((entityTags || []).map(t => t.toLowerCase()));
  let score = 0;
  for (const w of wantedTags) {
    if (set.has(String(w).toLowerCase())) score++;
  }
  return score;
}

/* ---------------- Parsing: Skill Gems ----------------
   On lit table tr → name + tags (comma list)
------------------------------------------------------ */
function extractTagsLine(text) {
  // cherche une portion "Attack, AoE, Melee, Slam" etc
  const m = (text || "").match(/([A-Z][A-Za-z]+(?:,\s*[A-Z][A-Za-z]+)+)/);
  return m ? m[1].split(",").map(x => x.trim()) : [];
}

function parseSkillGems(html) {
  const doc = htmlToDoc(html);
  const out = [];

  const rows = Array.from(doc.querySelectorAll("table tr"));
  for (const tr of rows) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 2) continue;

    const name = (tds[1].textContent || "").trim();
    if (!name) continue;

    const tags = extractTagsLine(tr.textContent || "");
    out.push({ name, tags });
  }

  // Dedupe by lowercase name
  return dedupeByKey(out, x => x.name?.toLowerCase());
}

/* ---------------- Parsing: Uniques (grouped) ----------------
   We track current section by anchors like:
   #WeaponUnique, #ArmourUnique, etc.
-------------------------------------------------------------- */
function normalizeUniqueSectionId(idOrText) {
  const s = (idOrText || "").toLowerCase();
  if (s.includes("weapon")) return "Weapons";
  if (s.includes("armour") || s.includes("armor")) return "Gear";
  if (s.includes("accessory") || s.includes("jewell") || s.includes("jewel") || s.includes("ring") || s.includes("amulet") || s.includes("belt"))
    return "Jewellery";
  return null;
}

function parseUniques(html) {
  const doc = htmlToDoc(html);

  const items = [];
  let currentSection = "Other";

  // We iterate in DOM order over headings + tables
  const nodes = Array.from(doc.body.querySelectorAll("h1,h2,h3,h4,table"));

  for (const node of nodes) {
    // Update section from headings with id OR text
    if (/^H[1-4]$/.test(node.tagName)) {
      const sec = normalizeUniqueSectionId(node.id) || normalizeUniqueSectionId(node.textContent);
      if (sec) currentSection = sec;
      continue;
    }

    // Parse table links (uniques are usually in tables)
    if (node.tagName === "TABLE") {
      const links = Array.from(node.querySelectorAll("a"));
      for (const a of links) {
        const name = (a.textContent || "").trim();
        if (!name || name.length < 4 || name.length > 70) continue;
        if (!/^[A-Z]/.test(name)) continue;

        // Use row context to infer weapon type when in Weapons
        const rowText = a.closest("tr")?.textContent || "";
        const weapon = inferWeaponFromText(rowText + " " + name);

        items.push({
          name,
          section: currentSection,
          weapon
        });
      }
    }
  }

  // Cleanup: keep only main sections we want + move unknown to Gear/Jewellery if we can infer
  const cleaned = items.map(x => {
    let sec = x.section;
    if (sec === "Other") {
      // fallback by weapon inference
      if (x.weapon !== "unknown" && x.weapon !== "shield" && x.weapon !== "quiver") sec = "Weapons";
    }
    return { ...x, section: sec };
  });

  return dedupeByKey(cleaned, x => x.name?.toLowerCase());
}

/* ---------------- Compatibility ---------------- */
function weaponCompatible(archetype, uniqueWeapon) {
  if (uniqueWeapon === "unknown") return false;

  if (archetype === "Bow") return uniqueWeapon === "bow";
  if (archetype === "Crossbow") return uniqueWeapon === "crossbow";

  if (archetype === "Melee") {
    return ["sword","axe","mace","dagger","staff"].includes(uniqueWeapon);
  }

  if (archetype === "Spell") {
    return ["staff","dagger"].includes(uniqueWeapon);
  }

  if (archetype === "Minion") return true;

  return false;
}

/* ---------------- Render ---------------- */
function renderList(el, html) {
  el.innerHTML = html;
}

function renderUniquesGrouped(uniquesEl, uniques, archetype, strictCompat) {
  // group order
  const order = ["Weapons", "Jewellery", "Gear", "Other"];
  const grouped = new Map(order.map(k => [k, []]));

  for (const u of uniques) {
    const k = grouped.has(u.section) ? u.section : "Other";
    grouped.get(k).push(u);
  }

  // Apply strict compat ONLY to Weapons
  if (strictCompat) {
    grouped.set("Weapons", grouped.get("Weapons").filter(u => weaponCompatible(archetype, u.weapon)));
  }

  // Sort inside groups
  for (const k of order) {
    grouped.get(k).sort((a,b) => a.name.localeCompare(b.name));
  }

  let html = "";
  for (const k of order) {
    const arr = grouped.get(k);
    if (!arr || arr.length === 0) continue;

    html += `<div class="section-title">${esc(k)} <small>(${arr.length})</small></div>`;

    for (const u of arr.slice(0, 80)) {
      const meta =
        (k === "Weapons")
          ? `weapon: ${esc(u.weapon)}`
          : (u.weapon && u.weapon !== "unknown" ? `hint: ${esc(u.weapon)}` : "");

      html += `
        <div class="result-item">
          <div class="result-icon"></div>
          <div>
            <div class="result-title">${esc(u.name)}</div>
            ${meta ? `<div class="result-meta">${meta}</div>` : `<div class="result-meta muted">—</div>`}
          </div>
        </div>
      `;
    }
  }

  if (!html) html = `<div class="muted">No results</div>`;
  renderList(uniquesEl, html);
}

function renderSkills(skillsEl, skills, archetype, theme) {
  const wanted = getSkillWantedTags(archetype, theme);

  // Score each skill
  const scored = skills
    .map(s => ({ ...s, score: scoreTags(s.tags, wanted) }))
    .filter(s => s.score > 0) // important: we only keep relevant ones
    .sort((a,b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 60);

  let html = "";
  if (!scored.length) {
    html = `<div class="muted">No results</div>`;
  } else {
    for (const s of scored) {
      html += `
        <div class="result-item">
          <div class="result-icon"></div>
          <div>
            <div class="result-title">${esc(s.name)}</div>
            <div class="result-meta">${esc((s.tags || []).join(", "))}</div>
          </div>
        </div>
      `;
    }
  }

  renderList(skillsEl, html);
}

/* ---------------- Load data ---------------- */
async function loadData(force = false) {
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
    console.error(e);
    setStatus("Error loading data (proxy ok, parse needs tweak). Check console.");
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

  const archetype = $("tagArchetype")?.value || "Bow";
  const theme = $("tagTheme")?.value || "Chaos";
  const strictCompat = $("strictCompat")?.checked ?? true;

  renderUniquesGrouped($("uniquesList"), DATA.uniques, archetype, strictCompat);
  renderSkills($("skillsList"), DATA.skills, archetype, theme);
}

/* ---------------- Boot ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  $("btnSearch")?.addEventListener("click", runSearch);

  $("btnRefresh")?.addEventListener("click", async () => {
    localStorage.removeItem(CACHE_SKILLS);
    localStorage.removeItem(CACHE_UNIQUES);
    DATA = await loadData(true);
    await runSearch();
  });

  DATA = await loadData(false);
});
