# 2026-04-21 — Sistema de Suporte Completo

## Resumo

Sessão de implementação focada em tornar o suporte ao cliente mais robusto e resiliente. Seis mudanças foram feitas em `index.js` e `prompts/suporte.js`.

---

## Mudanças Implementadas

### 1. Janela de correções: 24h → 12h

**Arquivo:** `index.js`

- Adicionada constante `TTL_ENTREGA_MS = 12 * 60 * 60 * 1000` (substitui a variável local `JANELA_24H`)
- Mensagem ao expirar: *"O prazo de 12 horas para solicitar correções já encerrou."*
- Mensagem na entrega do documento: *"Você tem até 12 horas para solicitar uma correção gratuita."*
- Prompt `suporte.js` atualizado: referências a 24h → 12h na política de correções e reembolso

---

### 2. Restauração automática de `pos_entrega` em sessões expiradas

**Arquivo:** `index.js`

**Problema:** Sessão expira em 2h. Cliente que volta após 2h (mas dentro das 12h de correção) cai em `boas_vindas` sem contexto.

**Solução:** `entregasRecentes` — Map separado com TTL de 12h.

```js
const entregasRecentes = new Map(); // chave: "canal:userId" → { tipo, dados, entregueEm }
```

- Ao entregar documento: salva em `entregasRecentes`
- Em `getSessao()`: se sessão nova + entrada válida em `entregasRecentes` (< 12h) → restaura `pos_entrega` automaticamente
- Cleanup a cada 30min: remove entradas expiradas
- Ao expirar a janela de 12h: remove a entrada de `entregasRecentes` + reseta sessão

---

### 3. Prompt de suporte reescrito

**Arquivo:** `prompts/suporte.js`

Reescrito de ~30 linhas para um prompt robusto cobrindo:

| Categoria | Comportamento |
|---|---|
| Dúvidas sobre documentos | Explica o que é, para que serve, onde é aceito, preço |
| Problema com PDF | Orienta a salvar; se não recebeu após pagamento → escala |
| Prazo de entrega | Declaração/Recibo: na hora. Contrato: até 24h úteis |
| Reembolso | Explica política (não há); insistência/cobrança dupla → escala |
| Correção dentro de 12h | Orienta a descrever; bot faz automaticamente |
| Dúvida jurídica específica | Responde o básico; indica advogado para casos complexos |
| Reclamação geral | Acolhe, tenta resolver, escala se necessário |
| Problema técnico grave | Sempre escala com `[ENCAMINHAR_PEDRO]` |

**Escalação imediata** para Pedro quando:
- Cliente pede explicitamente falar com humano
- Pagamento debitado sem receber documento
- Reembolso com insistência ou cobrança dupla
- 2 tentativas sem resolver (via contador automático)

---

### 4. Contador de tentativas no suporte

**Arquivo:** `index.js`

- Sessão rastreia `sessao.tentativasSuporte` (iniciado em 0 na entrada do suporte)
- Incrementa a cada resposta do Gemini no setor suporte sem `[ENCAMINHAR_PEDRO]`
- Ao atingir **3 tentativas**: escalação automática para Pedro + reset de sessão

```js
if (sessao.setor && sessao.setor.tipo === "suporte") {
  sessao.tentativasSuporte = (sessao.tentativasSuporte || 0) + 1;
  if (sessao.tentativasSuporte >= 3) {
    // escala para Pedro
  }
}
```

---

### 5. Mensagem de boas-vindas ao entrar no Suporte

**Arquivo:** `index.js` — estado `lgpd_aguardando`

Quando o setor escolhido é `suporte`, após aceite LGPD e antes do Gemini:

```
"Olá! Estou aqui para te ajudar 😊
Me conta o que está acontecendo que eu já verifico para você!"
```

O `tentativasSuporte` também é zerado neste momento.

---

## Arquivos Modificados

| Arquivo | O que mudou |
|---|---|
| `index.js` | `TTL_ENTREGA_MS`, `entregasRecentes`, `getSessao()`, `lgpd_aguardando`, `pos_entrega`, `atendimento`, `entregarDocumento()` |
| `prompts/suporte.js` | Reescrita completa |

---

*Implementado em: 2026-04-21*
