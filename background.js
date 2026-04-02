// background.js

// ─── Estrutura de dados ───────────────────────────────────────────────
// professionals: [{ id, name, active }]
// serviceTypes:  [{ id, name }]
// counters:      { [serviceTypeId]: { [professionalId]: number } }
// lastServed:    { [serviceTypeId]: professionalId }
// history:       [{ id, date, client, serviceTypeId, serviceTypeName, professionalId, professionalName, source }]

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["professionals", "serviceTypes", "counters", "history", "serviceCategories"], (data) => {
    if (!data.professionals)     chrome.storage.local.set({ professionals: [] });
    if (!data.serviceTypes)      chrome.storage.local.set({ serviceTypes: [] });
    if (!data.counters)          chrome.storage.local.set({ counters: {} });
    if (!data.history)           chrome.storage.local.set({ history: [] });
    if (!data.serviceCategories) chrome.storage.local.set({ serviceCategories: [] });
  });
});

// ─── Mensagens recebidas ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {

    case "getState":
      chrome.storage.local.get(
        ["professionals", "serviceTypes", "counters", "history", "lastServed", "profServices", "serviceGroups", "serviceCategories"],
        (data) => sendResponse(data)
      );
      return true;

    case "debugStorage":
      // Função utilitária para inspecionar o storage via console
      chrome.storage.local.get(null, (allData) => {
        console.log("[DEBUG STORAGE] Conteúdo completo do storage:", allData);
        sendResponse({ ok: true, data: allData });
      });
      return true;

    case "addProfessional":
      addProfessional(msg.name, sendResponse);
      return true;

    case "removeProfessional":
      removeProfessional(msg.id, sendResponse);
      return true;

    case "toggleProfessional":
      toggleProfessional(msg.id, sendResponse);
      return true;

    case "addServiceType":
      addServiceType(msg.name, msg.categoryId || null, sendResponse);
      return true;

    case "removeServiceType":
      removeServiceType(msg.id, sendResponse);
      return true;

    case "addServiceCategory":
      addServiceCategory(msg.name, sendResponse);
      return true;

    case "removeServiceCategory":
      removeServiceCategory(msg.id, sendResponse);
      return true;

    case "renameServiceCategory":
      renameServiceCategory(msg.id, msg.name, sendResponse);
      return true;

    case "renameProfessional":
      renameProfessional(msg.id, msg.name, sendResponse);
      return true;

    case "renameServiceType":
      renameServiceType(msg.id, msg.name, sendResponse);
      return true;

    case "setServiceCategory":
      setServiceCategory(msg.id, msg.categoryId, sendResponse);
      return true;

    case "registerAppointment":
      registerAppointment(msg.data, sendResponse);
      return true;

    case "undoLast":
      undoLast(sendResponse);
      return true;

    case "openPanel":
      chrome.tabs.create({ url: chrome.runtime.getURL("panel.html") });
      sendResponse({ ok: true });
      return true;

    case "setProfServices":
      // msg.profId, msg.serviceIds (array)
      chrome.storage.local.get("profServices", (data) => {
        const profServices = data.profServices || {};
        profServices[msg.profId] = msg.serviceIds;
        chrome.storage.local.set({ profServices }, () => sendResponse({ ok: true }));
      });
      return true;
  }
});

// ─── Funções de dados ─────────────────────────────────────────────────

function addProfessional(name, cb) {
  chrome.storage.local.get(["professionals", "counters", "serviceTypes"], (data) => {
    const professionals = data.professionals || [];
    const counters = data.counters || {};
    const serviceTypes = data.serviceTypes || [];

    const id = "p_" + Date.now();
    professionals.push({ id, name, active: true });

    // Inicializa contador zerado para todos os tipos de serviço
    serviceTypes.forEach(st => {
      if (!counters[st.id]) counters[st.id] = {};
      counters[st.id][id] = 0;
    });

    chrome.storage.local.set({ professionals, counters }, () => cb({ ok: true, id }));
  });
}

function removeProfessional(id, cb) {
  chrome.storage.local.get(["professionals", "counters"], (data) => {
    const professionals = (data.professionals || []).filter(p => p.id !== id);
    const counters = data.counters || {};
    Object.keys(counters).forEach(stId => { delete counters[stId][id]; });
    chrome.storage.local.set({ professionals, counters }, () => cb({ ok: true }));
  });
}

function toggleProfessional(id, cb) {
  chrome.storage.local.get("professionals", (data) => {
    const professionals = (data.professionals || []).map(p =>
      p.id === id ? { ...p, active: !p.active } : p
    );
    chrome.storage.local.set({ professionals }, () => cb({ ok: true }));
  });
}

function addServiceType(name, categoryId, cb) {
  chrome.storage.local.get(["serviceTypes", "counters", "professionals"], (data) => {
    const serviceTypes = data.serviceTypes || [];
    const counters = data.counters || {};
    const professionals = data.professionals || [];

    const id = "st_" + Date.now();
    const entry = { id, name };
    if (categoryId) entry.categoryId = categoryId;
    serviceTypes.push(entry);

    // Inicializa contadores zerados para todos os profissionais
    counters[id] = {};
    professionals.forEach(p => { counters[id][p.id] = 0; });

    chrome.storage.local.set({ serviceTypes, counters }, () => cb({ ok: true, id }));
  });
}

function removeServiceType(id, cb) {
  chrome.storage.local.get(["serviceTypes", "counters"], (data) => {
    const serviceTypes = (data.serviceTypes || []).filter(s => s.id !== id);
    const counters = data.counters || {};
    delete counters[id];
    chrome.storage.local.set({ serviceTypes, counters }, () => cb({ ok: true }));
  });
}

function registerAppointment(appt, cb) {
  // appt: { client, serviceTypeId, serviceTypeName, professionalId, professionalName, source }
  chrome.storage.local.get(["counters", "history", "lastServed", "serviceTypes", "professionals"], (data) => {
    const counters   = data.counters   || {};
    const history    = data.history    || [];
    const lastServed = data.lastServed || {};

    // Verifica se o serviceTypeId existe
    const serviceExists = (data.serviceTypes || []).some(s => s.id === appt.serviceTypeId);
    const profExists = (data.professionals || []).some(p => p.id === appt.professionalId);

    if (!serviceExists || !profExists) {
      return cb({ ok: false, msg: "IDs inválidos - serviço ou profissional não encontrado" });
    }

    // Incrementa contador
    if (!counters[appt.serviceTypeId]) counters[appt.serviceTypeId] = {};
    const prev = counters[appt.serviceTypeId][appt.professionalId] || 0;
    counters[appt.serviceTypeId][appt.professionalId] = prev + 1;

    // Registra no histórico
    const entry = {
      id: "h_" + Date.now(),
      date: new Date().toISOString(),
      ...appt
    };
    history.unshift(entry);

    // Atualiza último atendido
    lastServed[appt.serviceTypeId] = appt.professionalId;

    chrome.storage.local.set({ counters, history, lastServed }, () => {
      if (chrome.runtime.lastError) {
        return cb({ ok: false, msg: chrome.runtime.lastError.message });
      }
      cb({ ok: true, entry });
    });
  });
}

function undoLast(cb) {
  chrome.storage.local.get(["history", "counters"], (data) => {
    const history = data.history || [];
    const counters = data.counters || {};
    if (!history.length) return cb({ ok: false, msg: "Sem histórico para desfazer" });

    const last = history.shift();
    if (counters[last.serviceTypeId]?.[last.professionalId] > 0) {
      counters[last.serviceTypeId][last.professionalId]--;
    }
    chrome.storage.local.set({ history, counters }, () => cb({ ok: true, undone: last }));
  });
}

function renameProfessional(id, newName, cb) {
  chrome.storage.local.get(["professionals", "history"], (data) => {
    const professionals = (data.professionals || []).map(p =>
      p.id === id ? { ...p, name: newName } : p
    );
    // Atualiza nome no histórico também
    const history = (data.history || []).map(h =>
      h.professionalId === id ? { ...h, professionalName: newName } : h
    );
    chrome.storage.local.set({ professionals, history }, () => cb({ ok: true }));
  });
}

function setServiceCategory(id, categoryId, cb) {
  chrome.storage.local.get("serviceTypes", (data) => {
    const serviceTypes = (data.serviceTypes || []).map(s => {
      if (s.id !== id) return s;
      if (categoryId) return { ...s, categoryId };
      const { categoryId: _, ...rest } = s;
      return rest;
    });
    chrome.storage.local.set({ serviceTypes }, () => cb({ ok: true }));
  });
}

function addServiceCategory(name, cb) {
  chrome.storage.local.get("serviceCategories", (data) => {
    const cats = data.serviceCategories || [];
    const id = "sc_" + Date.now();
    cats.push({ id, name });
    chrome.storage.local.set({ serviceCategories: cats }, () => cb({ ok: true, id }));
  });
}

function removeServiceCategory(id, cb) {
  chrome.storage.local.get(["serviceCategories", "serviceTypes"], (data) => {
    const cats = (data.serviceCategories || []).filter(c => c.id !== id);
    const serviceTypes = (data.serviceTypes || []).map(s => {
      if (s.categoryId !== id) return s;
      const { categoryId, ...rest } = s;
      return rest;
    });
    chrome.storage.local.set({ serviceCategories: cats, serviceTypes }, () => cb({ ok: true }));
  });
}

function renameServiceCategory(id, newName, cb) {
  chrome.storage.local.get("serviceCategories", (data) => {
    const cats = (data.serviceCategories || []).map(c =>
      c.id === id ? { ...c, name: newName } : c
    );
    chrome.storage.local.set({ serviceCategories: cats }, () => cb({ ok: true }));
  });
}

function renameServiceType(id, newName, cb) {
  chrome.storage.local.get(["serviceTypes", "history"], (data) => {
    const serviceTypes = (data.serviceTypes || []).map(s =>
      s.id === id ? { ...s, name: newName } : s
    );
    // Atualiza nome no histórico também
    const history = (data.history || []).map(h =>
      h.serviceTypeId === id ? { ...h, serviceTypeName: newName } : h
    );
    chrome.storage.local.set({ serviceTypes, history }, () => cb({ ok: true }));
  });
}
