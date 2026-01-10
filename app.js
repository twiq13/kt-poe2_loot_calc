let items = [];
let itemMap = new Map();

let exaltIcon = "";
let divineIcon = "";
let divineInEx = null; // 1 Divine = X Ex

let activeTab = "currency";

// ---------- helpers ----------
function cleanName(name) {
  return String(name || "").replace(/\s*WIKI\s*$/i, "").trim();
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
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}

// ---------- format totals (Ex/Div with icons) ----------
function formatDual(exValue) {
  const ex = Number(exValue || 0);
  const div = (divineInEx && divineInEx > 0) ? (ex / divineInEx) : 0;

  return `
    <span class="dual">
      <span>${ex.toFixed(2)}</span>${exaltIcon ? `<img class="pIcon" src="${exaltIcon}" alt="">` : ""}
      <span class="sep">/</span>
      <span>${div.toFixed(2)}</span>${divineIcon ? `<img class="pIcon" src="${divineIcon}" alt="">` : ""}
    </span>
  `;
}

// ---------- load prices.json ----------
async function loadData() {
  try {
    setStatus("Status: loading data/prices.json...");

    const res = await fetch("./data/prices.json?ts=" + Date.now(), { cache: "no-store" });
    const data = await res.json();

    // we keep original amount/unit for LEFT list
    items = (data.lines || []).map(x => ({
      name: cleanName(x.name),
      amount: Number(x.amount ?? 0),
      unit: cleanName(x.unit || ""),
      exaltedValue: Number(x.exaltedValue ?? 0),
      icon: x.icon || ""
    }));

    itemMap = new Map(items.map(x => [x.name.toLowerCase(), x]));

    // base icon (exalted)
    exaltIcon = data.baseIcon || itemMap.get("exalted orb")?.icon || "";

    // divine icon & rate (from JSON row)
    const divineRow = itemMap.get("divine orb");
    divineIcon = divineRow?.icon || "";
    divineInEx = divineRow?.exaltedValue || null;

    setStatus(`Status: OK ✅ items=${items.length}`);

    fillDatalist();
    bindTabs();
    renderLeftList();
    refreshAllLootPrices();
    recalcAll();
    loadState();

  } catch (e) {
    setStatus("Status: ERROR ❌ " + e.toString());
  }
}

// ---------- tabs skeleton ----------
function bindTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeTab = btn.dataset.tab;

      // For now, only "currency" is real. Others: show placeholder.
      renderLeftList();
    };
  });
}

// ---------- left list ----------
function renderLeftList() {
  const panel = document.getElementById("currencyList");
  const q = (document.getElementById("currencySearch")?.value || "").trim().toLowerCase();

  if (!panel) return;
  panel.innerHTML = "";

  if (activeTab !== "currency") {
    panel.innerHTML = `<div style="color:#bbb;padding:10px;">Coming soon: ${escapeHtml(activeTab)} (UI ready)</div>`;
    return;
  }

  const filtered = items
    .filter(x => x.name.toLowerCase().includes(q))
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
      <small>${escapeHtml(rightText)}</small>
    `;

    row.addEventListener("click", () => addLootLineWithName(x.name));
    panel.appendChild(row);
  });
}

function fillDatalist() {
  const dl = document.getElementById("currencyDatalist");
  if (!dl) return;

  dl.innerHTML = "";
  items.forEach(x => {
    const opt = document.createElement("option");
    opt.value = x.name;
    dl.appendChild(opt);
  });
}

// ---------- loot rows ----------
function addLootLine() {
  const tr = document.createElement("tr");
  tr.className = "lootRow";

  tr.innerHTML = `
    <td>
      <div style="display:flex;align-items:center;gap:8px;">
        <input class="lootItem" list="currencyDatalist" placeholder="Item">
        <img class="lootIcon" alt="">
      </div>
    </td>
    <td class="priceCell">
      <span class="lootPrice">0</span>
      <img class="baseIcon" alt="">
    </td>
    <td><input class="lootQty" type="number" value="0" min="0"></td>
    <td><button type="button" class="deleteBtn" title="Delete">✖</button></td>
  `;

  document.getElementById("lootBody").appendChild(tr);

  const itemInput = tr.querySelector(".lootItem");
  const qtyInput = tr.querySelector(".lootQty");
  const delBtn = tr.querySelector(".deleteBtn");

  // set base icon (exalted) next to price
  const baseImg = tr.querySelector(".baseIcon");
  if (exaltIcon) {
    baseImg.src = exaltIcon;
    baseImg.style.display = "inline-block";
  } else {
    baseImg.style.display = "none";
  }

  itemInput.addEventListener("input", () => {
    updatePrice(itemInput);
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

function addLootLineWithName(name) {
  const tr = addLootLine();
  tr.querySelector(".lootItem").value = name;
  updatePrice(tr.querySelector(".lootItem"));
  recalcAll();
  saveState();
}

function addManualLine() {
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
    tr.remove();
    recalcAll();
    saveState();
  });

  tr.querySelector(".manualPrice").addEventListener("input", () => {
    recalcAll();
    saveState();
  });

  tr.querySelector(".lootQty").addEventListener("input", () => {
    recalcAll();
    saveState();
  });

  tr.querySelector(".lootItem").addEventListener("input", () => saveState());

  return tr;
}

function updatePrice(input) {
  const row = input.closest("tr");
  if (row.classList.contains("manualRow")) { recalcAll(); return; }

  const name = (input.value || "").trim().toLowerCase();
  const found = itemMap.get(name);

  const priceEl = row.querySelector(".lootPrice");
  const iconEl = row.querySelector(".lootIcon");

  if (found?.icon) {
    iconEl.src = found.icon;
    iconEl.style.display = "inline-block";
  } else {
    iconEl.style.display = "none";
  }

  // Right table MUST be Exalted only
  const ex = found ? Number(found.exaltedValue || 0) : 0;
  priceEl.textContent = ex.toFixed(2);

  recalcAll();
}

function refreshAllLootPrices() {
  document.querySelectorAll("#lootBody tr").forEach(tr => {
    if (tr.classList.contains("manualRow")) return;
    const inp = tr.querySelector(".lootItem");
    if (inp) updatePrice(inp);
  });
}

// ---------- calculations ----------
function calcInvestEx() {
  const maps = num("maps");
  const ppm = num("costPerMap"); // this is Exalted (user said cost per map)
  return maps * ppm;
}

function calcLootEx() {
  let total = 0;
  document.querySelectorAll("#lootBody tr").forEach(row => {
    const qty = Number(row.querySelector(".lootQty")?.value || 0);
    if (row.classList.contains("manualRow")) {
      const p = Number(row.querySelector(".manualPrice")?.value || 0);
      total += p * qty;
    } else {
      const p = Number(row.querySelector(".lootPrice")?.textContent || 0);
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

// ---------- storage ----------
function saveState() {
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
    maps: document.getElementById("maps")?.value ?? "",
    costPerMap: document.getElementById("costPerMap")?.value ?? ""
  };

  localStorage.setItem("poe2FarmState", JSON.stringify({ rows, invest, activeTab }));
}

function loadState() {
  const raw = localStorage.getItem("poe2FarmState");
  if (!raw) return;
  try {
    const state = JSON.parse(raw);

    if (state?.invest) {
      if (document.getElementById("maps")) document.getElementById("maps").value = state.invest.maps ?? "";
      if (document.getElementById("costPerMap")) document.getElementById("costPerMap").value = state.invest.costPerMap ?? "";
    }

    if (state?.activeTab) activeTab = state.activeTab;

    // restore tab UI
    document.querySelectorAll(".tab").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === activeTab);
    });

    if (Array.isArray(state?.rows)) {
      document.getElementById("lootBody").innerHTML = "";
      state.rows.forEach(r => {
        if (r.manual) {
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
      });
    }

    renderLeftList();
    recalcAll();
  } catch {}
}

// ---------- reset ----------
function resetAll() {
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

  ["maps", "costPerMap"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", () => { recalcAll(); saveState(); });
  });

  document.getElementById("resetBtn")?.addEventListener("click", resetAll);

  window.addLootLine = addLootLine;
  window.addManualLine = addManualLine;

  loadData().then(() => {
    if (!document.querySelector("#lootBody tr")) addLootLine();
    recalcAll();
  });
});


