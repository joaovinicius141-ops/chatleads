// ============================================================
// index.js
// Servidor Express — triagem por menu + Gemini por setor + PIX + PDF
// ============================================================

require("dotenv").config();

const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { gerarDocumento } = require("./gerador");
const { criarCobrancaPix, verificarPagamento } = require("./pagamento");
const { textoMenu, buscarSetor } = require("./setores");
const { linhaContato } = require("./contato");

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "meu_token_secreto";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const FB_APP_SECRET = process.env.FB_APP_SECRET || "";
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || "";
const TESTE_SECRET = process.env.TESTE_SECRET || "";
const NODE_ENV = process.env.NODE_ENV || "development";
const PORT = process.env.PORT || 3000;

const app = express();
// body-parser preservando o raw body para validacao de assinatura HMAC
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// NOTA DE SEGURANCA:
// A rota estatica "/arquivos" foi REMOVIDA porque expunha todos os PDFs
// gerados publicamente. Os documentos sao entregues diretamente via
// Messenger (form upload). Se precisar de URL publica no futuro, use
// tokens assinados com expiracao.

// Diagnostico de variaveis ao iniciar
const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN || "";
console.log(`[CONFIG] MERCADOPAGO_ACCESS_TOKEN: ${mpToken ? mpToken.slice(0, 15) + "..." + mpToken.slice(-6) : "NAO DEFINIDO"}`);
console.log(`[CONFIG] PUBLIC_URL: ${process.env.PUBLIC_URL || "NAO DEFINIDO"}`);
console.log(`[CONFIG] GEMINI_MODEL: ${GEMINI_MODEL}`);

// ─── ESTADO DAS SESSOES ───────────────────────────────────────
// Guarda o estado de cada usuario (psid):
// {
//   estado: "menu" | "atendimento",
//   setor: objeto do setor escolhido (ou null),
//   historico: [ { role, parts } ]
// }
const sessoes = new Map();
const MAX_SESSOES = 5000; // limite duro para conter DoS por memoria
const TTL_SESSAO_MS = 2 * 60 * 60 * 1000; // 2h

function getSessao(psid) {
  let s = sessoes.get(psid);
  if (!s) {
    // Se estourou o limite, remove a sessao mais antiga (LRU simples)
    if (sessoes.size >= MAX_SESSOES) {
      const maisAntigo = sessoes.keys().next().value;
      sessoes.delete(maisAntigo);
      console.warn(`[SESSAO] Limite atingido — removida ${maisAntigo}`);
    }
    s = { estado: "menu", setor: null, historico: [], atualizadoEm: Date.now() };
    sessoes.set(psid, s);
  } else {
    s.atualizadoEm = Date.now();
    // re-inserir para mover para o fim (LRU)
    sessoes.delete(psid);
    sessoes.set(psid, s);
  }
  return s;
}

function resetarSessao(psid) {
  sessoes.set(psid, { estado: "menu", setor: null, historico: [], atualizadoEm: Date.now() });
}

// Limpa sessoes inativas a cada 15min
setInterval(() => {
  const limite = Date.now() - TTL_SESSAO_MS;
  for (const [psid, s] of sessoes.entries()) {
    if ((s.atualizadoEm || 0) < limite) sessoes.delete(psid);
  }
}, 15 * 60 * 1000);

// Comparacao de strings em tempo constante (evita timing attack)
function compararSeguro(a, b) {
  const ba = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ─── PAGAMENTOS PENDENTES ─────────────────────────────────────
const pagamentosPendentes = new Map();

setInterval(() => {
  const limite = Date.now() - 35 * 60 * 1000;
  for (const [id, p] of pagamentosPendentes.entries()) {
    if (p.timestamp < limite) {
      pagamentosPendentes.delete(id);
      console.log(`[PAGAMENTO] Expirado e removido: id=${id}`);
    }
  }
}, 5 * 60 * 1000);

// ─── VERIFICACAO DO WEBHOOK ────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && compararSeguro(token, VERIFY_TOKEN)) {
    console.log("Webhook verificado com sucesso!");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Valida assinatura X-Hub-Signature-256 do Messenger
function assinaturaMessengerValida(req) {
  if (!FB_APP_SECRET) {
    if (NODE_ENV === "production") {
      console.error("[SEG] FB_APP_SECRET nao configurado em producao!");
      return false;
    }
    return true; // em dev, permite
  }
  const assinatura = req.get("x-hub-signature-256") || "";
  if (!assinatura.startsWith("sha256=") || !req.rawBody) return false;
  const esperado =
    "sha256=" +
    crypto.createHmac("sha256", FB_APP_SECRET).update(req.rawBody).digest("hex");
  return compararSeguro(assinatura, esperado);
}

// ─── RECEBE MENSAGENS DO MESSENGER ────────────────────────────
app.post("/webhook", async (req, res) => {
  if (!assinaturaMessengerValida(req)) {
    console.warn("[SEG] Assinatura invalida no /webhook");
    return res.sendStatus(403);
  }
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);
  res.sendStatus(200);

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      if (!event.message || event.message.is_echo) continue;
      const psid = event.sender.id;
      const texto = event.message.text;
      if (!texto) continue;

      console.log(`Mensagem de ${psid}: ${texto}`);
      processarComTimeout(psid, texto);
    }
  }
});

// Valida assinatura x-signature do Mercado Pago
// Doc: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
function assinaturaMPValida(req) {
  if (!MP_WEBHOOK_SECRET) {
    // Se o segredo nao estiver configurado, permite mas loga aviso.
    // Configure MP_WEBHOOK_SECRET no Railway para ativar a validacao completa.
    console.warn("[SEG] MP_WEBHOOK_SECRET nao configurado — webhook aceito sem validacao de assinatura");
    return true;
  }
  const xSignature = req.get("x-signature") || "";
  const xRequestId = req.get("x-request-id") || "";
  const dataId = (req.body && req.body.data && req.body.data.id) || req.query["data.id"] || "";
  if (!xSignature || !dataId) return false;

  // x-signature vem no formato "ts=123,v1=hash"
  const partes = Object.fromEntries(
    xSignature.split(",").map((p) => p.trim().split("=").map((x) => x.trim()))
  );
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const esperado = crypto
    .createHmac("sha256", MP_WEBHOOK_SECRET)
    .update(manifest)
    .digest("hex");
  return compararSeguro(v1, esperado);
}

// ─── WEBHOOK DO MERCADO PAGO ──────────────────────────────────
app.post("/pagamento/webhook", async (req, res) => {
  if (!assinaturaMPValida(req)) {
    console.warn("[SEG] Assinatura invalida no /pagamento/webhook");
    return res.sendStatus(403);
  }
  res.sendStatus(200);
  try {
    const { action, data } = req.body;
    if (!data || !data.id) return;
    if (action !== "payment.updated" && action !== "payment.created") return;

    const paymentId = String(data.id);
    console.log(`[PAGAMENTO] Webhook recebido: id=${paymentId} action=${action}`);

    const { pago, status } = await verificarPagamento(paymentId);
    console.log(`[PAGAMENTO] Status: ${status} | pago=${pago}`);
    if (!pago) return;

    const pedido = pagamentosPendentes.get(paymentId);
    if (!pedido) {
      console.warn(`[PAGAMENTO] Pedido nao encontrado para id=${paymentId}`);
      return;
    }

    pagamentosPendentes.delete(paymentId);
    await entregarDocumento(pedido);
  } catch (erro) {
    console.error("[PAGAMENTO] Erro no webhook:", erro.message);
  }
});

// ─── WRAPPER COM TIMEOUT E AVISOS AUTOMATICOS ─────────────────
// - Mais de 5s sem resposta  → envia "Um momento..."
// - Mais de 60s sem resposta → envia contato do Pedro
// - Qualquer erro inesperado → envia contato do Pedro
async function processarComTimeout(psid, texto) {
  // estado compartilhado entre timers e finally
  const estado = { concluido: false, fallback60Enviado: false };

  // Aviso de 5 segundos
  const timer5s = setTimeout(() => {
    if (!estado.concluido) {
      console.log(`[TIMEOUT] 5s sem resposta para ${psid} — enviando aviso`);
      enviarTexto(psid, "Um momento, estou processando sua solicitacao...").catch(() => {});
    }
  }, 5000);

  // Fallback de 60 segundos com contato do Pedro
  const timer60s = setTimeout(() => {
    if (!estado.concluido) {
      estado.fallback60Enviado = true;
      console.warn(`[TIMEOUT] 60s sem resposta para ${psid} — enviando contato do Pedro`);
      enviarTexto(
        psid,
        "Desculpe a demora! Estamos com uma instabilidade no momento.\n\n" +
          linhaContato()
      ).catch(() => {});
    }
  }, 60000);

  try {
    await processarMensagem(psid, texto);
  } catch (err) {
    console.error(`[ERRO] psid=${psid} | ${err.message}`);
    // So avisa se o fallback de 60s ainda nao foi disparado (evita mensagem duplicada)
    if (!estado.fallback60Enviado) {
      await enviarTexto(
        psid,
        "Tive um problema inesperado.\n\n" + linhaContato()
      );
    }
  } finally {
    estado.concluido = true;
    clearTimeout(timer5s);
    clearTimeout(timer60s);
  }
}

// ─── FLUXO PRINCIPAL POR MENSAGEM ─────────────────────────────
async function processarMensagem(psid, texto) {
  const sessao = getSessao(psid);

  // ── Estado: aguardando escolha do menu ──────────────────────
  if (sessao.estado === "menu") {
    const setor = buscarSetor(texto.trim());

    if (!setor) {
      // Nao reconheceu o numero — exibe o menu novamente
      await enviarTexto(psid, textoMenu());
      return;
    }

    // Setor encontrado — inicia o atendimento
    sessao.estado = "atendimento";
    sessao.setor = setor;
    sessao.historico = [];

    console.log(`[TRIAGEM] psid=${psid} escolheu setor: ${setor.nome}`);

    // Primeira mensagem da IA ja com contexto do setor
    const respostaIA = await chamarGemini(sessao.historico, setor.prompt);
    sessao.historico.push({ role: "model", parts: [{ text: respostaIA }] });
    await enviarTexto(psid, respostaIA);
    return;
  }

  // ── Estado: em atendimento com a IA ─────────────────────────
  if (sessao.estado === "atendimento") {
    // Limite defensivo no tamanho da mensagem do usuario
    const textoLimpo = String(texto).slice(0, 2000);
    sessao.historico.push({ role: "user", parts: [{ text: textoLimpo }] });

    // Limita historico (janela de 20 trocas)
    if (sessao.historico.length > 20) {
      sessao.historico = sessao.historico.slice(-20);
    }

    let respostaIA = "";
    try {
      respostaIA = await chamarGemini(sessao.historico, sessao.setor.prompt);
    } catch (err) {
      console.error("Erro Gemini:", err.message);
      // Remove a ultima msg do user para evitar duplicacao na proxima tentativa
      sessao.historico.pop();
      await enviarTexto(psid, "Desculpe, tive um problema. Pode repetir?");
      return;
    }

    const marcacao = extrairMarcacao(respostaIA);

    if (marcacao) {
      console.log(`Marcacao detectada: tipo=${marcacao.tipo}`);
      const setorAtual = sessao.setor;
      resetarSessao(psid); // volta ao menu apos coletar dados
      await processarPagamento(psid, setorAtual, marcacao.dados);
      return;
    }

    sessao.historico.push({ role: "model", parts: [{ text: respostaIA }] });
    await enviarTexto(psid, respostaIA);
  }
}

// ─── GERA PIX E AGUARDA PAGAMENTO ─────────────────────────────
async function processarPagamento(psid, setor, dados) {
  await enviarTexto(psid, "Perfeito! Gerando o PIX para voce, um segundo...");

  try {
    const cobranca = await criarCobrancaPix(setor.tipo, psid);

    pagamentosPendentes.set(String(cobranca.id), {
      psid,
      tipo: setor.tipo,
      dados,
      timestamp: Date.now(),
    });

    await enviarTexto(
      psid,
      `Para finalizar, faca o PIX de R$ ${setor.preco.toFixed(2).replace(".", ",")}:\n\n` +
      `Codigo PIX (copia e cola):\n${cobranca.codigoPix}\n\n` +
      `Valido por 30 minutos. Assim que o pagamento for confirmado, ` +
      `seu documento chega aqui automaticamente!`
    );
  } catch (erro) {
    console.error("[PAGAMENTO] Erro ao criar cobranca:", erro.message);
    await enviarTexto(
      psid,
      "Tive um problema para gerar o PIX.\n\n" + linhaContato()
    );
  }
}

// ─── ENTREGA O DOCUMENTO APOS PAGAMENTO CONFIRMADO ───────────
async function entregarDocumento(pedido) {
  console.log(`[ENTREGA] tipo=${pedido.tipo} psid=${pedido.psid}`);

  if (pedido.tipo === "contrato") {
    await gerarDocumento("contrato", pedido.dados);
    await enviarTexto(
      pedido.psid,
      "Pagamento confirmado! Contrato registrado com sucesso.\n" +
      "Nossa equipe prepara e entrega em ate 24h.\n\n" +
      linhaContato()
    );
    return;
  }

  const resultado = await gerarDocumento(pedido.tipo, pedido.dados);

  if (!resultado.sucesso) {
    await enviarTexto(
      pedido.psid,
      "Pagamento recebido! Mas tive um problema ao gerar o documento.\n\n" +
      linhaContato()
    );
    return;
  }

  const enviou = await enviarArquivo(pedido.psid, resultado.caminho, resultado.nomeArquivo);
  if (enviou) {
    await enviarTexto(
      pedido.psid,
      "Pagamento confirmado e documento gerado! Salva o arquivo aqui.\n" +
      "Qualquer duvida e so chamar!"
    );
  } else {
    await enviarTexto(
      pedido.psid,
      "Pagamento recebido! Tive um problema para enviar o arquivo.\n\n" +
      linhaContato()
    );
  }
}

// ─── DETECTA [DADOS_COMPLETOS:{...}] ──────────────────────────
function extrairMarcacao(texto) {
  if (!texto) return null;
  const idx = texto.indexOf("[DADOS_COMPLETOS:");
  if (idx === -1) return null;
  const inicio = texto.indexOf("{", idx);
  if (inicio === -1) return null;
  let nivel = 0, fim = -1;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === "{") nivel++;
    else if (texto[i] === "}") { nivel--; if (nivel === 0) { fim = i; break; } }
  }
  if (fim === -1) return null;
  try {
    const obj = JSON.parse(texto.slice(inicio, fim + 1));
    if (!obj.tipo || !obj.dados) return null;
    return obj;
  } catch (e) {
    console.error("JSON invalido na marcacao:", e.message);
    return null;
  }
}

// ─── CHAMA O GEMINI ───────────────────────────────────────────
async function chamarGemini(historico, promptSetor, tentativa = 1) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY nao configurada");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  // Se historico vazio, manda uma mensagem inicial para a IA se apresentar
  const contents = historico.length > 0
    ? historico
    : [{ role: "user", parts: [{ text: "Ola, quero este servico." }] }];

  try {
    const response = await axios.post(
      url,
      {
        system_instruction: { parts: [{ text: promptSetor }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      },
      { timeout: 30000 }
    );
    return response.data.candidates[0].content.parts[0].text.trim();
  } catch (err) {
    const status = err.response && err.response.status;
    const detalhe = err.response && JSON.stringify(err.response.data);
    console.error(`[GEMINI] Erro ${status} | detalhe: ${detalhe}`);
    // 429 = rate limit | 503 = sobrecarga temporaria — ambos com retry
    if ((status === 429 || status === 503) && tentativa <= 3) {
      const esperas = [5000, 15000, 30000]; // 5s, 15s, 30s
      console.warn(`[GEMINI] Erro ${status}. Tentativa ${tentativa}/3. Aguardando ${esperas[tentativa - 1] / 1000}s...`);
      await new Promise((r) => setTimeout(r, esperas[tentativa - 1]));
      return chamarGemini(historico, promptSetor, tentativa + 1);
    }
    throw err;
  }
}

// ─── ENVIA TEXTO PELO MESSENGER ───────────────────────────────
async function enviarTexto(recipientId, texto) {
  if (!PAGE_ACCESS_TOKEN) { console.warn("PAGE_ACCESS_TOKEN nao configurado"); return false; }
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      { recipient: { id: recipientId }, message: { text: texto } },
      { params: { access_token: PAGE_ACCESS_TOKEN }, timeout: 15000 }
    );
    return true;
  } catch (err) {
    console.error("Erro enviarTexto:", err.response ? JSON.stringify(err.response.data) : err.message);
    return false;
  }
}

// ─── ENVIA ARQUIVO PDF PELO MESSENGER ─────────────────────────
async function enviarArquivo(recipientId, caminhoArquivo, nomeArquivo) {
  if (!PAGE_ACCESS_TOKEN) return false;
  if (!fs.existsSync(caminhoArquivo)) { console.error("Arquivo nao encontrado:", caminhoArquivo); return false; }
  try {
    const form = new FormData();
    form.append("recipient", JSON.stringify({ id: recipientId }));
    form.append("message", JSON.stringify({
      attachment: { type: "file", payload: { is_reusable: false } },
    }));
    form.append("filedata", fs.createReadStream(caminhoArquivo), {
      filename: nomeArquivo,
      contentType: "application/pdf",
    });
    await axios.post(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      form,
      { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 30000 }
    );
    console.log("Arquivo enviado:", nomeArquivo);
    return true;
  } catch (err) {
    console.error("Erro enviarArquivo:", err.response ? JSON.stringify(err.response.data) : err.message);
    return false;
  }
}

// ─── ENDPOINT DE TESTE: simula pagamento aprovado ─────────────
// So funciona se NODE_ENV != "production" E TESTE_SECRET estiver definido.
app.get("/aprovar-teste/:paymentId", async (req, res) => {
  if (NODE_ENV === "production") {
    return res.status(404).send("Not found");
  }
  if (!TESTE_SECRET || !compararSeguro(req.query.secret, TESTE_SECRET)) {
    return res.status(403).send("Acesso negado");
  }

  const { paymentId } = req.params;
  const pedido = pagamentosPendentes.get(String(paymentId));
  if (!pedido) {
    return res.status(404).send(
      `Pagamento ${paymentId} nao encontrado. Pendentes: ${[...pagamentosPendentes.keys()].join(", ") || "nenhum"}`
    );
  }

  pagamentosPendentes.delete(String(paymentId));
  res.send(`Aprovado! Gerando ${pedido.tipo} para psid=${pedido.psid}...`);
  await entregarDocumento(pedido).catch((e) => console.error("[TESTE]", e.message));
});

// ─── ROTA DE SAUDE ────────────────────────────────────────────
app.get("/", (_req, res) => res.send(`chatleads ativo | modelo: ${GEMINI_MODEL}`));

// ─── INICIA SERVIDOR ──────────────────────────────────────────
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
