// =====================================================
// PoE2 Farm Calculator - FINAL CLEAN APP.JS
// Uses ./data/prices.json (same domain, GitHub Pages OK)
// =====================================================

let items = [];
let activeTab = "currency";

let itemMap = new Map();

// Icons + rates
let exaltIcon = "";
let divineIcon = "";

let exChaos = null;     // 1 Ex = X Chaos
let divineInEx = null;  // 1 Div = X Ex

// ---------------- helpers ----------------
function cleanName(name) {
  return String(name || "").replace(/\s*WIKI\s*$/i, "").trim();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}
function setStatus(msg) {
  const el = document.getElementById("fetchStatus");
  if (el) el.textContent = msg;
  console.log(msg);
}
function num(id) {
  const el = document.getElementById(id);
  const v = el ? Number(el.value) : 0;
  return Number.isFinite(v) ? v : 0;
}
function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
function $(id){ return document.getElementById(id); }

function findRowContains(needle) {
  const n = needle.toLowerCase();
  return items.find(x => (x.name || "").toLowerCase().includes(n)) || null;
}

// ---------------- dual totals formatter (Ex / Div) ----------------
function formatDual(exValue) {
  const ex = Number(exValue || 0);
  const div = (divineInEx && divineInEx > 0) ? (ex / divineInEx) : 0;

  return `
    <span class="dual">
      <span>${ex.toFixed(2)}</span>
      ${exaltIcon ? `<img class="pIcon" src="${exaltIcon}" alt="Ex">` : ""}
      <span class="sep">/</span>
      <span>${div.toFixed(2)}</span>
      ${divineIcon ? `<img class="pIcon" src="${divineIcon}" alt="Div">` : ""}
    </span>
  `;
}

// ---------------- load + compute rates ----------------
async function loadData() {
  try {
    setStatus("Status: loading data/prices.json...");

    const res = await fetch("./data/prices.json?ts=" + Date.now(), { cache: "no-store" });
    const data = await res.json();

    items = (data.lines || []).map(x => ({
      name: cleanName(x.name),
      amount: Number(x.amount ?? 0),
      unit: cleanName(x.unit || ""),
      icon: x.icon || "",
      unitIcon: x.unitIcon || "",
      exaltedValue: Number(x.exaltedValue ?? 0) // may be missing => we compute
    }));

    // Build initial map
    itemMap = new Map(items.map(x => [x.name.toLowerCase(), x]));

    // Icons
    exaltIcon = data.baseIcon || findRowContains("exalted orb")?.icon || "";
    divineIcon = findRowContains("divine orb")?.icon || "";

    // Compute rates + fill exaltedValue
    computeRatesAndFillExalted();

    setStatus(
      `Status: OK ✅ items=${items.length} | 1 Ex = ${exChaos ? exChaos.toFixed(2) : "?"} Chaos | 1 Div = ${divineInEx ? divineInEx.toFixed(4) : "?"} Ex`
    );

    fillDatalist();
    bindTabs();
    renderMarketList();

    // restore saved state (after items are ready)
    loadState();

    // ensure at least 1 loot row
    if (!document.querySelector("#lootBody tr")) addLootRow();

    // update prices + totals
    refreshAllLootPrices();
    recalcAll();

  } catch (e) {
    setStatus("Status: ERROR ❌ " + e.toString());
  }
}

function computeRatesAndFillExalted() {
  // Find Ex row (often "Perfect Exalted Orb")
  const exRow = findRowContains("exalted orb") || findRowContains("perfect exalted");
  exChaos = null;

  if (exRow) {
    const u = (exRow.unit || "").toLowerCase();
    if (u === "chaos orb" && exRow.amount > 0) {
      exChaos = exRow.amount; // chaos per Ex
    }
  }

  // Find Divine row
  const divRow = findRowContains("divine orb");
  divineInEx = null;

  // Priority: if divine already has exaltedValue
  if (divRow && divRow.exaltedValue && divRow.exaltedValue > 0) {
    divineInEx = divRow.exaltedValue;
  } else if (divRow) {
    const u = (divRow.unit || "").toLowerCase();

    // Divine in Chaos => convert using exChaos
    if (u === "chaos orb" && divRow.amount > 0 && exChaos && exChaos > 0) {
      divineInEx = divRow.amount / exChaos;
    }

    // Divine in Ex directly
    if (u === "exalted orb" && divRow.amount > 0) {
      divineInEx = divRow.amount;
    }

    // Fallback
    if (u === "divine orb") divineInEx = 1;
  }

  // Fill exaltedValue for ALL items if missing/0
  items.forEach(it => {
    if (it.exaltedValue && it.exaltedValue > 0) return;

    const u = (it.unit || "").toLowerCase();

    // Chaos => Ex
    if (u === "chaos orb" && exChaos && exChaos > 0) {
      it.exaltedValue = it.amount / exChaos;
      return;
    }

    // Divine => Ex
    if (u === "divine orb" && divineInEx && divineInEx > 0) {
      it.exaltedValue = it.amount * divineInEx;
      return;
    }

    // Exalted => Ex
    if (u === "exalted orb") {
      it.exaltedValue = it.amount;
      return;
    }

    it.exaltedValue = 0;
  });

  // rebuild map with updated exaltedValue
  itemMap = new Map(items.map(x => [x.name.toLowerCase(), x]));
}

// ---------------- tabs ----------------
function bindTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeTab = btn.dataset.tab || "currency";
      renderMarketList();
      saveState();
    };
  });

  // restore active class if needed
  document.querySelectorAll(".tab").forEach(b => {
    b.classList.toggle("active", (b.dataset.tab || "currency") === activeTab);
  });
}

// ---------------- market list ----------------
function renderMarketList() {
  const panel = $("currencyList");
  if (!panel) return;

  const q = ($("currencySearch")?.value || "").trim().toLowerCase();
  panel.innerHTML = "";

  if (activeTab !== "currency") {
    panel.innerHTML = `<div style="color:#bbb;padding:10px;">Coming soon: ${escapeHtml(activeTab)}</div>`;
    return;
  }

  const filtered = items
    .filter(x => (x.name || "").toLowerCase().includes(q))
    .slice(0, 300);

  filtered.forEach(x => {
    const row = document.createElement("div");
    row.className = "currency-item";

    const rightText = x.unit ? `${x.amount} ${x.unit}` : `${x.amount}`;

    row.innerHTML = `
      <div class="cLeft">
        ${x.icon ? `<img class="cIcon" src="${x.icon}" alt="">` : ""}
        <span>${escapeHtml(x.name)}</span>
      </div>
      <small class="mRight">
        <span>${escapeHtml(rightText)}</span>
        ${x.unitIcon ? `<img class="mUnitIcon" src="${x.unitIcon}" alt="">` : ""}
      </small>
    `;

    row.addEventListener("click", () => addLootRowWithName(x.name));
    panel.appendChild(row);
  });
}

function fillDatalist() {
  const dl = $("currencyDatalist");
  if (!dl) return;
  dl.innerHTML = "";
  items.forEach(x => {
    const opt = document.createElement("option");
    opt.value = x.name;
    dl.appendChild(opt);
  });
}

// ---------------- loot table ----------------
function addLootRow() {
  const body = $("lootBody");
  if (!body) return null;

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
        ${exaltIcon ? `<img class="baseIcon" src="${exaltIcon}" alt="Ex">` : `<img class="baseIcon" style="display:none" alt="">`}
      </div>
    </td>
    <td><input class="lootQty" type="number" value="0" min="0"></td>
    <td><button type="button" class="deleteBtn" title="Delete">✖</button></td>
  `;

  body.appendChild(tr);

  const itemInput = tr.querySelector(".lootItem");
  const qtyInput = tr.querySelector(".lootQty");
  const delBtn = tr.querySelector(".deleteBtn");

  itemInput.addEventListener("input", () => {
    updateLootRowPrice(tr);
    recalcAll();
    saveState();
  });

  qtyInput.addEventListener("input", () => {
    recalcAll();
    saveState();
  });

  delBtn.addEventListener("click", () => {
    tr.remove();
    recalcAll();
    saveState();
  });

  return tr;
}

function addLootRowWithName(name) {
  const tr = addLootRow();
  if (!tr) return;
  tr.querySelector(".lootItem").value = name;
  updateLootRowPrice(tr);
  recalcAll();
  saveState();
}

function addManualRow() {
  const body = $("lootBody");
  if (!body) return null;

  const tr = document.createElement("tr");
  tr.className = "lootRow manualRow";

  tr.innerHTML = `
    <td><input class="lootItem" placeholder="Custom name"></td>
    <td><input class="manualPrice" type="number" value="0" min="0" step="0.01"></td>
    <td><input class="lootQty" type="number" value="0" min="0"></td>
    <td><button type="button" class="deleteBtn" title="Delete">✖</button></td>
  `;

  body.appendChild(tr);

  tr.querySelector(".manualPrice").addEventListener("input", () => {
    recalcAll(); saveState();
  });
  tr.querySelector(".lootQty").addEventListener("input", () => {
    recalcAll(); saveState();
  });
  tr.querySelector(".lootItem").addEventListener("input", saveState);

  tr.querySelector(".deleteBtn").addEventListener("click", () => {
    tr.remove(); recalcAll(); saveState();
  });

  return tr;
}

function updateLootRowPrice(tr) {
  if (!tr || tr.classList.contains("manualRow")) return;

  const inp = tr.querySelector(".lootItem");
  const name = (inp?.value || "").trim().toLowerCase();

  const found = itemMap.get(name);

  // item icon (next to item)
  const iconEl = tr.querySelector(".lootIcon");
  if (found?.icon) {
    iconEl.src = found.icon;
    iconEl.style.display = "block";
  } else {
    iconEl.style.display = "none";
  }

  // price always in Exalted
  const ex = found ? Number(found.exaltedValue || 0) : 0;
  tr.querySelector(".lootPrice").textContent = ex.toFixed(2);
}

function refreshAllLootPrices() {
  document.querySelectorAll("#lootBody tr").forEach(tr => {
    if (tr.classList.contains("manualRow")) return;
    updateLootRowPrice(tr);
  });
}

// ---------------- calculations ----------------
function calcInvestEx() {
  // costPerMap is EXALTED
  const maps = num("maps");
  const cost = num("costPerMap");
  return maps * cost;
}

function calcLootEx() {
  let total = 0;

  document.querySelectorAll("#lootBody tr").forEach(tr => {
    const qty = Number(tr.querySelector(".lootQty")?.value || 0);

    if (tr.classList.contains("manualRow")) {
      const p = Number(tr.querySelector(".manualPrice")?.value || 0);
      total += p * qty;
    } else {
      const p = Number(tr.querySelector(".lootPrice")?.textContent || 0);
      total += p * qty;
    }
  });

  return total;
}

function recalcAll() {
  const invest = calcInvestEx();
  const loot = calcLootEx();
  const gain = loot - invest;

  setHTML("totalInvest", formatDual(invest));
  setHTML("totalLoot", formatDual(loot));
  setHTML("gain", formatDual(gain));
}

// ---------------- storage ----------------
function saveState() {
  const rows = [...document.querySelectorAll("#lootBody tr")].map(tr => {
    const manual = tr.classList.contains("manualRow");
    return {
      manual,
      item: tr.querySelector(".lootItem")?.value || "",
      qty: Number(tr.querySelector(".lootQty")?.value || 0),
      price: manual ? Number(tr.querySelector(".manualPrice")?.value || 0) : null
    };
  });

  const invest = {
    maps: $("maps")?.value ?? "",
    costPerMap: $("costPerMap")?.value ?? ""
  };

  localStorage.setItem("poe2FarmState", JSON.stringify({ rows, invest, activeTab }));
}

function loadState() {
  const raw = localStorage.getItem("poe2FarmState");
  if (!raw) return;

  try {
    const state = JSON.parse(raw);

    if (state?.invest) {
      if ($("maps")) $("maps").value = state.invest.maps ?? "10";
      if ($("costPerMap")) $("costPerMap").value = state.invest.costPerMap ?? "0";
    }

    if (state?.activeTab) activeTab = state.activeTab;

    // restore tab UI
    document.querySelectorAll(".tab").forEach(b => {
      b.classList.toggle("active", (b.dataset.tab || "currency") === activeTab);
    });

    // restore rows
    if (Array.isArray(state?.rows)) {
      $("lootBody").innerHTML = "";
      state.rows.forEach(r => {
        if (r.manual) {
          const tr = addManualRow();
          tr.querySelector(".lootItem").value = r.item || "";
          tr.querySelector(".lootQty").value = r.qty ?? 0;
          tr.querySelector(".manualPrice").value = r.price ?? 0;
        } else {
          const tr = addLootRow();
          tr.querySelector(".lootItem").value = r.item || "";
          tr.querySelector(".lootQty").value = r.qty ?? 0;
          updateLootRowPrice(tr);
        }
      });
    }

    renderMarketList();
    recalcAll();

  } catch {
    // ignore
  }
}

// ---------------- reset ----------------
function resetAll() {
  localStorage.removeItem("poe2FarmState");

  if ($("maps")) $("maps").value = "10";
  if ($("costPerMap")) $("costPerMap").value = "0";

  if ($("lootBody")) {
    $("lootBody").innerHTML = "";
    addLootRow();
  }

  activeTab = "currency";
  document.querySelectorAll(".tab").forEach(b => {
    b.classList.toggle("active", (b.dataset.tab || "currency") === "currency");
  });

  renderMarketList();
  recalcAll();
  saveState();
  setStatus("Status: reset ✅");
}

// ---------------- init ----------------
document.addEventListener("DOMContentLoaded", () => {
  $("currencySearch")?.addEventListener("input", renderMarketList);

  ["maps", "costPerMap"].forEach(id => {
    $(id)?.addEventListener("input", () => { recalcAll(); saveState(); });
  });

  $("resetBtn")?.addEventListener("click", resetAll);

  // expose for HTML buttons
  window.addLootLine = addLootRow;
  window.addManualLine = addManualRow;
  window.resetAll = resetAll;

  loadData();
});
