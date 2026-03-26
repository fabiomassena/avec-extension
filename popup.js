// popup.js

let state = {};

function getNext(serviceTypeId) {
  const allProfs = (state.professionals || []).filter(p => p.active);
  const profSvcs = state.profServices || {};
  const counters = state.counters?.[serviceTypeId] || {};
  const last     = state.lastServed?.[serviceTypeId];

  const profs = allProfs.filter(p => {
    const svcs = profSvcs[p.id];
    return !svcs || svcs.length === 0 || svcs.includes(serviceTypeId);
  });

  if (!profs.length) return null;
  return [...profs].sort((a, b) => {
    const ca = counters[a.id] || 0;
    const cb = counters[b.id] || 0;
    if (ca !== cb) return ca - cb;
    if (a.id === last) return 1;
    if (b.id === last) return -1;
    return 0;
  })[0];
}

function todayCount() {
  const today = new Date().toDateString();
  return (state.history || []).filter(h => new Date(h.date).toDateString() === today).length;
}

function render() {
  const profs = (state.professionals || []).filter(p => p.active);
  document.getElementById("totalProfs").textContent = profs.length;
  document.getElementById("totalToday").textContent = todayCount();

  const sel = document.getElementById("serviceFilter");
  const curVal = sel.value;
  sel.innerHTML = '<option value="">Selecione o serviço...</option>' +
    (state.serviceTypes || []).map(s =>
      `<option value="${s.id}" ${s.id === curVal ? "selected" : ""}>${s.name}</option>`
    ).join("");

  updateNext();
}

function updateNext() {
  const serviceId = document.getElementById("serviceFilter").value;
  const nameEl    = document.getElementById("nextName");
  const countEl   = document.getElementById("nextCount");

  if (!serviceId) {
    nameEl.textContent = "–";
    countEl.textContent = "";
    return;
  }
  const next = getNext(serviceId);
  if (!next) {
    nameEl.textContent = "Nenhum profissional";
    countEl.textContent = "";
    return;
  }
  const count = state.counters?.[serviceId]?.[next.id] || 0;
  nameEl.textContent = "👤 " + next.name;
  countEl.textContent = `${count} atendimento${count !== 1 ? "s" : ""} neste serviço`;
}

chrome.runtime.sendMessage({ action: "getState" }, (s) => {
  state = s || {};
  render();
});

document.getElementById("serviceFilter").addEventListener("change", updateNext);

document.getElementById("openPanel").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "openPanel" });
  window.close();
});

document.getElementById("undoBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "undoLast" }, (res) => {
    if (res.ok) {
      chrome.runtime.sendMessage({ action: "getState" }, (s) => {
        state = s || {};
        render();
      });
    }
  });
});

document.getElementById("openSettings").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("panel.html") + "?tab=settings" });
  window.close();
});
