// =======================
// PoE2 Farm Calculette - FINAL (GitHub Pages + prices.json)
// =======================

let currencies = [];          // [{name, amount, unit}, ...] depuis data/prices.json
let currencyMap = new Map();  // nameLower -> currency object

// ---------- utils ----------
function cleanName(name) {
  return String(name || "").replace(/\s*WIKI\s*$/i, "").trim();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}

function setStatus(msg) {
  const box = document.getElementById("fetchStatus");
  if (box) box.textContent = msg;
  console.log(msg);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function num(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const v = Number(el.value);
  return Number.isFinite(v) ? v : 0;
}

// =======================
// CHARGEMENT PRICES.JSON
// =======================
async function loadCurrencies() {
  try {
    setStatus("Fetch status: lecture data/prices.json...");

    const res = await fetch("./data/prices.json?ts=" + Date.now(), { cache: "no-store" });
    const data = await res.json();

    currencies = (data.lines || []).map(c => ({
      name: cleanName(c.name),
      amount: Number(c.amount || 0),
      unit: c.unit || ""
    }));

    currencyMap = new Map(currencies.map(c => [c.name.toLowerCase(), c]));

    setStatus(`Fetch status: OK ✅ currencies=${currencies.length} (maj: ${data.updatedAt || "?"})`);

    renderCurrencyPanel();
    fillDatalist();

  } catch (e) {
    setStatus("Fetch status: ERREUR ❌ " + e.toString());
  }
}

// =======================
// AFFICHAGE COLONNE GAUCHE + recherche
// =======================
function renderCurrencyPanel() {
  const panel = document.getElementById("currencyList");
  if (!panel) return;

  const q = (document.getElementById("currencySearch")?.value || "").trim().toLowerCase();
  panel.innerHTML = "";

  if (!currencies.length) {
    panel.innerHTML = "<p style='color:#aaa'>Aucune donnée dans data/prices.json</p>";
    return;
  }

  const filtered = currencies
    .filter(c => c.name.toLowerCase().includes(q))
    .slice(0, 300);

  filtered.forEach(c => {
    const div = document.createElement("div");
    div.className = "currency-item";
    div.style.cursor = "pointer";
    div.innerHTML = `
      <span>${escapeHtml(c.name)}</span>
      <small>${c.amount} ${escapeHtml(c.unit)}</small>
    `;
    div.addEventListener("click", () => addLootLineWithName(c.name));
    panel.appendChild(div);
  });
}

// =======================
// DATALIST (autocomplete loot)
// =======================
function fillDatalist() {
  const dl = document.getElementById("currencyDatalist");
  if (!dl) return;

  dl.innerHTML = "";
  currencies.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name;
    dl.appendChild(opt);
  });
}

// =======================
// AJOUT LIGNE LOOT (auto)
// =======================
function addLootLine() {
  const tr = document.createElement("tr");
  tr.className = "lootRow";

  tr.innerHTML = `
    <td>
      <input class="lootItem" list="currencyDatalist" placeholder="Item">
    </td>
    <td class="price lootPrice">0</td>
    <td>
      <input class="lootQty" type="number" value="0" min="0">
    </td>
    <td>
      <button type="button" class="deleteBtn" title="Supprimer">✖</button>
    </td>
  `;

  document.getElementById("lootBody").appendChild(tr);

  const itemInput = tr.querySelector(".lootItem");
  const qtyInput = tr.querySelector(".lootQty");
  const delBtn = tr.querySelector(".deleteBtn");

  itemInput.addEventListener("input", () => {
    updatePrice(itemInput);
    saveState();
  });

  qtyInput.addEventListener("input", () => {
    calculerTout();
    saveState();
  });

  delBtn.addEventListener("click", () => {
    tr.remove();
    calculerTout();
    saveState();
  });

  return tr;
}

function addLootLineWithName(name) {
  const tr = addLootLine();
  tr.querySelector(".lootItem").value = name;
  updatePrice(tr.querySelector(".lootItem"));
  calculerTout();
  saveState();
}

// =======================
// LIGNE MANUELLE
// =======================
function addManualLine() {
  const tr = document.createElement("tr");
  tr.className = "lootRow manualRow";

  tr.innerHTML = `
    <td><input class="lootItem" placeholder="Nom libre"></td>
    <td><input class="manualPrice" type="number" value="0" min="0" step="0.01"></td>
    <td><input class="lootQty" type="number" value="0" min="0"></td>
    <td><button type="button" class="deleteBtn" title="Supprimer">✖</button></td>
  `;

  document.getElementById("lootBody").appendChild(tr);

  tr.querySelector(".deleteBtn").addEventListener("click", () => {
    tr.remove();
    calculerTout();
    saveState();
  });

  tr.querySelector(".manualPrice").addEventListener("input", () => {
    calculerTout();
    saveState();
  });

  tr.querySelector(".lootQty").addEventListener("input", () => {
    calculerTout();
    saveState();
  });

  tr.querySelector(".lootItem").addEventListener("input", () => saveState());

  return tr;
}

// =======================
// MISE À JOUR PRIX (auto depuis prices.json)
// =======================
function updatePrice(input) {
  const name = (input.value || "").trim().toLowerCase();
  const row = input.closest("tr");

  // manuel => pas d'auto
  if (row.classList.contains("manualRow")) {
    calculerTout();
    return;
  }

  const priceCell = row.querySelector(".lootPrice");
  const found = currencyMap.get(name);

  if (found) {
    priceCell.textContent = Number(found.amount || 0).toFixed(2);
    priceCell.dataset.unit = found.unit || "";
  } else {
    priceCell.textContent = "0";
    priceCell.dataset.unit = "";
  }

  calculerTout();
}

// =======================
// CALCULS (Invest + Loot + Gains)
// =======================

function calculerInvest() {
  // Base simple: somme des inputs (en "chaos" pour le moment)
  // Tu pourras remplacer par tes formules Excel quand tu veux.
  const totalChaos =
    num("maps") +
    num("invest_tablets") +
    num("invest_omen") +
    num("invest_maps");

  setText("totalInvest", totalChaos.toFixed(2));
  return totalChaos;
}

function calculerLoot() {
  let total = 0;

  document.querySelectorAll("#lootBody tr").forEach(row => {
    let price = 0;
    let qty = 0;

    if (row.classList.contains("manualRow")) {
      price = Number(row.querySelector(".manualPrice")?.value) || 0;
      qty = Number(row.querySelector(".lootQty")?.value) || 0;
    } else {
      price = Number(row.querySelector(".lootPrice")?.textContent) || 0;
      qty = Number(row.querySelector(".lootQty")?.value) || 0;
    }

    total += price * qty;
  });

  setText("totalLoot", total.toFixed(2));
  return total;
}

function calculerTout() {
  const invest = calculerInvest();
  const loot = calculerLoot();
  const gains = loot - invest;

  setText("gain", gains.toFixed(2));
}

// =======================
// LOCALSTORAGE
// =======================
function saveState() {
  const rows = [...document.querySelectorAll("#lootBody tr")].map(r => {
    const isManual = r.classList.contains("manualRow");
    return {
      manual: isManual,
      item: r.querySelector(".lootItem")?.value || "",
      qty: Number(r.querySelector(".lootQty")?.value || 0),
      price: isManual ? Number(r.querySelector(".manualPrice")?.value || 0) : null
    };
  });

  const invest = {
    maps: document.getElementById("maps")?.value ?? "",
    invest_tablets: document.getElementById("invest_tablets")?.value ?? "",
    invest_omen: document.getElementById("invest_omen")?.value ?? "",
    invest_maps: document.getElementById("invest_maps")?.value ?? ""
  };

  localStorage.setItem("poe2FarmState", JSON.stringify({ rows, invest }));
}

function clearLootRows() {
  const body = document.getElementById("lootBody");
  if (body) body.innerHTML = "";
}

function loadState() {
  const raw = localStorage.getItem("poe2FarmState");
  if (!raw) return;

  try {
    const state = JSON.parse(raw);

    // restore invest
    if (state?.invest) {
      Object.keys(state.invest).forEach(k => {
        const el = document.getElementById(k);
        if (el) el.value = state.invest[k];
      });
    }

    if (!state?.rows) return;

    clearLootRows();

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

    calculerTout();
  } catch {
    // ignore
  }
}

// =======================
// RESET TEMPLATE (tout vide + 1 ligne)
// =======================
function resetAll() {
  localStorage.removeItem("poe2FarmState");

  ["maps", "invest_tablets", "invest_omen", "invest_maps"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  clearLootRows();
  const tr = addLootLine();
  tr.querySelector(".lootItem").value = "";
  tr.querySelector(".lootQty").value = 0;
  tr.querySelector(".lootPrice").textContent = "0";

  setText("totalInvest", "0");
  setText("totalLoot", "0");
  setText("gain", "0");

  setStatus("Fetch status: reset ✅");
  saveState();
}
window.resetAll = resetAll;

// =======================
// INIT + EVENTS
// =======================
document.addEventListener("DOMContentLoaded", () => {
  // recherche colonne gauche
  const search = document.getElementById("currencySearch");
  if (search) search.addEventListener("input", renderCurrencyPanel);

  // recalcul invest sur saisie
  ["maps", "invest_tablets", "invest_omen", "invest_maps"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => { calculerTout(); saveState(); });
  });

  // boutons
  window.addLootLine = addLootLine;
  window.addManualLine = addManualLine;
  window.loadCurrencies = loadCurrencies;

  // init data
  loadCurrencies();
  loadState();

  if (!document.querySelector("#lootBody tr")) addLootLine();

  calculerTout();
});
