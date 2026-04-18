// ============================================================
// index.js
// Servidor Express — triagem por menu + Gemini por setor + PIX + PDF
//
// Arquitetura multi-canal:
//   canais/messenger.js  → Facebook Messenger (ativo)
//   canais/whatsapp.js   → WhatsApp Cloud API (esqueleto pronto)
//   admin.js             → endpoints protegidos /admin/*
//   limpeza.js           → retencao de 30 dias em documentos/logs
//   logger.js            → tee de console -> logs/YYYY-MM-DD/app.log
// ============================================================

// IMPORTANTE: logger deve ser o PRIMEIRO require para capturar
// todos os console.log subsequentes em arquivo.
require("./logger");

require("dotenv").config();

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");

const { gerarDocumento } = require("./gerador");
const { criarCobrancaPix, verificarPagamento } = require("./pagamento");
const { textoMenu, buscarSetor } = require("./setores");
const { linhaContato } = require("./contato");

const messenger = require("./canais/messenger");
const whatsapp = require("./canais/whatsapp");
const admin = require("./admin");
const limpeza = require("./limpeza");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || "";
const TESTE_SECRET = process.env.TESTE_SECRET || "";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
const NODE_ENV = process.env.NODE_ENV || "development";
const PORT = process.env.PORT || 3000;

const app = express();
// body-parser preservando o raw body para validacao de assinatura HMAC
app.use(
  express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; },
  })
);

// Diagnostico de variaveis ao iniciar
const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN || "";
console.log(`[CONFIG] MERCADOPAGO_ACCESS_TOKEN: ${mpToken ? mpToken.slice(0, 15) + "..." + mpToken.slice(-6) : "NAO DEFINIDO"}`);
console.log(`[CONFIG] PUBLIC_URL: ${process.env.PUBLIC_URL || "NAO DEFINIDO"}`);
console.log(`[CONFIG] GEMINI_MODEL: ${GEMINI_MODEL}`);
console.log(`[CONFIG] NODE_ENV: ${NODE_ENV}`);
console.log(`[CONFIG] ADMIN_SECRET: ${ADMIN_SECRET ? "configurado" : "NAO DEFINIDO"}`);
console.log(`[CONFIG] WHATSAPP: ${whatsapp.ativo() ? "ativo" : "nao configurado"}`);

// ─── ESTADO DAS SESSOES ───────────────────────────────────────
// Identificadas por "canal:userId" para nao colidirem entre canais.
const sessoes = new Map();
const MAX_SESSOES = 5000;
const TTL_SESSAO_MS = 2 * 60 * 60 * 1000;

function chaveSessao(canal, userId) {
  return `${canal.nome}:${userId}`;
}

function getSessao(canal, userId) {
  const chave = chaveSessao(canal, userId);
  let s = sessoes.get(chave);
  if (!s) {
    if (sessoes.size >= MAX_SESSOES) {
      const maisAntigo = sessoes.keys().next().value;
      sessoes.delete(maisAntigo);
      console.warn(`[SESSAO] Limite atingido — removida ${maisAntigo}`);
    }
    // Nova sessao comeca no fluxo de consentimento LGPD
    s = { estado: "lgpd", setor: null, historico: [], atualizadoEm: Date.now() };
    sessoes.set(chave, s);
  } else {
    s.atualizadoEm = Date.now();
    sessoes.delete(chave);
    sessoes.set(chave, s);
  }
  return s;
}

function resetarSessao(canal, userId) {
  sessoes.set(chaveSessao(canal, userId), {
    estado: "menu", setor: null, historico: [], atualizadoEm: Date.now(),
  });
}

// Limpa sessoes inativas a cada 15min
setInterval(() => {
  const limite = Date.now() - TTL_SESSAO_MS;
  for (const [chave, s] of sessoes.entries()) {
    if ((s.atualizadoEm || 0) < limite) sessoes.delete(chave);
  }
}, 15 * 60 * 1000);

// Comparacao de strings em tempo constante
function compararSeguro(a, b) {
  const ba = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ─── PAGAMENTOS PENDENTES ─────────────────────────────────────
// Guarda tambem o canal para entregar pela mesma via que originou o pedido.
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

// Mapa de canais ativos por nome (para recuperar apos webhook do MP)
const canaisAtivos = { messenger };
if (whatsapp.ativo()) canaisAtivos.whatsapp = whatsapp;

// ─── REGISTRO DOS WEBHOOKS DOS CANAIS ─────────────────────────
messenger.registrarWebhook(app, processarComTimeout);
if (whatsapp.ativo()) {
  whatsapp.registrarWebhook(app, processarComTimeout);
}

// ─── WEBHOOK DO MERCADO PAGO ──────────────────────────────────
function assinaturaMPValida(req) {
  if (!MP_WEBHOOK_SECRET) {
    console.warn("[SEG] MP_WEBHOOK_SECRET nao configurado — webhook aceito sem validacao");
    return true;
  }
  const xSignature = req.get("x-signature") || "";
  const xRequestId = req.get("x-request-id") || "";
  const dataId = (req.body && req.body.data && req.body.data.id) || req.query["data.id"] || "";
  if (!xSignature || !dataId) return false;

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
// Assinatura: (userId, texto, canal) — chamada pelos webhooks dos canais.
async function processarComTimeout(userId, texto, canal) {
  const estado = { concluido: false, fallback60Enviado: false };

  const timer5s = setTimeout(() => {
    if (!estado.concluido) {
      console.log(`[TIMEOUT] 5s sem resposta para ${canal.nome}:${userId}`);
      canal.enviarTexto(userId, "Um momento, estou processando sua solicitacao...").catch(() => {});
    }
  }, 5000);

  const timer60s = setTimeout(() => {
    if (!estado.concluido) {
      estado.fallback60Enviado = true;
      console.warn(`[TIMEOUT] 60s sem resposta para ${canal.nome}:${userId}`);
      canal.enviarTexto(
        userId,
        "Desculpe a demora! Estamos com uma instabilidade no momento.\n\n" + linhaContato()
      ).catch(() => {});
    }
  }, 60000);

  try {
    await processarMensagem(userId, texto, canal);
  } catch (err) {
    console.error(`[ERRO] ${canal.nome}:${userId} | ${err.message}`);
    if (!estado.fallback60Enviado) {
      await canal.enviarTexto(
        userId,
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
async function processarMensagem(userId, texto, canal) {
  const sessao = getSessao(canal, userId);

  // ── Estado: aguardando exibir tela de consentimento LGPD ────
  if (sessao.estado === "lgpd") {
    sessao.estado = "lgpd_aguardando";
    const msgLgpd =
      "Ola! Para gerarmos seu documento, precisamos coletar alguns dados pessoais. " +
      "Ao continuar, voce declara estar de acordo com nossos Termos de Uso e autoriza " +
      "o tratamento dos dados apenas para esta finalidade. " +
      "Seus dados e o PDF serao excluidos permanentemente em 30 dias.";

    // Usa Quick Reply se o canal suportar, senso envia texto simples
    if (typeof canal.enviarQuickReply === "function") {
      await canal.enviarQuickReply(userId, msgLgpd, [
        { titulo: "Aceito e Continuar", payload: "LGPD_ACEITO" },
      ]);
    } else {
      await canal.enviarTexto(userId, msgLgpd + '\n\nDigite "aceito" para continuar.');
    }
    return;
  }

  // ── Estado: aguardando resposta do consentimento LGPD ───────
  if (sessao.estado === "lgpd_aguardando") {
    console.log(`[LGPD] Aceite registrado: ${canal.nome}:${userId} em ${new Date().toISOString()}`);
    sessao.estado = "menu";
    await canal.enviarTexto(userId, textoMenu());
    return;
  }

  // ── Estado: aguardando feedback pos-entrega ──────────────────
  // Cliente recebeu o documento e enviou uma mensagem de insatisfacao ou duvida.
  // Gemini analisa os dados usados e decide se ha erro real ou nao.
  if (sessao.estado === "pos_entrega") {
    const entrega = sessao.dadosEntregues;
    resetarSessao(canal, userId); // reseta antes de processar (evita loop)
    await revisarDocumento(userId, texto, entrega, canal);
    return;
  }

  if (sessao.estado === "menu") {
    const setor = buscarSetor(texto.trim());
    if (!setor) {
      await canal.enviarTexto(userId, textoMenu());
      return;
    }
    sessao.estado = "atendimento";
    sessao.setor = setor;
    sessao.historico = [];
    console.log(`[TRIAGEM] ${canal.nome}:${userId} escolheu setor: ${setor.nome}`);

    const respostaIA = await chamarGemini(sessao.historico, setor.prompt);
    sessao.historico.push({ role: "model", parts: [{ text: respostaIA }] });
    await canal.enviarTexto(userId, respostaIA);
    return;
  }

  if (sessao.estado === "atendimento") {
    const textoLimpo = String(texto).slice(0, 2000);
    sessao.historico.push({ role: "user", parts: [{ text: textoLimpo }] });

    // Limita historico preservando ancora (primeiras 4 msgs) + 36 recentes
    const MAX_HIST = 40;
    const ANCORA = 4;
    if (sessao.historico.length > MAX_HIST) {
      sessao.historico = [
        ...sessao.historico.slice(0, ANCORA),
        ...sessao.historico.slice(-(MAX_HIST - ANCORA)),
      ];
    }

    let respostaIA = "";
    try {
      respostaIA = await chamarGemini(sessao.historico, sessao.setor.prompt);
    } catch (err) {
      console.error("Erro Gemini:", err.message);
      sessao.historico.pop();
      await canal.enviarTexto(userId, "Desculpe, tive um problema. Pode repetir?");
      return;
    }

    const marcacao = extrairMarcacao(respostaIA);

    if (marcacao) {
      console.log(`Marcacao detectada: tipo=${marcacao.tipo}`);
      const setorAtual = sessao.setor;
      resetarSessao(canal, userId);
      await processarPagamento(userId, setorAtual, marcacao.dados, canal);
      return;
    }

    sessao.historico.push({ role: "model", parts: [{ text: respostaIA }] });
    await canal.enviarTexto(userId, respostaIA);
  }
}

// ─── GERA PIX E AGUARDA PAGAMENTO ─────────────────────────────
async function processarPagamento(userId, setor, dados, canal) {
  await canal.enviarTexto(userId, "Perfeito! Gerando o PIX para voce, um segundo...");
  try {
    const cobranca = await criarCobrancaPix(setor.tipo, userId);

    pagamentosPendentes.set(String(cobranca.id), {
      userId,
      canalNome: canal.nome,
      tipo: setor.tipo,
      dados,
      timestamp: Date.now(),
    });

    await canal.enviarTexto(
      userId,
      `Tudo certo! Para finalizar, faca o PIX de R$ ${setor.preco.toFixed(2).replace(".", ",")}.\n\n` +
      `No proximo campo esta o codigo PIX — e so copiar e colar no app do seu banco.\n` +
      `Valido por 30 minutos. Assim que o pagamento for confirmado, ` +
      `seu documento chega aqui automaticamente!`
    );
    await canal.enviarTexto(userId, cobranca.codigoPix);
  } catch (erro) {
    console.error("[PAGAMENTO] Erro ao criar cobranca:", erro.message);
    await canal.enviarTexto(userId, "Tive um problema para gerar o PIX.\n\n" + linhaContato());
  }
}

// ─── ENTREGA O DOCUMENTO APOS PAGAMENTO CONFIRMADO ───────────
async function entregarDocumento(pedido) {
  const canal = canaisAtivos[pedido.canalNome] || messenger;
  console.log(`[ENTREGA] tipo=${pedido.tipo} ${canal.nome}:${pedido.userId}`);

  if (pedido.tipo === "contrato") {
    await gerarDocumento("contrato", pedido.dados);
    await canal.enviarTexto(
      pedido.userId,
      "Pagamento confirmado! Contrato registrado com sucesso.\n" +
      "Este documento e personalizado e sera entregue em ate 24h uteis apos o pagamento.\n\n" +
      linhaContato()
    );
    return;
  }

  const resultado = await gerarDocumento(pedido.tipo, pedido.dados);

  if (!resultado.sucesso) {
    await canal.enviarTexto(
      pedido.userId,
      "Pagamento recebido! Mas tive um problema ao gerar o documento.\n\n" + linhaContato()
    );
    return;
  }

  const enviou = await canal.enviarArquivo(pedido.userId, resultado.caminho, resultado.nomeArquivo);
  if (enviou) {
    await canal.enviarTexto(
      pedido.userId,
      "Aqui esta seu documento! \u2705\n\n" +
      "Importante: por seguranca, este arquivo estara disponivel por 30 dias. " +
      "Salve o PDF no seu dispositivo agora mesmo!\n\n" +
      "Caso tenha alguma duvida ou algo nao esteja certo, e so me dizer aqui!"
    );
    // Ativa estado pos_entrega para capturar feedback do cliente
    const sessao = getSessao(canal, pedido.userId);
    sessao.estado = "pos_entrega";
    sessao.dadosEntregues = { tipo: pedido.tipo, dados: pedido.dados };
  } else {
    // Log critico — pagamento confirmado mas entrega falhou
    console.error(
      `[CRITICO] FALHA NA ENTREGA POS-PIX | tipo=${pedido.tipo} | ` +
      `${canal.nome}:${pedido.userId} | arquivo=${resultado.nomeArquivo} | ` +
      `caminho=${resultado.caminho} | ts=${new Date().toISOString()}`
    );
    await canal.enviarTexto(
      pedido.userId,
      "Pagamento recebido! Tive um problema para enviar o arquivo.\n\n" + linhaContato()
    );
  }
}

// ─── REVISAO POS-ENTREGA ──────────────────────────────────────
// Gemini analisa os dados do documento vs. reclamacao do cliente.
// Responde com [ERRO_ENCONTRADO] ou [SEM_ERRO] + explicacao.
async function revisarDocumento(userId, reclamacao, entrega, canal) {
  console.log(`[REVISAO] Iniciando revisao pos-entrega: tipo=${entrega.tipo} ${canal.nome}:${userId}`);

  const promptRevisao =
    `Voce e um revisor de documentos da Crie Seu Contrato.\n` +
    `Um cliente recebeu um documento do tipo "${entrega.tipo}" e reportou um problema ou insatisfacao.\n\n` +
    `DADOS USADOS PARA GERAR O DOCUMENTO:\n${JSON.stringify(entrega.dados, null, 2)}\n\n` +
    `MENSAGEM DO CLIENTE:\n"${String(reclamacao).slice(0, 1000)}"\n\n` +
    `SUA TAREFA:\n` +
    `1. Analise os dados do documento com atencao\n` +
    `2. Verifique se ha erros evidentes, dados incorretos ou inconsistencias nos dados\n` +
    `3. Considere a reclamacao do cliente em relacao ao que foi gerado\n\n` +
    `FORMATO DE RESPOSTA OBRIGATORIO:\n` +
    `- Se encontrar erro real nos dados: comece com [ERRO_ENCONTRADO] e descreva brevemente o problema\n` +
    `- Se nao encontrar erro: comece com [SEM_ERRO] e explique de forma simples e empatica ` +
    `para o cliente o que foi gerado e por que os dados parecem corretos\n` +
    `Seja humano, breve e claro. Nao repita os dados tecnicos ao cliente.`;

  try {
    const resposta = await chamarGemini(
      [{ role: "user", parts: [{ text: promptRevisao }] }],
      "Voce e um revisor tecnico de documentos. Analise com rigor e responda no formato solicitado."
    );

    if (resposta.includes("[ERRO_ENCONTRADO]")) {
      const detalhe = resposta.replace(/\[ERRO_ENCONTRADO\]/g, "").trim();
      console.warn(`[REVISAO] Erro encontrado no documento de ${canal.nome}:${userId} — ${detalhe}`);
      await canal.enviarTexto(
        userId,
        `Identificamos um possivel problema no seu documento.\n\n${detalhe}\n\n` +
        `Entre em contato com nossa equipe para corrigirmos sem custo adicional:\n\n` +
        linhaContato()
      );
    } else {
      const explicacao = resposta.replace(/\[SEM_ERRO\]/g, "").trim();
      console.log(`[REVISAO] Sem erros encontrados para ${canal.nome}:${userId}`);
      await canal.enviarTexto(userId, explicacao);
    }
  } catch (err) {
    console.error("[REVISAO] Erro ao chamar Gemini:", err.message);
    await canal.enviarTexto(
      userId,
      "Nao consegui revisar seu documento agora. Por favor, fale diretamente com nossa equipe:\n\n" +
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
    if ((status === 429 || status === 503) && tentativa <= 3) {
      const esperas = [5000, 15000, 30000];
      console.warn(`[GEMINI] Tentativa ${tentativa}/3. Aguardando ${esperas[tentativa - 1] / 1000}s...`);
      await new Promise((r) => setTimeout(r, esperas[tentativa - 1]));
      return chamarGemini(historico, promptSetor, tentativa + 1);
    }
    throw err;
  }
}

// ─── ENDPOINT DE TESTE: simula pagamento aprovado ─────────────
app.get("/aprovar-teste/:paymentId", async (req, res) => {
  if (NODE_ENV === "production") return res.status(404).send("Not found");
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
  res.send(`Aprovado! Gerando ${pedido.tipo} para ${pedido.canalNome}:${pedido.userId}...`);
  await entregarDocumento(pedido).catch((e) => console.error("[TESTE]", e.message));
});

// ─── ENDPOINTS ADMINISTRATIVOS ────────────────────────────────
admin.registrar(app, ADMIN_SECRET);

// ─── PAINEL VISUAL (dashboard.html) ───────────────────────────
app.get("/admin/painel", (req, res) => {
  if (!ADMIN_SECRET) return res.status(503).send("ADMIN_SECRET nao configurado");
  if (!compararSeguro(req.query.secret, ADMIN_SECRET)) return res.status(403).send("Acesso negado");
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// ─── ROTINA DE LIMPEZA (30 DIAS) ──────────────────────────────
limpeza.iniciarAgendamento();

// ─── ROTA DE SAUDE ────────────────────────────────────────────
app.get("/", (_req, res) => res.send(`chatleads ativo | modelo: ${GEMINI_MODEL}`));

// ─── INICIA SERVIDOR ──────────────────────────────────────────
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
