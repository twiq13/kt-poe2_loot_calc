// app.js (stable final)

let data = null;
let items = [];
let itemMap = new Map();

let activeTab = "currency";
let exaltIcon = "";
let divineIcon = "";
let divineInEx = null; // 1 Divine = X Ex

// ---------- small helpers ----------
function setStatus(msg){
  const el = document.getElementById("fetchStatus");
  if (el) el.textContent = msg;
  console.log(msg);
}
function cleanName(s){ return String(s||"").replace(/\s*WIKI\s*$/i,"").trim(); }
function esc(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}
function num(id){
  const el = document.getElementById(id);
  const v = el ? Number(el.value) : 0;
  return Number.isFinite(v) ? v : 0;
}

// ---------- format totals (Ex / Div) ----------
function formatDual(exValue){
  const ex = Number(exValue || 0);
  const div = (divineInEx && divineInEx > 0) ? (ex / divineInEx) : 0;

  return `
    <span>${ex.toFixed(2)}</span>${exaltIcon ? `<img class="pIcon" src="${exaltIcon}" alt="Ex">` : ""}
    <span class="sep">/</span>
    <span>${div.toFixed(2)}</span>${divineIcon ? `<img class="pIcon" src="${divineIcon}" alt="Div">` : ""}
  `;
}

// ---------- load prices.json ----------
async function loadData(){
  try{
    setStatus("Status: loading data/prices.json...");
    const res = await fetch("./data/prices.json?ts=" + Date.now(), { cache:"no-store" });
    data = await res.json();

    items = (data.lines || []).map(x => ({
      section: x.section || "currency",
      name: cleanName(x.name),
      icon: x.icon || "",
      amount: Number(x.amount ?? 0),
      unit: cleanName(x.unit || ""),
      unitIcon: x.unitIcon || "",
      exaltedValue: (typeof x.exaltedValue === "number") ? x.exaltedValue : null
    }));

    itemMap = new Map(items.map(x => [x.name.toLowerCase(), x]));

    exaltIcon = data.baseIcon || itemMap.get("exalted orb")?.icon || "";
    divineIcon = data.divineIcon || itemMap.get("divine orb")?.icon || "";
    divineInEx = (typeof data.divineInEx === "number" && data.divineInEx > 0) ? data.divineInEx : null;

    // Build tabs from prices.json sections (fallback if missing)
    buildTabs(data.sections || null);

    fillDatalist();
    renderLeftList();

    // restore state (after tabs exist)
    loadState();

    // ensure at least one loot row
    if (!document.querySelector("#lootBody tr")) addLootLine();

    recalcAll();

    setStatus(`Status: OK ✅ items=${items.length} | activeTab=${activeTab} | 1 Div=${divineInEx ? divineInEx.toFixed(4) : "?"} Ex`);
  } catch(e){
    setStatus("Status: ERROR ❌ " + e.toString());
  }
}

// ---------- tabs ----------
const DEFAULT_TABS = [
  { id:"currency", label:"Currency" },
  { id:"fragments", label:"Fragments" },
  { id:"abyssalBones", label:"Abyssal Bones" },
  { id:"uncutGems", label:"Uncut Gems" },
  { id:"lineageGems", label:"Lineage Gems" },
  { id:"essences", label:"Essences" },
  { id:"soulCores", label:"Soul Cores" },
  { id:"idols", label:"Idols" },
  { id:"runes", label:"Runes" },
  { id:"omens", label:"Omens" },
  { id:"expedition", label:"Expedition" },
  { id:"liquidEmotions", label:"Liquid Emotions" },
  { id:"catalyst", label:"Catalyst" },
];

function buildTabs(sectionsFromJson){
  const tabsEl = document.getElementById("tabs");
  if (!tabsEl) return;

  const tabs = Array.isArray(sectionsFromJson) && sectionsFromJson.length
    ? sectionsFromJson.map(s => ({ id: s.id, label: s.label || s.id }))
    : DEFAULT_TABS;

  tabsEl.innerHTML = tabs.map(t => `
    <button class="tab ${t.id === activeTab ? "active" : ""}" data-tab="${esc(t.id)}" type="button">
      ${esc(t.label)}
    </button>
  `).join("");

  tabsEl.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab || "currency";
      tabsEl.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b === btn));
      renderLeftList();
      saveState();
    });
  });
}

// ---------- left list ----------
function renderLeftList(){
  const panel = document.getElementById("currencyList");
  if (!panel) return;

  const q = (document.getElementById("currencySearch")?.value || "").trim().toLowerCase();
  panel.innerHTML = "";

  const filtered = items
    .filter(x => (x.section || "currency") === activeTab)
    .filter(x => x.name.toLowerCase().includes(q))
    .slice(0, 400);

  if (!filtered.length){
    panel.innerHTML = `<div style="color:#bbb;padding:10px;">No items for "${esc(activeTab)}"</div>`;
    return;
  }

  for (const x of filtered){
    const rightText = x.unit ? `${x.amount} ${x.unit}` : `${x.amount}`;
    const row = document.createElement("div");
    row.className = "currency-item";
    row.innerHTML = `
      <div class="cLeft">
        ${x.icon ? `<img class="cIcon" src="${x.icon}" alt="">` : ""}
        <span title="${esc(x.name)}">${esc(x.name)}</span>
      </div>
      <small class="mRight">
        <span>${esc(rightText)}</span>
        ${x.unitIcon ? `<img class="mUnitIcon" src="${x.unitIcon}" alt="">` : ""}
      </small>
    `;
    row.addEventListener("click", () => addLootLineWithName(x.name));
    panel.appendChild(row);
  }
}

function fillDatalist(){
  const dl = document.getElementById("currencyDatalist");
  if (!dl) return;
  dl.innerHTML = "";
  // datalist includes all names (all tabs)
  items.forEach(x => {
    const opt = document.createElement("option");
    opt.value = x.name;
    dl.appendChild(opt);
  });
}

// ---------- loot rows ----------
function addLootLine(){
  const tr = document.createElement("tr");
  tr.className = "lootRow";

  tr.innerHTML = `
    <td>
      <div class="lootItemWrap">
        <input class="lootItem" list="currencyDatalist" placeholder="Item">
        <img class="lootIcon" alt="">
      </div>
    </td>
    <td>
      <div class="priceCell">
        <span class="lootPrice">0.00</span>
        <img class="baseIcon" alt="">
      </div>
    </td>
    <td><input class="lootQty" type="number" value="0" min="0"></td>
    <td><button type="button" class="deleteBtn" title="Delete">✖</button></td>
  `;

  document.getElementById("lootBody").appendChild(tr);

  const itemInput = tr.querySelector(".lootItem");
  const qtyInput  = tr.querySelector(".lootQty");
  const delBtn    = tr.querySelector(".deleteBtn");

  // show exalt icon near price
  const baseImg = tr.querySelector(".baseIcon");
  if (exaltIcon){
    baseImg.src = exaltIcon;
    baseImg.style.display = "block";
  } else {
    baseImg.style.display = "none";
  }

  itemInput.addEventListener("input", () => { updatePrice(itemInput); saveState(); });
  qtyInput.addEventListener("input", () => { recalcAll(); saveState(); });

  delBtn.addEventListener("click", () => {
    tr.remove();
    recalcAll();
    saveState();
  });

  return tr;
}

function addManualLine(){
  const tr = document.createElement("tr");
  tr.className = "lootRow manualRow";

  tr.innerHTML = `
    <td><input class="lootItem" placeholder="Custom name"></td>
    <td><input class="manualPrice" type="number" value="0" min="0" step="0.01"></td>
    <td><input class="lootQty" type="number" value="0" min="0"></td>
    <td><button type="button" class="deleteBtn" title="Delete">✖</button></td>
  `;

  document.getElementById("lootBody").appendChild(tr);

  tr.querySelector(".deleteBtn").addEventListener("click", () => {
    tr.remove(); recalcAll(); saveState();
  });

  tr.querySelector(".manualPrice").addEventListener("input", () => { recalcAll(); saveState(); });
  tr.querySelector(".lootQty").addEventListener("input", () => { recalcAll(); saveState(); });
  tr.querySelector(".lootItem").addEventListener("input", saveState);

  return tr;
}

function addLootLineWithName(name){
  const tr = addLootLine();
  tr.querySelector(".lootItem").value = name;
  updatePrice(tr.querySelector(".lootItem"));
  recalcAll();
  saveState();
}

function updatePrice(input){
  const row = input.closest("tr");
  if (row.classList.contains("manualRow")) { recalcAll(); return; }

  const name = (input.value || "").trim().toLowerCase();
  const found = itemMap.get(name);

  const priceEl = row.querySelector(".lootPrice");
  const iconEl  = row.querySelector(".lootIcon");

  if (found?.icon){
    iconEl.src = found.icon;
    iconEl.style.display = "block";
  } else {
    iconEl.style.display = "none";
  }

  const ex = found?.exaltedValue ? Number(found.exaltedValue) : 0;
  priceEl.textContent = ex.toFixed(2);

  recalcAll();
}

// ---------- calculations ----------
function calcInvestEx(){
  return num("maps") * num("costPerMap");
}

function calcLootEx(){
  let total = 0;
  document.querySelectorAll("#lootBody tr").forEach(row => {
    const qty = Number(row.querySelector(".lootQty")?.value || 0);
    if (row.classList.contains("manualRow")){
      const p = Number(row.querySelector(".manualPrice")?.value || 0);
      total += p * qty;
    } else {
      const p = Number(row.querySelector(".lootPrice")?.textContent || 0);
      total += p * qty;
    }
  });
  return total;
}

function recalcAll(){
  const invest = calcInvestEx();
  const loot = calcLootEx();
  const gain = loot - invest;

  document.getElementById("totalInvest").innerHTML = formatDual(invest);
  document.getElementById("totalLoot").innerHTML = formatDual(loot);
  document.getElementById("gain").innerHTML = formatDual(gain);
}

// ---------- storage ----------
function saveState(){
  const rows = [...document.querySelectorAll("#lootBody tr")].map(r => {
    const manual = r.classList.contains("manualRow");
    return {
      manual,
      item: r.querySelector(".lootItem")?.value || "",
      qty: Number(r.querySelector(".lootQty")?.value || 0),
      price: manual ? Number(r.querySelector(".manualPrice")?.value || 0) : null
    };
  });

  const invest = {
    maps: document.getElementById("maps")?.value ?? "10",
    costPerMap: document.getElementById("costPerMap")?.value ?? "0"
  };

  localStorage.setItem("poe2FarmState", JSON.stringify({ rows, invest, activeTab }));
}

function loadState(){
  const raw = localStorage.getItem("poe2FarmState");
  if (!raw) return;

  try{
    const st = JSON.parse(raw);

    if (st?.invest){
      document.getElementById("maps").value = st.invest.maps ?? "10";
      document.getElementById("costPerMap").value = st.invest.costPerMap ?? "0";
    }

    if (st?.activeTab){
      activeTab = st.activeTab;
      // update tab UI
      document.querySelectorAll(".tab").forEach(b => {
        b.classList.toggle("active", b.dataset.tab === activeTab);
      });
    }

    if (Array.isArray(st?.rows)){
      document.getElementById("lootBody").innerHTML = "";
      for (const r of st.rows){
        if (r.manual){
          const tr = addManualLine();
          tr.querySelector(".lootItem").value = r.item || "";
          tr.querySelector(".lootQty").value = r.qty ?? 0;
          tr.querySelector(".manualPrice").value = r.price ?? 0;
        } else {
          const tr = addLootLine();
          tr.querySelector(".lootItem").value = r.item || "";
          tr.querySelector(".lootQty").value = r.qty ?? 0;
          updatePrice(tr.querySelector(".lootItem"));
        }
      }
    }
  } catch {}
}

function resetAll(){
  localStorage.removeItem("poe2FarmState");

  document.getElementById("maps").value = "10";
  document.getElementById("costPerMap").value = "0";

  document.getElementById("lootBody").innerHTML = "";
  addLootLine();

  activeTab = "currency";
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === "currency"));

  renderLeftList();
  recalcAll();
  saveState();
  setStatus("Status: reset ✅");
}

// ---------- init ----------
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("currencySearch")?.addEventListener("input", renderLeftList);
  document.getElementById("maps")?.addEventListener("input", () => { recalcAll(); saveState(); });
  document.getElementById("costPerMap")?.addEventListener("input", () => { recalcAll(); saveState(); });

  document.getElementById("resetBtn")?.addEventListener("click", resetAll);
  document.getElementById("addRowBtn")?.addEventListener("click", () => { addLootLine(); saveState(); });
  document.getElementById("addManualBtn")?.addEventListener("click", () => { addManualLine(); saveState(); });

  // expose (optional)
  window.addLootLine = addLootLine;
  window.addManualLine = addManualLine;
  window.resetAll = resetAll;

  loadData();
});
