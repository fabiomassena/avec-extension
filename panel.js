// panel.js

let state = {};

// ── DEBUG UTILS (disponíveis no console) ──────────────────────────────
window.debugStorage = () => {
  chrome.runtime.sendMessage({ action: "debugStorage" }, (res) => {
    console.log("[DEBUG] Storage completo:", res?.data);
  });
};

window.debugCounters = () => {
  chrome.runtime.sendMessage({ action: "getState" }, (s) => {
    console.log("[DEBUG] Contadores:", s?.counters);
  });
};

window.debugHistory = () => {
  chrome.runtime.sendMessage({ action: "getState" }, (s) => {
    console.log("[DEBUG] Histórico:", s?.history);
  });
};

window.debugClear = () => {
  if (confirm("⚠️ TEM CERTEZA? Isso apagará TODOS os dados do rodízio!")) {
    chrome.storage.local.clear(() => {
      console.log("[DEBUG] Storage limpo. Recarregue o painel.");
      alert("Storage limpo. Recarregue a página (F5).");
    });
  }
};

// ── TABS ──────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + tab).classList.add("active");
  });
});

// Abre na aba correta se vier da URL
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get("tab") === "settings") {
  document.querySelector('[data-tab="settings"]').click();
}

// ── LOAD STATE ────────────────────────────────────────────────────────
function loadState() {
  chrome.runtime.sendMessage({ action: "getState" }, (s) => {
    state = s || {};
    renderAll();
  });
}

function renderAll() {
  renderKPIs();
  renderRanking();
  renderHistory();
  renderSettings();
  renderProfServices();
}

// ── KPIs ──────────────────────────────────────────────────────────────
function renderKPIs() {
  const today = new Date().toDateString();
  const history = state.history || [];
  document.getElementById("kpiTotal").textContent   = history.length;
  document.getElementById("kpiToday").textContent   = history.filter(h => new Date(h.date).toDateString() === today).length;
  document.getElementById("kpiProfs").textContent   = (state.professionals || []).filter(p => p.active).length;
  document.getElementById("kpiServices").textContent = (state.serviceTypes || []).length;
}

// ── RANKING ───────────────────────────────────────────────────────────
function renderRanking() {
  const grid           = document.getElementById("rankingGrid");
  const services       = state.serviceTypes || [];
  const profs          = state.professionals || [];
  const counters       = state.counters || {};
  const serviceGroupsMap = state.serviceGroups || {};
  const cats           = state.serviceCategories || [];

  if (!services.length || !profs.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="icon">⚙️</div>
        <p>Cadastre profissionais e tipos de serviço<br>na aba <strong>Configurações</strong> para ver o ranking.</p>
      </div>`;
    return;
  }

  // Agrupa serviços: prioridade DOM > categoria > individual
  const groupsMap = new Map();
  services.forEach(s => {
    const domGroupName = serviceGroupsMap[s.id];
    const catName      = cats.find(c => c.id === s.categoryId)?.name;
    const groupName    = domGroupName || catName;
    if (groupName) {
      if (!groupsMap.has(groupName)) {
        groupsMap.set(groupName, { label: groupName, serviceIds: [], isGroup: true });
      }
      groupsMap.get(groupName).serviceIds.push(s.id);
    } else {
      groupsMap.set(s.id, { label: s.name, serviceIds: [s.id], isGroup: false });
    }
  });

  // Calcula total de atendimentos por grupo
  const groupData = [];
  for (const grp of groupsMap.values()) {
    let total = 0;
    for (const sid of grp.serviceIds) {
      total += Object.values(counters[sid] || {}).reduce((a, b) => a + b, 0);
    }
    if (total > 0) groupData.push({ ...grp, total });
  }
  groupData.sort((a, b) => b.total - a.total);

  if (!groupData.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="icon">📋</div>
        <p>Nenhum atendimento registrado ainda.<br>O ranking aparecerá conforme os agendamentos forem sendo registrados.</p>
      </div>`;
    return;
  }

  // Fila de próximos para um grupo (contadores agregados de todos os serviços do grupo)
  function getQueueForGroup(serviceIds, qtd) {
    const allProfs = profs.filter(p => p.active);
    const profSvcs = state.profServices || {};

    const eligible = allProfs.filter(p => {
      const svcs = profSvcs[p.id];
      if (!svcs || svcs.length === 0) return true;
      return serviceIds.some(sid => svcs.includes(sid));
    });
    if (!eligible.length) return [];

    const tempCounters = {};
    eligible.forEach(p => {
      tempCounters[p.id] = serviceIds.reduce((sum, sid) => sum + (counters[sid]?.[p.id] || 0), 0);
    });

    // Último atendido: qualquer serviço do grupo
    let lastId = null;
    for (const sid of serviceIds) {
      if (state.lastServed?.[sid]) { lastId = state.lastServed[sid]; break; }
    }

    const queue = [];
    for (let i = 0; i < qtd; i++) {
      const next = [...eligible].sort((a, b) => {
        const ca = tempCounters[a.id], cb = tempCounters[b.id];
        if (ca !== cb) return ca - cb;
        if (a.id === lastId) return 1;
        if (b.id === lastId) return -1;
        return 0;
      })[0];
      if (!next) break;
      queue.push(next);
      tempCounters[next.id]++;
      lastId = next.id;
    }
    return queue;
  }

  const COLS = 4;
  const headerCols = Array.from({ length: COLS }, (_, i) =>
    `<th>${i + 1}º Próximo</th>`
  ).join("");

  const rows = groupData.map(grp => {
    const queue = getQueueForGroup(grp.serviceIds, COLS);
    const cells = Array.from({ length: COLS }, (_, i) => {
      const p = queue[i];
      return p
        ? `<td class="queue-cell">${p.name}</td>`
        : `<td class="queue-cell queue-empty">–</td>`;
    }).join("");

    // Subtítulo com nomes dos serviços do grupo (quando há mais de 1)
    const serviceNames = grp.serviceIds
      .map(sid => services.find(s => s.id === sid)?.name)
      .filter(Boolean);
    const subtitle = grp.isGroup && serviceNames.length > 1
      ? `<div style="font-size:10px;color:var(--muted);font-weight:400;margin-top:2px;line-height:1.4">${serviceNames.join(" · ")}</div>`
      : "";

    return `<tr class="ranking-row" data-service="${grp.label.toLowerCase()}">
      <td class="service-name-cell">
        <div><span>${grp.label}</span>${subtitle}</div>
        <span class="service-total-badge">${grp.total}</span>
      </td>
      ${cells}
    </tr>`;
  }).join("");

  grid.innerHTML = `
    <div class="ranking-search-wrap" style="grid-column:1/-1;margin-bottom:16px">
      <input type="text" id="rankingSearch" placeholder="🔍 Buscar grupo ou serviço..." class="ranking-search" />
    </div>
    <div style="grid-column:1/-1;overflow-x:auto">
      <table class="ranking-table">
        <thead>
          <tr>
            <th class="ranking-th-service">Grupo / Serviço</th>
            ${headerCols}
          </tr>
        </thead>
        <tbody id="rankingBody">${rows}</tbody>
      </table>
    </div>`;

  document.getElementById("rankingSearch").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    document.querySelectorAll(".ranking-row").forEach(row => {
      row.style.display = !q || row.dataset.service.includes(q) ? "" : "none";
    });
  });
}

// ── HISTÓRICO ─────────────────────────────────────────────────────────
function renderHistory() {
  const container = document.getElementById("historyContainer");
  if (!container) return;

  const profs    = state.professionals || [];
  const services = state.serviceTypes  || [];
  const history  = state.history || [];

  // Salva seleção atual antes de repopular
  const fProf = document.getElementById("filterProf");
  const fServ = document.getElementById("filterServ");
  const selProf = fProf?.value || "";
  const selServ = fServ?.value || "";

  // Sempre repopula com todos os dados
  if (fProf) {
    fProf.innerHTML = '<option value="">Todos os profissionais</option>' +
      profs.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
    fProf.value = selProf;
  }
  if (fServ) {
    fServ.innerHTML = '<option value="">Todos os serviços</option>' +
      services.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
    fServ.value = selServ;
  }

  applyHistoryFilters();
}

function applyHistoryFilters() {
  const history  = state.history || [];
  const body     = document.getElementById("historyBody");
  if (!body) return;

  const profId   = document.getElementById("filterProf")?.value || "";
  const servId   = document.getElementById("filterServ")?.value || "";
  const dateFrom = document.getElementById("filterDateFrom")?.value || "";
  const dateTo   = document.getElementById("filterDateTo")?.value   || "";

  const filtered = history.filter(h => {
    if (profId && h.professionalId !== profId) return false;
    if (servId && h.serviceTypeId  !== servId) return false;
    if (dateFrom) {
      const hDate = new Date(h.date).toISOString().slice(0,10);
      if (hDate < dateFrom) return false;
    }
    if (dateTo) {
      const hDate = new Date(h.date).toISOString().slice(0,10);
      if (hDate > dateTo) return false;
    }
    return true;
  });

  // Atualiza contador
  const countEl = document.getElementById("historyCount");
  if (countEl) countEl.textContent = `${filtered.length} registro${filtered.length !== 1 ? "s" : ""}`;

  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--muted)">
      Nenhum registro encontrado para os filtros selecionados.</td></tr>`;
    return;
  }

  body.innerHTML = filtered.map(h => {
    const date    = new Date(h.date);
    const dateStr = date.toLocaleDateString("pt-BR") + " " +
      date.toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit" });
    const src      = h.source === "manual" ? "manual" : "auto";
    const srcLabel = h.source === "manual" ? "Manual" : "Automático";
    return `<tr>
      <td>${dateStr}</td>
      <td>${h.client || "<span style='color:var(--muted)'>–</span>"}</td>
      <td>${h.serviceTypeName}</td>
      <td>${h.professionalName}</td>
      <td><span class="source-badge ${src}">${srcLabel}</span></td>
    </tr>`;
  }).join("");

  // Armazena para exportação
  window._filteredHistory = filtered;
}

function exportHistory() {
  const data = (window._filteredHistory || state.history || []);
  if (!data.length) return;

  const headers = ["Data/Hora","Cliente","Serviço","Profissional","Origem"];
  const rows    = data.map(h => {
    const date = new Date(h.date).toLocaleString("pt-BR");
    return [
      date,
      h.client || "",
      h.serviceTypeName,
      h.professionalName,
      h.source === "manual" ? "Manual" : "Automático"
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(",");
  });

  const csv  = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `historico-rodizio-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── CONFIGURAÇÕES ─────────────────────────────────────────────────────
function renderSettings() {
  renderCategoryList();
  renderProfList();
  renderServiceList();
  // Sincroniza o select de categoria no formulário de adicionar serviço
  const catSelect = document.getElementById("newServiceCategory");
  if (catSelect) {
    const cats   = state.serviceCategories || [];
    const saved  = catSelect.value;
    catSelect.innerHTML = '<option value="">Sem categoria</option>' +
      cats.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
    catSelect.value = saved;
  }
}

function renderCategoryList() {
  const list = document.getElementById("categoryList");
  if (!list) return;
  const cats     = state.serviceCategories || [];
  const services = state.serviceTypes || [];

  if (!cats.length) {
    list.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:13px;padding:16px">Nenhuma categoria cadastrada</div>`;
    return;
  }

  list.innerHTML = cats.map(c => {
    const count = services.filter(s => s.categoryId === c.id).length;
    return `
    <div class="item-row">
      <span class="item-label">${c.name}</span>
      <span style="font-size:11px;color:var(--muted);background:var(--border);border-radius:20px;padding:1px 8px;white-space:nowrap;flex-shrink:0">
        ${count} serviço${count !== 1 ? "s" : ""}
      </span>
      <button class="edit-btn" data-id="${c.id}" data-name="${escapeAttr(c.name)}" data-type="category" title="Renomear">✏️</button>
      <button class="del-btn" data-id="${c.id}" title="Remover">🗑</button>
    </div>`;
  }).join("");

  list.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => openInlineEdit(btn, "category"));
  });
  list.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const count = services.filter(s => s.categoryId === btn.dataset.id).length;
      const msg = count > 0
        ? `Remover esta categoria? Os ${count} serviço(s) vinculados ficarão sem categoria.`
        : "Remover esta categoria?";
      if (confirm(msg)) {
        chrome.runtime.sendMessage({ action: "removeServiceCategory", id: btn.dataset.id }, () => loadState());
      }
    });
  });
}

function renderProfList() {
  const list  = document.getElementById("profList");
  const profs = state.professionals || [];

  if (!profs.length) {
    list.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:13px;padding:16px">Nenhum profissional cadastrado</div>`;
    return;
  }

  list.innerHTML = profs.map(p => `
    <div class="item-row" data-id="${p.id}">
      <div class="${p.active ? "active-dot" : "inactive-dot"}"></div>
      <span class="item-label">${p.name}</span>
      <button class="edit-btn" data-id="${p.id}" data-name="${escapeAttr(p.name)}" data-type="prof" title="Renomear">✏️</button>
      <button class="toggle-btn" data-id="${p.id}" title="${p.active ? "Desativar" : "Ativar"}">
        ${p.active ? "⏸" : "▶️"}
      </button>
      <button class="del-btn" data-id="${p.id}" title="Remover">🗑</button>
    </div>`).join("");

  list.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => openInlineEdit(btn, "prof"));
  });
  list.querySelectorAll(".toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "toggleProfessional", id: btn.dataset.id }, () => loadState());
    });
  });
  list.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (confirm("Remover este profissional? Os dados de contagem serão perdidos.")) {
        chrome.runtime.sendMessage({ action: "removeProfessional", id: btn.dataset.id }, () => loadState());
      }
    });
  });
}

function renderServiceList() {
  const list     = document.getElementById("serviceList");
  const services = state.serviceTypes || [];
  const cats     = state.serviceCategories || [];

  if (!services.length) {
    list.innerHTML = `<div style="text-align:center;color:var(--muted);font-size:13px;padding:16px">Nenhum serviço cadastrado</div>`;
    return;
  }

  list.innerHTML = services.map(s => `
    <div class="item-row">
      <span class="item-label">${s.name}</span>
      <select class="cat-select" data-id="${s.id}">
        ${cats.map(c => `<option value="${c.id}" ${s.categoryId === c.id ? "selected" : ""}>${c.name}</option>`).join("")}
        <option value="" ${!s.categoryId ? "selected" : ""}>Sem categoria</option>
      </select>
      <button class="edit-btn" data-id="${s.id}" data-name="${escapeAttr(s.name)}" data-type="service" title="Renomear">✏️</button>
      <button class="del-btn" data-id="${s.id}" title="Remover">🗑</button>
    </div>`).join("");

  list.querySelectorAll(".cat-select").forEach(sel => {
    sel.addEventListener("change", () => {
      chrome.runtime.sendMessage({
        action: "setServiceCategory",
        id: sel.dataset.id,
        categoryId: sel.value || null
      }, () => loadState());
    });
  });
  list.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => openInlineEdit(btn, "service"));
  });
  list.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (confirm("Remover este tipo de serviço? O histórico de contagens será perdido.")) {
        chrome.runtime.sendMessage({ action: "removeServiceType", id: btn.dataset.id }, () => loadState());
      }
    });
  });
}

// ── EVENTOS DOS FILTROS DO HISTÓRICO ─────────────────────────────────
document.addEventListener("change", (e) => {
  if (["filterProf","filterServ","filterDateFrom","filterDateTo"].includes(e.target.id)) {
    applyHistoryFilters();
  }
});

document.addEventListener("click", (e) => {
  if (e.target.id === "filterClearBtn") {
    document.getElementById("filterProf").value      = "";
    document.getElementById("filterServ").value      = "";
    document.getElementById("filterDateFrom").value  = "";
    document.getElementById("filterDateTo").value    = "";
    applyHistoryFilters();
  }
  if (e.target.id === "exportHistoryBtn") exportHistory();
});


document.getElementById("addProfBtn").addEventListener("click", () => {
  const input = document.getElementById("newProfName");
  const name  = input.value.trim();
  if (!name) return;
  chrome.runtime.sendMessage({ action: "addProfessional", name }, () => {
    input.value = "";
    loadState();
  });
});
document.getElementById("newProfName").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("addProfBtn").click();
});

// ── ADICIONAR CATEGORIA ───────────────────────────────────────────────
document.getElementById("addCategoryBtn").addEventListener("click", () => {
  const input = document.getElementById("newCategoryName");
  const name  = input.value.trim();
  if (!name) return;
  chrome.runtime.sendMessage({ action: "addServiceCategory", name }, () => {
    input.value = "";
    loadState();
  });
});
document.getElementById("newCategoryName").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("addCategoryBtn").click();
});

// ── ADICIONAR SERVIÇO ─────────────────────────────────────────────────
document.getElementById("addServiceBtn").addEventListener("click", () => {
  const input      = document.getElementById("newServiceName");
  const name       = input.value.trim();
  if (!name) return;
  const categoryId = document.getElementById("newServiceCategory")?.value || null;
  chrome.runtime.sendMessage({ action: "addServiceType", name, categoryId: categoryId || null }, () => {
    input.value = "";
    loadState();
  });
});
document.getElementById("newServiceName").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("addServiceBtn").click();
});

// ── EDIÇÃO INLINE ─────────────────────────────────────────────────────
function escapeAttr(str) {
  return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function openInlineEdit(btn, type) {
  const row      = btn.closest(".item-row");
  const labelEl  = row.querySelector(".item-label");
  const id       = btn.dataset.id;
  const oldName  = btn.dataset.name;

  // Evita abrir dois inputs ao mesmo tempo
  if (row.querySelector(".inline-input")) return;

  // Esconde o label e botões de ação
  const actionBtns = row.querySelectorAll("button");
  labelEl.style.display = "none";
  actionBtns.forEach(b => b.style.display = "none");

  // Cria input inline
  const inputWrap = document.createElement("div");
  inputWrap.style.cssText = "display:flex;gap:6px;flex:1;align-items:center;";
  inputWrap.innerHTML = `
    <input class="inline-input" type="text" value="${escapeAttr(oldName)}"
      style="flex:1;background:var(--bg);border:1px solid var(--purple);border-radius:6px;
             color:var(--text);padding:5px 10px;font-size:13px;outline:none;" />
    <button class="inline-save" style="background:var(--purple);color:#fff;border:none;
      border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;font-weight:600;">✓</button>
    <button class="inline-cancel" style="background:var(--border);color:var(--muted);border:none;
      border-radius:6px;padding:5px 10px;font-size:12px;cursor:pointer;">✕</button>
  `;
  row.appendChild(inputWrap);

  const input      = inputWrap.querySelector(".inline-input");
  const saveBtn    = inputWrap.querySelector(".inline-save");
  const cancelBtn  = inputWrap.querySelector(".inline-cancel");

  input.focus();
  input.select();

  function cancel() {
    inputWrap.remove();
    labelEl.style.display = "";
    actionBtns.forEach(b => b.style.display = "");
  }

  function save() {
    const newName = input.value.trim();
    if (!newName || newName === oldName) { cancel(); return; }
    const action = type === "prof" ? "renameProfessional" :
                   type === "service" ? "renameServiceType" :
                   "renameServiceCategory";
    chrome.runtime.sendMessage({ action, id, name: newName }, () => loadState());
  }

  saveBtn.addEventListener("click", save);
  cancelBtn.addEventListener("click", cancel);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancel();
  });
}

// ── SERVIÇOS POR PROFISSIONAL ──────────────────────────────────────────
let _psCurrentProfId = null;
let _psGroupFilter   = "";

function renderProfServices() {
  const profs    = state.professionals || [];
  const profSvcs = state.profServices  || {};
  const sidebar  = document.getElementById("psSidebarList");
  if (!sidebar) return;

  if (!profs.length) {
    sidebar.innerHTML = `<div style="padding:16px;font-size:13px;color:var(--muted);text-align:center">Nenhum profissional cadastrado</div>`;
    return;
  }

  sidebar.innerHTML = profs.map(p => {
    const enabled = (profSvcs[p.id] || []).length;
    const isActive = p.id === _psCurrentProfId;
    return `<div class="ps-prof-item${isActive ? " active" : ""}" data-id="${p.id}">
      <div class="ps-prof-dot" style="background:${p.active ? "var(--success)" : "var(--muted)"}"></div>
      <span>${p.name}</span>
      <span class="ps-prof-badge">${enabled}</span>
    </div>`;
  }).join("");

  sidebar.querySelectorAll(".ps-prof-item").forEach(item => {
    item.addEventListener("click", () => {
      _psCurrentProfId = item.dataset.id;
      renderProfServices();
      renderPsEditor();
    });
  });

  if (_psCurrentProfId) renderPsEditor();
}

function renderPsEditor() {
  const prof     = (state.professionals || []).find(p => p.id === _psCurrentProfId);
  const services = state.serviceTypes  || [];
  const profSvcs = state.profServices  || {};
  const enabled  = new Set(profSvcs[_psCurrentProfId] || services.map(s => s.id)); // default: todos habilitados

  const emptyEl  = document.getElementById("psEmptyState");
  const editorEl = document.getElementById("psEditor");
  if (!prof) { emptyEl.style.display = ""; editorEl.style.display = "none"; return; }

  emptyEl.style.display  = "none";
  editorEl.style.display = "block";
  document.getElementById("psProfName").textContent = prof.name;

  if (!services.length) {
    document.getElementById("psServiceTable").innerHTML =
      `<div style="padding:32px;text-align:center;color:var(--muted);font-size:13px">Nenhum serviço cadastrado ainda.</div>`;
    return;
  }

  const allGrouped = groupServices(services);
  const groupLabels = allGrouped.map(g => g.label);

  // Valida o filtro atual (pode ter sido definido por outro profissional)
  if (_psGroupFilter && !groupLabels.includes(_psGroupFilter)) _psGroupFilter = "";

  const grouped = _psGroupFilter
    ? allGrouped.filter(g => g.label === _psGroupFilter)
    : allGrouped;

  // Dropdown de filtro (só aparece se houver mais de 1 grupo)
  const filterHtml = groupLabels.length > 1 ? `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;
                padding:10px 14px;background:var(--surface);
                border:1px solid var(--border);border-radius:8px;">
      <span style="font-size:12px;color:var(--muted);font-weight:600;white-space:nowrap">
        Filtrar grupo:
      </span>
      <select id="psGroupFilter"
        style="background:var(--bg);border:1px solid var(--border);border-radius:6px;
               color:var(--text);padding:5px 10px;font-size:13px;outline:none;flex:1;max-width:240px">
        <option value="">Todos os grupos</option>
        ${groupLabels.map(g =>
          `<option value="${g}" ${g === _psGroupFilter ? "selected" : ""}>${g}</option>`
        ).join("")}
      </select>
    </div>` : "";

  const tableHtml = grouped.map(group => {
    const allChecked  = group.items.every(s => enabled.has(s.id));
    const someChecked = group.items.some(s => enabled.has(s.id));

    const rows = group.items.map(s => `
      <div class="ps-service-row${enabled.has(s.id) ? " checked" : ""}" data-id="${s.id}">
        <input type="checkbox" data-id="${s.id}" ${enabled.has(s.id) ? "checked" : ""} />
        <span class="ps-service-name">${s.name}</span>
      </div>`).join("");

    return `<div class="ps-group">
      <div class="ps-group-header" data-group="${group.label}">
        <input type="checkbox" class="group-check" data-group="${group.label}"
          ${allChecked ? "checked" : ""} ${!allChecked && someChecked ? "indeterminate" : ""} />
        ${group.label}
        <span style="margin-left:auto;font-size:11px;color:var(--muted);font-weight:400">
          ${group.items.filter(s => enabled.has(s.id)).length}/${group.items.length}
        </span>
      </div>
      <div class="ps-group-body">${rows}</div>
    </div>`;
  }).join("");

  document.getElementById("psServiceTable").innerHTML = filterHtml + tableHtml;

  // Bind do filtro de grupo
  const filterEl = document.getElementById("psGroupFilter");
  if (filterEl) {
    filterEl.addEventListener("change", () => {
      _psGroupFilter = filterEl.value;
      renderPsEditor();
    });
  }

  // Marca indeterminate via JS (não dá via HTML)
  document.querySelectorAll(".group-check").forEach(cb => {
    if (cb.dataset && cb.hasAttribute("indeterminate")) cb.indeterminate = true;
  });
  grouped.forEach(group => {
    const cb = document.querySelector(`.group-check[data-group="${CSS.escape(group.label)}"]`);
    const allC  = group.items.every(s => enabled.has(s.id));
    const someC = group.items.some(s => enabled.has(s.id));
    if (cb && !allC && someC) cb.indeterminate = true;
  });

  // Checkbox individual
  document.querySelectorAll(".ps-service-row input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", () => {
      const row = cb.closest(".ps-service-row");
      row.classList.toggle("checked", cb.checked);
      updateGroupCheck(cb.closest(".ps-group"));
    });
  });

  // Checkbox de grupo
  document.querySelectorAll(".group-check").forEach(cb => {
    cb.addEventListener("change", () => {
      const group = cb.closest(".ps-group");
      group.querySelectorAll(".ps-service-row input[type=checkbox]").forEach(c => {
        c.checked = cb.checked;
        c.closest(".ps-service-row").classList.toggle("checked", cb.checked);
      });
      cb.indeterminate = false;
    });
  });
}

function updateGroupCheck(groupEl) {
  if (!groupEl) return;
  const boxes = groupEl.querySelectorAll(".ps-service-row input[type=checkbox]");
  const all   = [...boxes].every(c => c.checked);
  const some  = [...boxes].some(c => c.checked);
  const cb    = groupEl.querySelector(".group-check");
  if (cb) { cb.checked = all; cb.indeterminate = !all && some; }
}

function groupServices(services) {
  const svcGroups = state.serviceGroups || {}; // { rodizioId -> groupName } do storage
  const cats      = state.serviceCategories || [];
  const map = {};
  services.forEach(s => {
    // Prioridade: grupo do DOM Avec > categoria manual > prefixo do nome > "Geral"
    const catName = cats.find(c => c.id === s.categoryId)?.name;
    const cat = svcGroups[s.id]
      || catName
      || (s.name.includes(" - ") || s.name.includes(" – ")
          ? s.name.split(/\s*[-–]\s*/)[0].trim()
          : "Geral");
    if (!map[cat]) map[cat] = [];
    map[cat].push(s);
  });
  return Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, items]) => ({ label, items }));
}

// Marcar / Desmarcar todos
document.addEventListener("click", e => {
  if (e.target.id === "psSelectAll") {
    document.querySelectorAll(".ps-service-row input[type=checkbox]").forEach(c => {
      c.checked = true;
      c.closest(".ps-service-row").classList.add("checked");
    });
    document.querySelectorAll(".group-check").forEach(c => { c.checked = true; c.indeterminate = false; });
  }
  if (e.target.id === "psSelectNone") {
    document.querySelectorAll(".ps-service-row input[type=checkbox]").forEach(c => {
      c.checked = false;
      c.closest(".ps-service-row").classList.remove("checked");
    });
    document.querySelectorAll(".group-check").forEach(c => { c.checked = false; c.indeterminate = false; });
  }
  if (e.target.id === "psSaveBtn") saveProfServices();
});

function saveProfServices() {
  const checked = [...document.querySelectorAll(".ps-service-row input[type=checkbox]:checked")]
    .map(c => c.dataset.id);

  chrome.runtime.sendMessage({ action: "setProfServices", profId: _psCurrentProfId, serviceIds: checked }, () => {
    const btn = document.getElementById("psSaveBtn");
    btn.textContent = "✅ Salvo!";
    btn.classList.add("saved");
    setTimeout(() => { btn.textContent = "💾 Salvar"; btn.classList.remove("saved"); }, 1800);
    // Atualiza badge na sidebar sem recarregar tudo
    chrome.runtime.sendMessage({ action: "getState" }, s => {
      state = s || {};
      const sidebar = document.getElementById("psSidebarList");
      const item = sidebar?.querySelector(`.ps-prof-item[data-id="${_psCurrentProfId}"] .ps-prof-badge`);
      if (item) item.textContent = checked.length;
    });
  });
}

// ── LIVE UPDATE via storage changes ──────────────────────────────────
chrome.storage.onChanged.addListener(() => loadState());

// ── GOOGLE SHEETS IMPORT ─────────────────────────────────────────────

let _importData = { profissionais: [], servicos: [] };

// Extrai o ID da planilha a partir de qualquer formato de link do Google Sheets
function extractSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// Busca uma aba pelo nome via API CSV pública do Google Sheets
// URL: https://docs.google.com/spreadsheets/d/{id}/gviz/tq?tqx=out:csv&sheet={name}
async function fetchSheetCsv(sheetId, sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Aba "${sheetName}" não encontrada ou planilha sem acesso público.`);
  return await res.text();
}

// Parser CSV simples (lida com aspas, vírgulas e quebras de linha dentro de células)
function parseCsv(text) {
  const rows = [];
  let cells = [];
  let cur = '';
  let inQuote = false;
  
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    
    if (ch === '"') {
      if (inQuote && text[i+1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === ',' && !inQuote) {
      cells.push(cur.trim());
      cur = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuote) {
      if (cur || cells.length > 0) {
        cells.push(cur.trim());
        if (cells.length > 0) rows.push(cells);
        cells = [];
        cur = '';
      }
      if (ch === '\r' && text[i+1] === '\n') i++;
    } else {
      cur += ch;
    }
  }
  
  // Última linha
  if (cur || cells.length > 0) {
    cells.push(cur.trim());
    rows.push(cells);
  }
  
  return rows;
}

// Extrai coluna "nome" de um CSV parseado
function extractNamesFromCsv(rows) {
  if (!rows.length) return null;
  const header = rows[0].map(h => h.toLowerCase().replace(/["']/g, '').trim());
  const col = header.findIndex(h => h === 'nome' || h === 'name');
  if (col === -1) return null;
  return rows.slice(1)
    .map(r => (r[col] || '').replace(/^"|"$/g, '').trim())
    .filter(n => n.length > 0);
}

// Extrai colunas "nome" e "categoria" de um CSV de serviços.
// Cada linha deve ter nome e categoria explícitos.
function extractServicesFromCsv(rows) {
  if (!rows.length) return null;
  const header = rows[0].map(h => h.toLowerCase().replace(/["']/g, '').trim());
  const nomeCol = header.findIndex(h => h === 'nome' || h === 'name');
  if (nomeCol === -1) return null;
  const catCol = header.findIndex(h =>
    ['categoria', 'category', 'grupo', 'group', 'tipo', 'type', 'cat'].includes(h)
  );

  const cleanVal  = raw => (raw || '').replace(/^"|"$/g, '').trim();
  const cleanName = raw => cleanVal(raw).replace(/^[\s,;.\-–—*_|#>]+/, '').trim();

  return rows.slice(1)
    .map(r => ({
      name: cleanName(r[nomeCol]),
      categoria: catCol >= 0 ? cleanVal(r[catCol]) : ''
    }))
    .filter(s => s.name.length > 0);
}

function showImportPreview(profNames, services) {
  chrome.runtime.sendMessage({ action: 'getState' }, (s) => {
    const existingProfs = (s.professionals || []).map(p => p.name.toLowerCase());
    const existingSvcs  = (s.serviceTypes  || []).map(sv => sv.name.toLowerCase());

    const renderProfList = (names, existing, elId) => {
      const el = document.getElementById(elId);
      if (!names || !names.length) {
        el.innerHTML = `<div class="preview-item existing"><div class="dot"></div>Nenhum item encontrado</div>`;
        return;
      }
      el.innerHTML = names.map(n => {
        const isNew = !existing.includes(n.toLowerCase());
        return `<div class="preview-item ${isNew ? 'new' : 'existing'}">
          <div class="dot"></div>${n}${!isNew ? ' <small>(já existe)</small>' : ''}
        </div>`;
      }).join('');
    };

    const renderSvcList = (svcs, existing, elId) => {
      const el = document.getElementById(elId);
      if (!svcs || !svcs.length) {
        el.innerHTML = `<div class="preview-item existing"><div class="dot"></div>Nenhum item encontrado</div>`;
        return;
      }
      el.innerHTML = svcs.map(svc => {
        const isNew = !existing.includes(svc.name.toLowerCase());
        const catLabel = svc.categoria
          ? ` <small style="color:#a78bfa">[${svc.categoria}]</small>` : '';
        return `<div class="preview-item ${isNew ? 'new' : 'existing'}">
          <div class="dot"></div>${svc.name}${catLabel}${!isNew ? ' <small>(já existe)</small>' : ''}
        </div>`;
      }).join('');
    };

    renderProfList(profNames, existingProfs, 'previewProfs');
    renderSvcList(services, existingSvcs, 'previewServices');

    const newP = (profNames||[]).filter(n => !existingProfs.includes(n.toLowerCase())).length;
    const newS = (services||[]).filter(s => !existingSvcs.includes(s.name.toLowerCase())).length;
    document.getElementById('uploadMsg').textContent =
      `${newP} profissional(is) e ${newS} serviço(s) novos serão adicionados.`;

    document.getElementById('uploadPreview').style.display = 'block';
  });
}

// Botão Carregar
document.getElementById('gsImportBtn').addEventListener('click', async () => {
  const link    = document.getElementById('gsLinkInput').value.trim();
  const errEl   = document.getElementById('uploadError');
  const loadEl  = document.getElementById('gsLoading');
  const prevEl  = document.getElementById('uploadPreview');

  errEl.style.display  = 'none';
  prevEl.style.display = 'none';

  if (!link) {
    errEl.textContent = '⚠️ Cole o link da planilha antes de continuar.';
    errEl.style.display = 'block';
    return;
  }

  const sheetId = extractSheetId(link);
  if (!sheetId) {
    errEl.textContent = '❌ Link inválido. Use o link de compartilhamento do Google Sheets.';
    errEl.style.display = 'block';
    return;
  }

  loadEl.style.display = 'flex';

  try {
    // Tenta buscar as duas abas em paralelo
    const [profCsv, servCsv] = await Promise.allSettled([
      fetchSheetCsv(sheetId, 'Profissionais'),
      fetchSheetCsv(sheetId, 'Servicos'),
    ]);

    const profNames = profCsv.status === 'fulfilled'
      ? extractNamesFromCsv(parseCsv(profCsv.value))
      : null;
    const services = servCsv.status === 'fulfilled'
      ? extractServicesFromCsv(parseCsv(servCsv.value))
      : null;

    if (!profNames && !services) {
      throw new Error('Nenhuma aba "Profissionais" ou "Servicos" encontrada. Verifique os nomes das abas e se o acesso está público.');
    }
    if (profCsv.status === 'fulfilled' && profNames === null) {
      throw new Error('Aba "Profissionais" encontrada, mas não tem coluna "nome" no cabeçalho.');
    }
    if (servCsv.status === 'fulfilled' && services === null) {
      throw new Error('Aba "Servicos" encontrada, mas não tem coluna "nome" no cabeçalho.');
    }

    _importData = { profissionais: profNames || [], servicos: services || [] };
    showImportPreview(profNames, services);

  } catch(err) {
    errEl.textContent = `❌ ${err.message}`;
    errEl.style.display = 'block';
  } finally {
    loadEl.style.display = 'none';
  }
});

// Também dispara com Enter no campo de link
document.getElementById('gsLinkInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('gsImportBtn').click();
});

// Confirmar importação
document.getElementById('confirmImportBtn').addEventListener('click', () => {
  const { profissionais, servicos } = _importData;
  if (!profissionais.length && !servicos.length) return;

  chrome.runtime.sendMessage({ action: 'getState' }, (s) => {
    const existingProfs = (s.professionals || []).map(p => p.name.toLowerCase());
    const existingSvcs  = (s.serviceTypes  || []).map(sv => sv.name.toLowerCase());
    const existingCats  = s.serviceCategories || [];

    // Normaliza nome para comparação (remove acentos, lowercase)
    const normalize = str => str.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim();

    const newProfs = profissionais.filter(n => !existingProfs.includes(normalize(n)));
    const newSvcs  = servicos.filter(svc => !existingSvcs.includes(normalize(svc.name)));

    // Categorias únicas dos serviços que ainda não existem
    const catNames = [...new Set(newSvcs.map(svc => svc.categoria).filter(Boolean))];
    const newCatNames = catNames.filter(cn =>
      !existingCats.find(c => normalize(c.name) === normalize(cn))
    );

    const addAll = (items, action, done) => {
      if (!items.length) { done(); return; }
      const [first, ...rest] = items;
      chrome.runtime.sendMessage({ action, name: first }, () => addAll(rest, action, done));
    };

    // Adiciona serviços novos ou atualiza categoria de existentes
    const processSvcs = (svcs, allCats, allSvcs, done) => {
      if (!svcs.length) { done(); return; }
      const [first, ...rest] = svcs;
      
      // Busca categoria usando normalização
      const normalize = str => str.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .trim();
      
      const cat = allCats.find(c => normalize(c.name) === normalize(first.categoria || ''));
      const catId = cat?.id || null;
      const existing = allSvcs.find(s => normalize(s.name) === normalize(first.name));

      if (existing) {
        // Serviço já existe: atualiza categoria apenas se tiver uma
        // Se serviço existe mas não tem categoria, atualiza
        // Se serviço tem categoria diferente, atualiza
        const shouldUpdate = catId && (!existing.categoryId || existing.categoryId !== catId);
        
        if (shouldUpdate) {
          chrome.runtime.sendMessage(
            { action: 'setServiceCategory', id: existing.id, categoryId: catId },
            () => processSvcs(rest, allCats, allSvcs, done)
          );
        } else {
          processSvcs(rest, allCats, allSvcs, done);
        }
      } else {
        chrome.runtime.sendMessage(
          { action: 'addServiceType', name: first.name, categoryId: catId },
          () => processSvcs(rest, allCats, allSvcs, done)
        );
      }
    };

    addAll(newProfs, 'addProfessional', () => {
      addAll(newCatNames, 'addServiceCategory', () => {
        // Busca estado atualizado para ter os IDs das categorias recém-criadas
        chrome.runtime.sendMessage({ action: 'getState' }, (fresh) => {
          const allCats = fresh.serviceCategories || [];
          const allSvcs = fresh.serviceTypes      || [];
          processSvcs(servicos, allCats, allSvcs, () => {
            document.getElementById('uploadPreview').style.display = 'none';
            document.getElementById('gsLinkInput').value = '';
            _importData = { profissionais: [], servicos: [] };
            loadState();
          });
        });
      });
    });
  });
});


// ── DOWNLOAD PLANILHA MODELO ODS ──────────────────────────────────────

function crc32(data) {
  if (!crc32._t) {
    crc32._t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc32._t[i] = c;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = crc32._t[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(files) {
  // files: [{ name: string, data: Uint8Array, store: bool }]
  const enc = new TextEncoder();
  const entries = [];

  // Local file headers + data
  const localChunks = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const data = f.data;
    const crc  = crc32(data);
    const now  = new Date();
    const dt   = ((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
    const tm   = (now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1);

    const hdr = new Uint8Array(30 + nameBytes.length);
    const v   = new DataView(hdr.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true);
    v.setUint16(6, 0, true); v.setUint16(8, 0, true); // STORE
    v.setUint16(10, tm, true); v.setUint16(12, dt, true);
    v.setUint32(14, crc, true); v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true); v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, 0, true);
    hdr.set(nameBytes, 30);

    entries.push({ nameBytes, data, crc, dt, tm, offset });
    offset += hdr.length + data.length;
    localChunks.push(hdr, data);
  }

  // Central directory
  const cdChunks = [];
  const cdStart = offset;
  for (const e of entries) {
    const cdhdr = new Uint8Array(46 + e.nameBytes.length);
    const v = new DataView(cdhdr.buffer);
    v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true);
    v.setUint16(8, 0, true); v.setUint16(10, 0, true);
    v.setUint16(12, e.tm, true); v.setUint16(14, e.dt, true);
    v.setUint32(16, e.crc, true); v.setUint32(20, e.data.length, true);
    v.setUint32(24, e.data.length, true); v.setUint16(28, e.nameBytes.length, true);
    v.setUint16(30, 0, true); v.setUint16(32, 0, true); v.setUint16(34, 0, true);
    v.setUint16(36, 0, true); v.setUint32(38, 0, true); v.setUint32(42, e.offset, true);
    cdhdr.set(e.nameBytes, 46);
    cdChunks.push(cdhdr);
    offset += cdhdr.length;
  }

  const cdSize = offset - cdStart;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, cdStart, true); ev.setUint16(20, 0, true);

  const all = [...localChunks, ...cdChunks, eocd];
  const total = all.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of all) { out.set(c, pos); pos += c.length; }
  return out;
}

function generateOdsTemplate() {
  const enc = new TextEncoder();
  const mimetype = 'application/vnd.oasis.opendocument.spreadsheet';

  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet" manifest:version="1.3"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

  function cell(val) {
    return `<table:table-cell office:value-type="string"><text:p>${val}</text:p></table:table-cell>`;
  }
  function row(...vals) {
    return `<table:table-row>${vals.map(cell).join('')}</table:table-row>`;
  }

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  office:version="1.3">
  <office:body><office:spreadsheet>
    <table:table table:name="Profissionais">
      <table:table-column/>
      ${row('nome')}
      ${row('Ana Silva')}
      ${row('Carla Santos')}
      ${row('Marcos Oliveira')}
    </table:table>
    <table:table table:name="Servicos">
      <table:table-column table:number-columns-repeated="2"/>
      ${row('nome','categoria')}
      ${row('Corte','Cabelo')}
      ${row('Coloração','Cabelo')}
      ${row('Escova','Cabelo')}
      ${row('Manicure','Unhas')}
      ${row('Pedicure','Unhas')}
      ${row('Depilação','Estética')}
    </table:table>
  </office:spreadsheet></office:body>
</office:document-content>`;

  return buildZip([
    { name: 'mimetype',              data: enc.encode(mimetype) },
    { name: 'META-INF/manifest.xml', data: enc.encode(manifest) },
    { name: 'content.xml',           data: enc.encode(content)  },
  ]);
}

document.getElementById('gsTemplateLink').addEventListener('click', (e) => {
  e.preventDefault();
  const bytes = generateOdsTemplate();
  const blob  = new Blob([bytes], { type: 'application/vnd.oasis.opendocument.spreadsheet' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href = url; a.download = 'modelo-rodizio-avec.ods'; a.click();
  URL.revokeObjectURL(url);
});

// ── INIT ──────────────────────────────────────────────────────────────
console.log("[PANEL DEBUG] Panel iniciado, carregando estado...");
loadState();
