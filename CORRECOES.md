# ✅ Correções Aplicadas - Rodízio Avec

## 📋 Problemas Resolvidos

### 1. **Cliente não capturado no modal de criação**
**Problema:** O elemento `.blocknome` só existe no modal de edição.

**Solução:** Criada função `getClienteNome()` com 6 fallbacks:
- `.blocknome` (edição)
- `#slcCliente` (select ou input - criação)
- `#sltCliente` (select)
- `#sltCliente_chosen input` (Chosen UI)
- `input[name='cliente']` (genérico)
- `.typeahead-field input` (fallback)

---

### 2. **Profissional não capturado**
**Problema:** Seletores `#sltProf` e `#slcProf` não existem no Avec.

**Solução:** Busca por `name="prof[]"` (criação) e `name="prof"` (edição):
```javascript
// Tenta 1: name="prof" (modal de edição)
const profSelect = document.querySelector("select[name='prof']");

// Tenta 2: name="prof[]" (modal de criação)
const profArraySelect = document.querySelector("select[name='prof[]']");
```

---

### 3. **Cancelamento de agendamento duplicava registro**
**Problema:** Ao marcar "Cancelado" e salvar, o sistema registrava como novo agendamento.

**Solução:** Verifica status "Cancelado" antes de capturar:
```javascript
// Botão "Cancelado" tem id="statusCancelado" e value="0"
const canceladoById = document.querySelector("#statusCancelado:checked");

const isCancelado = canceladoRadio || 
                    canceladoById ||
                    (statusSelecionado && 
                     (statusSelecionado === "0" || 
                      statusSelecionado === "6" || 
                      statusSelecionado === "7"));

if (isCancelado) return; // Ignora cancelamentos
```

---

### 4. **Modal de edição registrava novamente**
**Problema:** Edição de agendamento existente criava novo registro.

**Solução:** Detecta modo edição e ignora:
```javascript
const isEditMode = document.querySelector("input[name='id'], input[name='agenda_id']");
if (isEditMode) return; // Agendamento já existe
```

---

### 5. **Duplicata de captura**
**Problema:** Múltiplos cliques em "Salvar" registravam várias vezes.

**Solução:** Flag `capturedAppointmentId` previne duplicatas:
```javascript
let capturedAppointmentId = null;

if (capturedAppointmentId === currentId) return;
capturedAppointmentId = currentId;
```

---

### 6. **Toast não mostrava cliente**
**Problema:** Toast não exibia nome do cliente.

**Solução:** Adicionado cliente ao toast:
```javascript
const clienteMsg = appt.client ? ` (${appt.client})` : "";
showToast(`✅ Registrado: ${matchProf.name} → ${matchService.name}${clienteMsg}`);
```

---

### 7. **Importação Google Sheets - Categorias erradas**
**Problema:** Serviços eram importados com categorias incorretas ou vazias.

**Causa raiz:** O CSV do Google Sheets tinha **quebras de linha dentro de células**:
```csv
"Alongamento de cabelo - Manutenção
","Cabelo"
```

**Solução:** Reescrito o parser CSV para lidar com:
- ✅ Quebras de linha dentro de aspas
- ✅ Vírgulas dentro de células
- ✅ Aspas duplas escapadas

```javascript
function parseCsv(text) {
  // Parser caractere por caractere
  // Respeita estado "inQuote" para não quebrar em newlines dentro de aspas
}
```

---

### 8. **Normalização de categorias na importação**
**Problema:** Categorias com acentos ou case diferente eram duplicadas.

**Solução:** Função `normalize()` para comparação:
```javascript
const normalize = str => str.toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // Remove acentos
  .trim();

// "Cabelo" === "cabelo" === "cabelo "
```

---

## 🔄 Fluxo Atual

### Novo Agendamento (Criação):
```
1. Usuário preenche: Cliente + Serviço + Profissional
2. Clica em "Salvar"
3. Sistema captura dados
4. Registra no rodízio
5. Toast: "✅ Registrado: Prof → Serviço (Cliente)"
```

### Cancelamento (Edição):
```
1. Usuário abre agendamento existente
2. Marca status "Cancelado" (value="0")
3. Clica em "Salvar"
4. Sistema detecta cancelamento
5. ❌ NÃO registra no rodízio
```

### Importação Google Sheets:
```
1. Usuário cola link da planilha
2. Sistema busca CSV das abas "Profissionais" e "Servicos"
3. Parser CSV lida com quebras de linha
4. Serviços são extraídos com nome e categoria
5. Categorias são normalizadas (sem acentos, case-insensitive)
6. Serviços novos são criados, existentes têm categoria atualizada
```

---

## 🎯 Status: RESOLVIDO

| Cenário | Comportamento |
|---------|--------------|
| Novo agendamento | ✅ Registra no rodízio |
| Cancelamento | ✅ Ignora |
| Edição (alterar dados) | ✅ Ignora |
| Edição (reativar) | ✅ Ignora |
| Múltiplos cliques | ✅ Previne duplicata |
| Cliente vazio | ✅ Permite (opcional) |
| Profissional vazio | ✅ Sugere próximo |
| Importação com quebra de linha | ✅ Parser corrige |
| Categorias com acentos | ✅ Normaliza |
| Serviço já existe | ✅ Atualiza categoria |

---

## 📝 Arquivos Modificados

| Arquivo | Mudanças |
|---------|----------|
| `content.js` | `getClienteNome()`, `captureFormSnapshot()`, detecção de cancelamento, flag anti-duplicata |
| `panel.js` | `parseCsv()` robusto, `extractServicesFromCsv()`, normalização de categorias, debug utils |
| `background.js` | Validação de IDs |
| `DEBUG_GUIDE.md` | Guia de diagnóstico |
| `CORRECOES.md` | Este arquivo |

---

## 🧪 Comandos de Debug (Console do Painel)

```javascript
debugStorage()     // Ver todo o storage
debugCounters()    // Ver contadores
debugHistory()     // Ver histórico
debugClear()       // ⚠️ Limpar tudo
```

---

## 🔧 Manutenção Futura

### Se importação falhar:

1. **Verifique o formato da planilha**:
   - Aba "Profissionais": coluna `nome`
   - Aba "Servicos": colunas `nome` e `categoria`
   - Planilha deve estar com acesso "Qualquer pessoa com o link pode ver"

2. **Teste o parser**:
   ```javascript
   // No console do painel:
   const csv = `"nome","categoria"
   "Serviço 1","Categoria A"
   "Serviço 2","Categoria B"`;
   
   const rows = parseCsv(csv);
   console.log(rows);
   ```

### Se categorias duplicarem:

1. **Verifique nomes similares**:
   ```javascript
   debugStorage()
   // Veja se tem "Cabelo" e "cabelo" como categorias diferentes
   ```

2. **Limpe categorias duplicadas** manualmente no painel

---

## 📞 Suporte

Para diagnosticar problemas:

1. Abra o console do painel (F12)
2. Execute `debugStorage()`
3. Verifique se `history` tem entradas duplicadas
4. Se tiver, veja os logs no console do Avec

Documentação completa em `DEBUG_GUIDE.md`.
