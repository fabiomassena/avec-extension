// content.js — Rodízio Avec (VERSÃO OTIMIZADA E INTEGRADA)
(function () {
  if (window.__avecRodizioInjected) return;
  window.__avecRodizioInjected = true;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ════════════════════════════════════════════════════════════════════
  // VARIÁVEIS GLOBAIS
  // ════════════════════════════════════════════════════════════════════
  let tipContainer = null;
  let serviceGroups = new Map();   // DOM option value -> groupName
  let domNameToGroup = new Map();  // normalized service name -> groupName
  let cachedState = null;

  // ════════════════════════════════════════════════════════════════════
  // WRAPPER SEGURO PARA chrome.runtime.sendMessage
  // Evita "Extension context invalidated" após reload da extensão
  // ════════════════════════════════════════════════════════════════════
  function safeSendMessage(msg, callback) {
    try {
      if (!chrome?.runtime?.id) return; // contexto invalidado
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          // Ignora erros de canal fechado (extensão recarregada)
          return;
        }
        if (callback) callback(response);
      });
    } catch (e) {
      // Silencia qualquer erro residual de contexto inválido
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // INICIALIZAÇÃO
  // ════════════════════════════════════════════════════════════════════
  function init() {
    injectStyles();
    injectFloatingButton();
    monitorModal();
    loadServiceGroups();
    // Atualiza estado periodicamente
    setInterval(() => {
      safeSendMessage({ action: "getState" }, (state) => {
        if (state) cachedState = state;
      });
    }, 5000);
  }

  // ════════════════════════════════════════════════════════════════════
  // CARREGA GRUPOS DE SERVIÇO DO DOM
  // ════════════════════════════════════════════════════════════════════
  function loadServiceGroups() {
    const serviceSelect = document.getElementById("sltServico");
    if (!serviceSelect) {
      setTimeout(loadServiceGroups, 1000);
      return;
    }
    
    const newGroups = new Map();
    const newNameToGroup = new Map();
    const optgroups = serviceSelect.querySelectorAll("optgroup");

    optgroups.forEach(optgroup => {
      const groupName = optgroup.getAttribute("label");
      optgroup.querySelectorAll("option").forEach(option => {
        if (option.value) {
          newGroups.set(option.value, groupName);
          const cleanN = option.textContent
            .replace(/\s*-\s*\d+\s*min\.?\s*$/i, "").replace(/\s+/g, " ").trim().toLowerCase();
          newNameToGroup.set(cleanN, groupName);
        }
      });
    });

    // Se houve mudança, atualiza e persiste
    if (newGroups.size !== serviceGroups.size ||
        [...newGroups.entries()].some(([k, v]) => serviceGroups.get(k) !== v)) {
      serviceGroups = newGroups;
      domNameToGroup = newNameToGroup;

      // Persiste no storage para o panel.js (keyed por rodízio ID via nome)
      if (cachedState?.serviceTypes) {
        persistRodizioGroups(cachedState.serviceTypes);
      }
      console.log("📁 Grupos de serviço atualizados:", serviceGroups.size);
    }
  }

  function persistRodizioGroups(serviceTypes) {
    const cleanN = n => n.replace(/\s*-\s*\d+\s*min\.?\s*$/i, "").replace(/\s+/g, " ").trim().toLowerCase();
    const groupsObj = {};
    serviceTypes.forEach(s => {
      const group = domNameToGroup.get(cleanN(s.name));
      if (group) groupsObj[s.id] = group;
    });
    if (chrome?.storage?.local) chrome.storage.local.set({ serviceGroups: groupsObj });
  }

  // ════════════════════════════════════════════════════════════════════
  // FUNÇÃO CENTRAL: PRÓXIMO PROFISSIONAL POR GRUPO
  // ════════════════════════════════════════════════════════════════════
  // Recebe um rodízio service ID (st_*) e usa domNameToGroup para agrupar
  function getNextProfessionalByGroup(state, rodizioServiceId) {
    if (!state) return null;

    const serviceTypes = state.serviceTypes || [];
    const allProfs     = (state.professionals || []).filter(p => p.active);
    const profSvcs     = state.profServices || {};
    const counters     = state.counters || {};
    const lastServed   = state.lastServed || {};

    const cleanN = n => n.replace(/\s*-\s*\d+\s*min\.?\s*$/i, "").replace(/\s+/g, " ").trim().toLowerCase();

    // Descobre o grupo pelo nome do serviço ou pela categoria manual
    const thisService = serviceTypes.find(s => s.id === rodizioServiceId);
    if (!thisService) return null;
    const domGroupName = domNameToGroup.get(cleanN(thisService.name));
    const cats = state.serviceCategories || [];
    const catGroupName = cats.find(c => c.id === thisService.categoryId)?.name;
    const groupName = domGroupName || catGroupName;

    // Todos os rodízio IDs do mesmo grupo/categoria (ou só o próprio se sem)
    const targetServiceIds = groupName
      ? serviceTypes.filter(s => {
          const sDom = domNameToGroup.get(cleanN(s.name));
          const sCat = cats.find(c => c.id === s.categoryId)?.name;
          return (sDom || sCat) === groupName;
        }).map(s => s.id)
      : [rodizioServiceId];

    const eligibleProfs = allProfs.filter(prof => {
      const allowed = profSvcs[prof.id];
      if (!allowed || allowed.length === 0) return true;
      return targetServiceIds.some(sid => allowed.includes(sid));
    });

    if (!eligibleProfs.length) return null;

    const scored = eligibleProfs.map(prof => {
      let total = 0, isLast = false;
      for (const sid of targetServiceIds) {
        total += (counters[sid]?.[prof.id] || 0);
        if (lastServed[sid] === prof.id) isLast = true;
      }
      return { prof, total, isLast };
    });

    scored.sort((a, b) => {
      if (a.total !== b.total) return a.total - b.total;
      if (a.isLast && !b.isLast) return 1;
      if (!a.isLast && b.isLast) return -1;
      return 0;
    });

    return scored[0]?.prof || null;
  }

  // ════════════════════════════════════════════════════════════════════
  // FUNÇÃO PARA PEGAR NOME DO CLIENTE
  // ════════════════════════════════════════════════════════════════════
  function getClienteNome() {
    // Modo edição - cliente já salvo
    const blocknome = document.querySelector(".blocknome");
    if (blocknome) {
      const nome = blocknome.textContent.replace(/^cliente:\s*/i, "").trim();
      if (nome && nome !== "Cliente") return nome;
    }

    // Modo criação - campo de busca (vários seletores possíveis)

    // Tenta 1: slcCliente (select ou input)
    const slcCliente = document.getElementById("slcCliente");
    if (slcCliente) {
      if (slcCliente.tagName === "SELECT") {
        const selected = slcCliente.options[slcCliente.selectedIndex];
        if (selected && selected.text && selected.text !== "Selecione:" && selected.text !== "Selecione o cliente") {
          return selected.text.trim();
        }
      } else if (slcCliente.value && slcCliente.value.trim()) {
        return slcCliente.value.trim();
      }
    }

    // Tenta 2: sltCliente (select comum no Avec)
    const sltCliente = document.getElementById("sltCliente");
    if (sltCliente && sltCliente.tagName === "SELECT") {
      const selected = sltCliente.options[sltCliente.selectedIndex];
      if (selected && selected.text && selected.text !== "Selecione:" && selected.text !== "Selecione o cliente") {
        return selected.text.trim();
      }
    }

    // Tenta 3: Input de busca do cliente (Chosen UI)
    const chosenInput = document.querySelector("#sltCliente_chosen input, #slcCliente_chosen input");
    if (chosenInput && chosenInput.value) {
      return chosenInput.value.trim();
    }

    // Tenta 4: Campo de texto do cliente
    const clienteInput = document.querySelector("input[name='cliente'], input[id^='cliente'], .cliente-input, input.placeholder[data*='cliente' i]");
    if (clienteInput && clienteInput.value) {
      return clienteInput.value.trim();
    }

    // Tenta 5: Typeahead genérico
    const typeaheadField = document.querySelector(".typeahead-field input");
    if (typeaheadField && typeaheadField.value) {
      return typeaheadField.value.trim();
    }

    return "";
  }

  // ════════════════════════════════════════════════════════════════════
  // TOOLTIP
  // ════════════════════════════════════════════════════════════════════
  function ensureTipContainer() {
    if (!tipContainer || !document.body.contains(tipContainer)) {
      tipContainer = document.createElement("div");
      tipContainer.id = "rodizio-next-tip-container";
      tipContainer.style.cssText = `
        position: fixed !important;
        bottom: 90px !important;
        right: 24px !important;
        z-index: 2147483647 !important;
        background: #1e1b2e !important;
        border: 1px solid #7c3aed !important;
        border-radius: 10px !important;
        padding: 10px 16px !important;
        font-size: 13px !important;
        font-weight: 500 !important;
        color: #c4b5fd !important;
        font-family: 'Segoe UI', sans-serif !important;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4) !important;
        pointer-events: none !important;
        backdrop-filter: blur(4px) !important;
        display: none !important;
        max-width: 320px !important;
        white-space: normal !important;
        line-height: 1.4 !important;
      `;
      document.body.appendChild(tipContainer);
    }
    return tipContainer;
  }

  function updateTip(serviceId, serviceName) {
    if (!cachedState) {
      safeSendMessage({ action: "getState" }, (state) => {
        cachedState = state;
        renderTip(serviceId, serviceName);
      });
    } else {
      renderTip(serviceId, serviceName);
    }
  }

  function renderTip(serviceId, serviceName) {
    if (!serviceId || !cachedState) { hideTip(); return; }

    const next = getNextProfessionalByGroup(cachedState, serviceId);
    if (!next) { hideTip(); return; }

    const serviceTypes = cachedState.serviceTypes || [];
    const counters     = cachedState.counters || {};
    const cleanN = n => n.replace(/\s*-\s*\d+\s*min\.?\s*$/i, "").replace(/\s+/g, " ").trim().toLowerCase();

    const thisService = serviceTypes.find(s => s.id === serviceId);
    const tipCats = cachedState.serviceCategories || [];
    const tipCatName = thisService ? tipCats.find(c => c.id === thisService.categoryId)?.name : null;
    const currentGroup = thisService ? (domNameToGroup.get(cleanN(thisService.name)) || tipCatName) : null;

    let totalAtendimentos = 0;
    if (currentGroup) {
      const groupIds = serviceTypes.filter(s => domNameToGroup.get(cleanN(s.name)) === currentGroup).map(s => s.id);
      for (const sid of groupIds) totalAtendimentos += (counters[sid]?.[next.id] || 0);
    } else {
      totalAtendimentos = (counters[serviceId]?.[next.id] || 0);
    }
    
    const container = ensureTipContainer();
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 14px;">✂️</span>
          <span style="color: #a78bfa; font-weight: 600;">Rodízio</span>
        </div>
        <div style="font-size: 12px; color: #e0e0f0;">
          <span style="color: #a78bfa;">Serviço:</span> ${serviceName}
        </div>
        ${currentGroup ? `<div style="font-size: 10px; color: #a78bfa;">Grupo: ${currentGroup}</div>` : ''}
        <div style="font-size: 13px; font-weight: 600; color: #c4b5fd;">
          👤 Próximo: ${next.name}
        </div>
        <div style="font-size: 10px; color: #8b8bb0;">
          Atendimentos: ${totalAtendimentos}
        </div>
      </div>
    `;
    container.style.display = "block";
  }

  function hideTip() {
    if (tipContainer) {
      tipContainer.style.display = "none";
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // MONITORAMENTO DO MODAL
  // ════════════════════════════════════════════════════════════════════
  function monitorModal() {
    let lastModalState = false;

    setInterval(() => {
      const modal = document.getElementById("popupModal");
      if (!modal) return;

      const isVisible = modal.style.display !== "none" &&
                        window.getComputedStyle(modal).display !== "none";

      if (isVisible && !lastModalState) {
        lastModalState = true;
        loadServiceGroups(); // Recarrega grupos ao abrir
        setTimeout(() => setupServiceListener(), 800);
      } else if (!isVisible && lastModalState) {
        lastModalState = false;
        hideTip();
        // Reset da flag quando modal é fechado
        capturedAppointmentId = null;
      }
    }, 500);
  }

  // ════════════════════════════════════════════════════════════════════
  // LISTENER DO SERVIÇO
  // ════════════════════════════════════════════════════════════════════
  function setupServiceListener() {
    const serviceChosen = document.getElementById("sltServico_chosen");
    if (!serviceChosen) {
      setTimeout(setupServiceListener, 500);
      return;
    }
    
    if (serviceChosen.__rodizioTipAttached) return;
    serviceChosen.__rodizioTipAttached = true;
    
    const singleEl = serviceChosen.querySelector(".chosen-single");
    if (!singleEl) return;
    
    function getSelectedServiceId() {
      const select = document.getElementById("sltServico");
      if (select && select.selectedIndex >= 0) {
        return select.options[select.selectedIndex]?.value;
      }
      return null;
    }
    
    function getSelectedServiceName() {
      const span = singleEl.querySelector("span");
      return span ? span.textContent.trim() : "";
    }
    
    function handleChange() {
      const rawName    = getSelectedServiceName();
      const domSvcId   = getSelectedServiceId();

      if (!rawName || rawName === "Selecione:" || !domSvcId) {
        hideTip();
        return;
      }

      const servicoNome = rawName.replace(/\s*-\s*\d+\s*min\.?\s*$/i, "").replace(/\s+/g, " ").trim();

      safeSendMessage({ action: "getState" }, (state) => {
        if (!state) { hideTip(); return; }
        cachedState = state;

        // Converte nome do DOM → rodízio service ID
        const cleanN = n => n.replace(/\s*-\s*\d+\s*min\.?\s*$/i, "").replace(/\s+/g, " ").trim().toLowerCase();
        const rodizioService = (state.serviceTypes || []).find(s => {
          const sName     = cleanN(s.name);
          const searchName = cleanN(servicoNome);
          return sName === searchName || sName.includes(searchName) || searchName.includes(sName);
        });

        if (!rodizioService) { hideTip(); return; }

        // Garante que os grupos já estão mapeados
        if (domNameToGroup.size === 0) loadServiceGroups();
        persistRodizioGroups(state.serviceTypes);

        updateTip(rodizioService.id, servicoNome);
      });
    }
    
    handleChange();
    new MutationObserver(handleChange).observe(singleEl, { 
      subtree: true, 
      childList: true, 
      characterData: true 
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // CAPTURA AUTOMÁTICA
  // ════════════════════════════════════════════════════════════════════
  
  // Flag para controlar se já capturou este agendamento
  let capturedAppointmentId = null;
  
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#btnSalvar");
    if (btn) {
      // Verifica se é modal de edição (já tem agendamento existente)
      const isEditMode = document.querySelector("input[name='id'], input[name='agenda_id'], input[id^='agenda']");
      
      if (isEditMode) {
        return;
      }
      
      // Verifica se o status "Cancelado" está selecionado
      // Na screenshot, o botão "Cancelado" tem id="statusCancelado" e value="0"
      const canceladoRadio = document.querySelector("input[value='Cancelado']:checked");
      const canceladoById = document.querySelector("#statusCancelado:checked");
      const statusRadios = document.querySelectorAll("input[name='status']:checked");
      let statusSelecionado = null;
      
      statusRadios.forEach(radio => {
        statusSelecionado = radio.value;
      });
      
      // Verifica se é cancelado (valor pode ser "0", "6", "7", "Cancelado", etc.)
      const isCancelado = canceladoRadio || 
                          canceladoById ||
                          (statusSelecionado && 
                           (statusSelecionado.toString() === "0" || 
                            statusSelecionado.toString() === "6" || 
                            statusSelecionado.toString() === "7" ||
                            statusSelecionado.toLowerCase().includes("cancel")));
      
      if (isCancelado) {
        return;
      }
      
      // Verifica se já capturou este mesmo agendamento
      const serviceSelect = document.getElementById("sltServico");
      const currentId = serviceSelect?.value;
      
      if (capturedAppointmentId === currentId) {
        return;
      }
      
      const snapshot = captureFormSnapshot();
      if (snapshot) {
        capturedAppointmentId = currentId;
        setTimeout(() => sendToBackground(snapshot), 700);
      }
    }
  }, true);

  function captureFormSnapshot() {
    let servicoId = null;
    let servicoNome = "";

    const serviceSelect = document.getElementById("sltServico");
    if (serviceSelect && serviceSelect.selectedIndex >= 0) {
      const opt = serviceSelect.options[serviceSelect.selectedIndex];
      servicoId = opt?.value;
      if (servicoId) {
        const raw = opt?.text?.trim() || "";
        servicoNome = raw.replace(/\s*[-–]\s*\d+\s*min\.?\s*$/i, "").replace(/\s+/g, " ").trim();
      }
    }

    let profId = null;
    let profNome = "";

    // Tenta 1: name="prof" (modal de edição - profissional único)
    const profSelect = document.querySelector("select[name='prof']");
    if (profSelect && profSelect.selectedIndex >= 0) {
      const opt = profSelect.options[profSelect.selectedIndex];
      profId = opt?.value;
      profNome = opt?.text?.trim() || "";
    }
    
    // Tenta 2: name="prof[]" (modal de criação - múltiplos profissionais)
    if (!profId) {
      const profArraySelect = document.querySelector("select[name='prof[]']");
      if (profArraySelect && profArraySelect.selectedIndex >= 0) {
        const opt = profArraySelect.options[profArraySelect.selectedIndex];
        profId = opt?.value;
        profNome = opt?.text?.trim() || "";
      }
    }
    
    // Tenta 3: sltProf (fallback para versões antigas)
    if (!profId) {
      const sltProf = document.getElementById("sltProf");
      if (sltProf && sltProf.selectedIndex >= 0) {
        const opt = sltProf.options[sltProf.selectedIndex];
        profId = opt?.value;
        profNome = opt?.text?.trim() || "";
      }
    }
    
    // Tenta 4: slcProf (fallback para versões antigas)
    if (!profId) {
      const slcProf = document.getElementById("slcProf");
      if (slcProf && slcProf.selectedIndex >= 0) {
        const opt = slcProf.options[slcProf.selectedIndex];
        profId = opt?.value;
        profNome = opt?.text?.trim() || "";
      }
    }
    
    // Tenta 5: Chosen UI para profissional
    if (!profId) {
      const profChosenInput = document.querySelector("#sltProf_chosen input, #slcProf_chosen input");
      if (profChosenInput && profChosenInput.value) {
        profNome = profChosenInput.value.trim();
      }
    }

    const clienteNome = getClienteNome();

    // Serviço é obrigatório, profissional e cliente são opcionais
    // Se não tiver profissional, o rodízio vai sugerir o próximo
    if (!servicoId) {
      return null;
    }

    return {
      client: clienteNome,
      serviceTypeId: servicoId,
      serviceTypeName: servicoNome,
      professionalId: profId,
      professionalName: profNome,
      source: "auto"
    };
  }

  function sendToBackground(appt) {
    safeSendMessage({ action: "getState" }, (state) => {
      if (!state) {
        return;
      }
      cachedState = state;

      const cleanN = n => n.replace(/\s*-\s*\d+\s*min\.?\s*$/i, "").replace(/\s+/g, " ").trim().toLowerCase();

      const matchService = (state.serviceTypes || []).find(s => {
        const sName  = cleanN(s.name);
        const search = cleanN(appt.serviceTypeName);
        return sName === search || sName.includes(search) || search.includes(sName);
      });
      
      const matchProf = (state.professionals || []).find(p => {
        const pName = p.name.toLowerCase();
        const searchName = appt.professionalName.toLowerCase();
        return pName === searchName || searchName.includes(pName);
      });

      if (!matchService || !matchProf) {
        showToast(`⚠️ Não foi possível registrar: ${appt.serviceTypeName} → ${appt.professionalName}`);
        return;
      }

      safeSendMessage({
        action: "registerAppointment",
        data: {
          client: appt.client,
          serviceTypeId: matchService.id,
          serviceTypeName: matchService.name,
          professionalId: matchProf.id,
          professionalName: matchProf.name,
          source: appt.source
        }
      }, (response) => {
        if (response?.ok) {
          const clienteMsg = appt.client ? ` (${appt.client})` : "";
          showToast(`✅ Registrado: ${matchProf.name} → ${matchService.name}${clienteMsg}`);
        } else {
          showToast(`❌ Erro: ${response?.msg || 'Falha desconhecida'}`);
        }
        setTimeout(() => {
          const serviceChosen = document.getElementById("sltServico_chosen");
          if (serviceChosen) {
            const singleEl = serviceChosen.querySelector(".chosen-single");
            if (singleEl) singleEl.dispatchEvent(new Event("change"));
          }
        }, 500);
      });
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // BUILD SEARCHABLE (para modal manual)
  // ════════════════════════════════════════════════════════════════════
  function buildSearchable(inputId, dropdownId, hiddenId, items, onSelect) {
    const oldInput = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    const hidden = document.getElementById(hiddenId);

    if (!oldInput || !dropdown || !hidden) return null;

    const input = oldInput.cloneNode(true);
    oldInput.parentNode.replaceChild(input, oldInput);

    input.value = "";
    hidden.value = "";
    dropdown.innerHTML = "";
    dropdown.style.display = "none";

    function renderDropdown(filter) {
      const q = (filter || "").toLowerCase().trim();
      const filtered = q ? items.filter(it => it.name.toLowerCase().includes(q)) : items;

      if (!filtered.length) {
        dropdown.innerHTML = "";
        dropdown.style.setProperty("display", "none", "important");
        return;
      }

      dropdown.innerHTML = filtered.slice(0, 50).map(it =>
        `<div class="rodizio-dd-item" data-id="${it.id}" data-name="${it.name.replace(/"/g, "&quot;")}">${it.name}</div>`
      ).join("");
      dropdown.style.setProperty("display", "block", "important");

      dropdown.querySelectorAll(".rodizio-dd-item").forEach(el => {
        el.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectItem(el.dataset.id, el.dataset.name);
        });
      });
    }

    function selectItem(id, name) {
      hidden.value = id;
      input.value = name;
      dropdown.innerHTML = "";
      dropdown.style.setProperty("display", "none", "important");
      if (onSelect) onSelect(id, name);
    }

    function clearSelection() {
      hidden.value = "";
      input.value = "";
      dropdown.innerHTML = "";
      dropdown.style.setProperty("display", "none", "important");
    }

    input.addEventListener("input", () => renderDropdown(input.value));
    input.addEventListener("focus", () => renderDropdown(input.value));
    input.addEventListener("blur", () => setTimeout(() => dropdown.style.setProperty("display", "none", "important"), 180));
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") clearSelection(); });

    input._setVal = (id, name) => selectItem(id, name);
    input._clear = clearSelection;
    input._showAll = () => renderDropdown("");

    return input;
  }

  // ════════════════════════════════════════════════════════════════════
  // MODAL MANUAL
  // ════════════════════════════════════════════════════════════════════
  function openManualModal(prefill = {}) {
    const modal = document.getElementById("avec-rodizio-modal");
    if (!modal) return;

    if (modal.classList.contains("open")) {
      modal.classList.remove("open");
      modal.style.display = "none";
      return;
    }

    safeSendMessage({ action: "getState" }, (state) => {
      if (!state) {
        showToast("Erro: não foi possível carregar dados");
        return;
      }

      cachedState = state;
      const profs = (state.professionals || []).filter(p => p.active);
      const services = state.serviceTypes || [];

      modal.classList.add("open");
      modal.style.display = "block";

      const clientEl = document.getElementById("rodizio-client");
      const tipEl = document.getElementById("rodizio-next-tip");
      if (clientEl) clientEl.value = prefill.client || "";
      if (tipEl) tipEl.style.display = "none";

      const svcInput = buildSearchable(
        "rodizio-service-input", "rodizio-service-dropdown", "rodizio-service",
        services,
        (id) => {
          const pi = document.getElementById("rodizio-prof-input");
          const ph = document.getElementById("rodizio-professional");
          if (pi) pi.value = "";
          if (ph) ph.value = "";
          if (tipEl) tipEl.style.display = "none";
          suggestNextFromState(id);
        }
      );

      const profInputEl = buildSearchable(
        "rodizio-prof-input", "rodizio-prof-dropdown", "rodizio-professional",
        profs,
        () => { if (tipEl) tipEl.style.display = "none"; }
      );

      if (prefill.serviceTypeName) {
        const cleanName = prefill.serviceTypeName
          .replace(/\s*-\s*\d+\s*min\.?\s*$/i, "")
          .replace(/\s+/g, " ").trim();
        const matched = services.find(s =>
          s.name.toLowerCase().includes(cleanName.toLowerCase())
        );
        if (matched && svcInput) {
          svcInput._setVal(matched.id, matched.name);
          setTimeout(() => suggestNextFromState(matched.id), 100);
        }
      }

      if (clientEl && !clientEl.value) {
        clientEl.focus();
      } else if (svcInput && !svcInput.value) {
        svcInput.focus();
        svcInput._showAll();
      } else if (profInputEl && !profInputEl.value) {
        profInputEl.focus();
        profInputEl._showAll();
      }
    });
  }

  function suggestNextFromState(serviceId) {
    if (!cachedState) {
      safeSendMessage({ action: "getState" }, (state) => {
        cachedState = state;
        doSuggest(serviceId);
      });
    } else {
      doSuggest(serviceId);
    }
  }

  function doSuggest(serviceId) {
    if (!cachedState) return;
    
    const next = getNextProfessionalByGroup(cachedState, serviceId);
    
    if (next) {
      const profInput = document.getElementById("rodizio-prof-input");
      const profHidden = document.getElementById("rodizio-professional");
      const tipEl = document.getElementById("rodizio-next-tip");
      
      if (profHidden && !profHidden.value && profInput?._setVal) {
        profInput._setVal(next.id, next.name);
      }
      if (tipEl) {
        tipEl.style.display = "block";
        const cleanN = n => n.replace(/\s*-\s*\d+\s*min\.?\s*$/i, "").replace(/\s+/g, " ").trim().toLowerCase();
        const thisSvc = (cachedState.serviceTypes || []).find(s => s.id === serviceId);
        const suggestCats = cachedState.serviceCategories || [];
        const suggestCatName = thisSvc ? suggestCats.find(c => c.id === thisSvc.categoryId)?.name : null;
        const currentGroup = thisSvc ? (domNameToGroup.get(cleanN(thisSvc.name)) || suggestCatName) : null;
        tipEl.textContent = `💡 Próximo no rodízio (${currentGroup || 'serviço'}): ${next.name}`;
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // BOTÃO FLUTUANTE
  // ════════════════════════════════════════════════════════════════════
  function injectFloatingButton() {
    if (!document.body) return;
    if (document.getElementById("avec-rodizio-fab")) return;

    const container = document.createElement("div");
    container.id = "avec-rodizio-fab";
    container.innerHTML = `
      <div id="avec-rodizio-modal">
        <h3>✂️ Registrar no Rodízio</h3>
        <div class="rodizio-field">
          <label>Cliente</label>
          <input type="text" id="rodizio-client" placeholder="Opcional" />
        </div>
        <div class="rodizio-field">
          <label>Tipo de Serviço *</label>
          <div class="rodizio-search-wrap">
            <input type="text" id="rodizio-service-input" placeholder="Digite para buscar..." autocomplete="off" />
            <div class="rodizio-dropdown" id="rodizio-service-dropdown"></div>
            <input type="hidden" id="rodizio-service" />
          </div>
        </div>
        <div class="rodizio-field">
          <label>Profissional *</label>
          <div class="rodizio-search-wrap">
            <input type="text" id="rodizio-prof-input" placeholder="Digite para buscar..." autocomplete="off" />
            <div class="rodizio-dropdown" id="rodizio-prof-dropdown"></div>
            <input type="hidden" id="rodizio-professional" />
          </div>
        </div>
        <div id="rodizio-next-tip" class="rodizio-next-tip" style="display:none"></div>
        <div class="rodizio-actions">
          <button id="rodizio-cancel-btn">Cancelar</button>
          <button id="rodizio-confirm-btn">✅ Confirmar</button>
        </div>
      </div>
      <button id="avec-rodizio-btn">✂️ Rodízio</button>
    `;
    document.body.appendChild(container);

    const toastEl = document.createElement("div");
    toastEl.id = "avec-rodizio-toast";
    document.body.appendChild(toastEl);

    const fabBtn = document.getElementById("avec-rodizio-btn");
    if (fabBtn) {
      fabBtn.addEventListener("click", () => {
        const modal = document.getElementById("avec-rodizio-modal");
        if (modal.classList.contains("open")) {
          modal.classList.remove("open");
          modal.style.display = "none";
        } else {
          const servicoNome = document.getElementById("sltServico_chosen")
            ?.querySelector(".chosen-single span")?.textContent?.trim() || "";
          const clienteNome = getClienteNome();
          openManualModal({ serviceTypeName: servicoNome, client: clienteNome });
        }
      });
    }

    document.getElementById("rodizio-cancel-btn").addEventListener("click", () => {
      const modal = document.getElementById("avec-rodizio-modal");
      modal.classList.remove("open");
      modal.style.display = "none";
    });

    document.getElementById("rodizio-confirm-btn").addEventListener("click", () => {
      const serviceId = document.getElementById("rodizio-service")?.value || "";
      const serviceName = document.getElementById("rodizio-service-input")?.value || "";
      const profId = document.getElementById("rodizio-professional")?.value || "";
      const profName = document.getElementById("rodizio-prof-input")?.value || "";
      const clientEl = document.getElementById("rodizio-client");

      if (!serviceId || !profId) { showToast("⚠️ Selecione serviço e profissional."); return; }

      safeSendMessage({
        action: "registerAppointment",
        data: { 
          client: clientEl?.value.trim() || "", 
          serviceTypeId: serviceId, 
          serviceTypeName: serviceName,
          professionalId: profId, 
          professionalName: profName, 
          source: "manual" 
        }
      }, () => {
        const modal = document.getElementById("avec-rodizio-modal");
        modal.classList.remove("open");
        modal.style.display = "none";
        const clienteMsg = clientEl?.value ? ` (${clientEl.value.trim()})` : "";
        showToast(`✅ ${profName} → ${serviceName}${clienteMsg}`);
      });
    });
  }

  function showToast(msg) {
    // Recria o elemento se o DOM foi trocado pela SPA
    let toast = document.getElementById("avec-rodizio-toast");
    if (!toast) {
      if (!document.getElementById("avec-rodizio-styles")) injectStyles();
      toast = document.createElement("div");
      toast.id = "avec-rodizio-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.cssText = [
      "position:fixed!important", "bottom:90px!important", "right:24px!important",
      "background:#1e1b2e!important", "border:1px solid #7c3aed!important",
      "border-radius:10px!important", "padding:12px 18px!important",
      "font-size:13px!important", "color:#e0e0f0!important",
      "box-shadow:0 4px 20px rgba(0,0,0,0.4)!important",
      "z-index:2147483647!important", "display:block!important",
      "opacity:1!important", "transition:opacity 0.4s!important",
      "font-family:'Segoe UI',sans-serif!important", "max-width:280px!important"
    ].join(";");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => { toast.style.display = "none"; }, 400);
    }, 3000);
  }

  // ════════════════════════════════════════════════════════════════════
  // ESTILOS
  // ════════════════════════════════════════════════════════════════════
  function injectStyles() {
    if (document.getElementById("avec-rodizio-styles")) return;
    const style = document.createElement("style");
    style.id = "avec-rodizio-styles";
    style.textContent = `
      #avec-rodizio-fab {
        position: fixed !important;
        bottom: 24px !important;
        right: 24px !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: flex-end !important;
        gap: 10px !important;
        font-family: 'Segoe UI', sans-serif !important;
      }
      #avec-rodizio-btn {
        background: linear-gradient(135deg, #7c3aed, #a855f7) !important;
        color: white !important;
        border: none !important;
        border-radius: 50px !important;
        padding: 12px 22px !important;
        font-size: 14px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        box-shadow: 0 4px 20px rgba(124,58,237,0.55) !important;
        transition: all 0.2s !important;
        white-space: nowrap !important;
        line-height: normal !important;
        text-transform: none !important;
        letter-spacing: normal !important;
      }
      #avec-rodizio-btn:hover {
        transform: scale(1.05) !important;
        box-shadow: 0 6px 28px rgba(124,58,237,0.7) !important;
      }
      #avec-rodizio-modal {
        background: #1e1b2e !important;
        border: 1px solid #7c3aed !important;
        border-radius: 16px !important;
        padding: 20px !important;
        width: 300px !important;
        box-shadow: 0 8px 40px rgba(0,0,0,0.6) !important;
        display: none !important;
        font-family: 'Segoe UI', sans-serif !important;
      }
      #avec-rodizio-modal.open { display: block !important; }
      #avec-rodizio-modal h3 {
        color: #c4b5fd !important;
        font-size: 14px !important;
        margin: 0 0 14px 0 !important;
        font-weight: 700 !important;
        border: none !important;
        padding: 0 !important;
        background: none !important;
      }
      #avec-rodizio-modal .rodizio-field { margin-bottom: 10px !important; }
      #avec-rodizio-modal .rodizio-field label {
        display: block !important;
        font-size: 11px !important;
        color: #a0a0c0 !important;
        margin-bottom: 4px !important;
        font-weight: 600 !important;
      }
      #avec-rodizio-modal input[type="text"] {
        width: 100% !important;
        background: #0f0e1a !important;
        border: 1px solid #3b2d6b !important;
        border-radius: 8px !important;
        color: #e0e0f0 !important;
        padding: 8px 10px !important;
        font-size: 13px !important;
        outline: none !important;
        box-sizing: border-box !important;
        height: auto !important;
        box-shadow: none !important;
      }
      .rodizio-search-wrap {
        position: relative !important;
      }
      .rodizio-dropdown {
        display: none !important;
        position: absolute !important;
        top: 100% !important;
        left: 0 !important;
        right: 0 !important;
        background: #1a1730 !important;
        border: 1px solid #3b2d6b !important;
        border-radius: 0 0 8px 8px !important;
        max-height: 180px !important;
        overflow-y: auto !important;
        z-index: 2147483647 !important;
        box-shadow: 0 4px 16px rgba(0,0,0,0.5) !important;
      }
      .rodizio-dd-item {
        padding: 7px 10px !important;
        font-size: 12px !important;
        color: #e0e0f0 !important;
        cursor: pointer !important;
        font-family: 'Segoe UI', sans-serif !important;
      }
      .rodizio-dd-item:hover {
        background: #2a1f4e !important;
        color: #c4b5fd !important;
      }
      #avec-rodizio-modal .rodizio-actions {
        display: flex !important;
        gap: 8px !important;
        margin-top: 14px !important;
      }
      #avec-rodizio-modal .rodizio-actions button {
        flex: 1 !important;
        padding: 9px !important;
        border-radius: 8px !important;
        font-size: 13px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        border: none !important;
        width: auto !important;
      }
      #rodizio-confirm-btn { background: #7c3aed !important; color: white !important; }
      #rodizio-confirm-btn:hover { background: #6d28d9 !important; }
      #rodizio-cancel-btn { background: #2a2540 !important; color: #a0a0c0 !important; }
      #rodizio-cancel-btn:hover { background: #3b2d6b !important; color: #fff !important; }
      #avec-rodizio-modal .rodizio-next-tip {
        background: #2a2540 !important;
        border-radius: 8px !important;
        padding: 8px 10px !important;
        font-size: 12px !important;
        color: #a78bfa !important;
        margin-top: 6px !important;
        text-align: center !important;
      }
      #avec-rodizio-toast {
        position: fixed !important;
        bottom: 90px !important;
        right: 24px !important;
        background: #1e1b2e !important;
        border: 1px solid #7c3aed !important;
        border-radius: 10px !important;
        padding: 12px 18px !important;
        font-size: 13px !important;
        color: #e0e0f0 !important;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4) !important;
        z-index: 2147483647 !important;
        display: none !important;
        transition: opacity 0.4s !important;
        font-family: 'Segoe UI', sans-serif !important;
        max-width: 280px !important;
      }
    `;
    document.head.appendChild(style);
  }

})();