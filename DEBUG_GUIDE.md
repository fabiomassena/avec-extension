# 🔍 Guia de Debug - Sistema de Rodízio

Este documento descreve como diagnosticar problemas de persistência no salvamento do rodízio.

---

## 🛠️ Ferramentas de Debug Disponíveis

No **console do painel da extensão**, use os seguintes comandos:

### `debugStorage()`
Imprime **todo** o conteúdo do storage:
```javascript
debugStorage()
// [DEBUG] Storage completo: {professionals: [...], serviceTypes: [...], counters: {...}, ...}
```

### `debugCounters()`
Imprime apenas os contadores:
```javascript
debugCounters()
// [DEBUG] Contadores: {st_123: {p_456: 5, p_789: 3}, ...}
```

### `debugHistory()`
Imprime o histórico:
```javascript
debugHistory()
// [DEBUG] Histórico: [{id: "h_123", date: "...", client: "...", ...}, ...]
```

### `debugClear()`
**⚠️ CUIDADO:** Limpa **todo** o storage:
```javascript
debugClear()
// Confirma com OK → Storage é apagado
```

---

##  Fluxo de Salvamento

1. **Usuário clica em "Salvar" no Avec**
2. **content.js** captura os dados do formulário
3. **content.js** busca correspondência de nomes (serviço e profissional)
4. **content.js** envia mensagem `registerAppointment` para o background
5. **background.js** valida os IDs (serviceTypeId e professionalId)
6. **background.js** incrementa contador e adiciona ao histórico
7. **background.js** salva no `chrome.storage.local`
8. **Painel** é atualizado automaticamente via `chrome.storage.onChanged`

---

## 🔍 Diagnóstico de Problemas

### Problema: Toast aparece, mas dados não persistem

**Passo 1: Verifique o storage**
```javascript
// No console do painel:
debugStorage()
```
Verifique se `counters` e `history` foram atualizados.

**Passo 2: Verifique se há erros no console**
- Abra o console do site do Avec (F12)
- Faça um agendamento
- Veja se aparece algum erro

**Passo 3: Verifique o background**
- Acesse `chrome://extensions`
- Clique em "background page" ou "página de serviço"
- Veja se há erros no console

---

### Problema: Mensagem "Não foi possível registrar"

**Causa:** O nome do serviço ou profissional no Avec não corresponde ao cadastrado no rodízio.

**Solução:**
1. No painel, vá em **Configurações**
2. Verifique os nomes cadastrados
3. Cadastre o serviço/profissional com o **nome exato** que aparece no Avec

---

### Problema: IDs inválidos

**Sintoma:**
```
❌ Erro: IDs inválidos - serviço ou profissional não encontrado
```

**Causa:** Os IDs `st_*` ou `p_*` não existem no storage.

**Solução:**
1. Recarregue a extensão (`chrome://extensions` → Recarregar)
2. Verifique se os dados existem:
   ```javascript
   debugStorage()
   ```
3. Se necessário, recadastre serviços e profissionais

---

### Problema: Painel não mostra dados

**Verifique:**
1. Se os dados estão no storage: `debugStorage()`
2. Se o histórico tem entries: `debugHistory()`
3. Se há erros no console do painel (F12)

---

## 📊 Estrutura do Storage

```javascript
{
  professionals: [
    { id: "p_1234567890", name: "João", active: true }
  ],
  serviceTypes: [
    { id: "st_0987654321", name: "Corte", categoryId: "sc_..." }
  ],
  serviceCategories: [
    { id: "sc_111", name: "Cabelo" }
  ],
  counters: {
    "st_0987654321": {
      "p_1234567890": 5  // João fez 5 cortes
    }
  },
  history: [
    {
      id: "h_111",
      date: "2026-04-01T15:30:00.000Z",
      client: "Maria",
      serviceTypeId: "st_0987654321",
      serviceTypeName: "Corte",
      professionalId: "p_1234567890",
      professionalName: "João",
      source: "auto"  // ou "manual"
    }
  ],
  lastServed: {
    "st_0987654321": "p_1234567890"
  },
  profServices: {
    "p_1234567890": ["st_0987654321", "st_..."]
  },
  serviceGroups: {
    "st_0987654321": "Grupo Corte"
  }
}
```

---

## 🆘 Checklist de Verificação

- [ ] Extensão recarregada (`chrome://extensions` → Recarregar)
- [ ] Console aberto no site do Avec (F12)
- [ ] Console aberto no painel da extensão
- [ ] `debugStorage()` mostra dados
- [ ] `debugHistory()` mostra entries
- [ ] Sem erros no console do background

---

## 🔗 Links Úteis

- `chrome://extensions` → Gerenciar extensões
- `chrome://extensions` → Inspecar views → background page
- Console do Avec → F12 no site
- Console do Painel → F12 na janela do painel
