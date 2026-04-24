// ============================================================
// index.js — v2.1.0
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
const fs = require("fs");
const path = require("path");
const https = require("https");

// Agente HTTPS reutilizado para chamadas ao Gemini.
// Evita o MaxListenersExceededWarning causado por muitos listeners TLS
// quando cada chamada cria sua propria conexao.
const geminiHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

const { gerarDocumento } = require("./gerador");
const { criarCobrancaPix, verificarPagamento } = require("./pagamento");
const { textoMenu, buscarSetor, PRECO_DECLARACAO, PRECO_RECIBO, PRECO_CONTRATO, temDadosMinimos, aplicarDefaults } = require("./setores");
const { linhaContato, nomeSuporte } = require("./contato");

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

// MODO_TESTE=true → pula o PIX e entrega o documento imediatamente.
// Use apenas para testes. Desative em producao apos os testes.
const MODO_TESTE = process.env.MODO_TESTE === "true";

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
console.log(`[CONFIG] NOME_SUPORTE: ${nomeSuporte()}`);
console.log(`[CONFIG] EMAIL_EMPRESA: ${process.env.EMAIL_EMPRESA || "NAO DEFINIDO"}`);
console.log(`[CONFIG] PRECOS: Declaracao=R$${PRECO_DECLARACAO} | Recibo=R$${PRECO_RECIBO} | Contrato=R$${PRECO_CONTRATO}`);
if (MODO_TESTE) {
  console.warn("⚠️  [MODO_TESTE] ATIVO — pagamentos desativados, documentos entregues na hora!");
}

// ─── ESTADO DAS SESSOES ───────────────────────────────────────
// Identificadas por "canal:userId" para nao colidirem entre canais.
const sessoes = new Map();
const MAX_SESSOES = 5000;
const TTL_SESSAO_MS = 2 * 60 * 60 * 1000;
const TTL_ENTREGA_MS = 12 * 60 * 60 * 1000;

// Map separado para persistir contexto pos-entrega por ate 12h.
// Sobrevive a expiracao de sessao — permite que o cliente retorne
// e ainda encontre o estado pos_entrega ativo.
const entregasRecentes = new Map();

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
    // Verifica se ha entrega recente (< 12h) para restaurar pos_entrega
    const entrega = entregasRecentes.get(chave);
    if (entrega && Date.now() - entrega.entregueEm < TTL_ENTREGA_MS) {
      console.log(`[SESSAO] Restaurando pos_entrega para ${chave}`);
      s = {
        estado: "pos_entrega",
        setor: null,
        historico: [],
        dadosEntregues: { tipo: entrega.tipo, dados: entrega.dados },
        entregueEm: entrega.entregueEm,
        historicoRevisao: [],
        atualizadoEm: Date.now(),
      };
    } else {
      // Nova sessao comeca com boas-vindas
      s = { estado: "boas_vindas", setor: null, historico: [], dadosColetados: {}, atualizadoEm: Date.now() };
    }
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
    estado: "menu", setor: null, historico: [], dadosColetados: {}, atualizadoEm: Date.now(),
  });
}

// Limpa sessoes inativas a cada 15min
setInterval(() => {
  const limite = Date.now() - TTL_SESSAO_MS;
  for (const [chave, s] of sessoes.entries()) {
    if ((s.atualizadoEm || 0) < limite) sessoes.delete(chave);
  }
}, 15 * 60 * 1000);

// Limpa entregasRecentes expiradas a cada 30min
setInterval(() => {
  const limite = Date.now() - TTL_ENTREGA_MS;
  for (const [chave, e] of entregasRecentes.entries()) {
    if (e.entregueEm < limite) entregasRecentes.delete(chave);
  }
}, 30 * 60 * 1000);

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

// ─── FILA DE PROCESSAMENTO POR SESSAO ─────────────────────────
// Garante que mensagens do mesmo usuario sejam processadas em serie.
// Sem isso, mensagens enviadas em rapida sucessao correm em paralelo,
// corrompem o historico e fazem o bot repetir perguntas.
const filasSessao = new Map();

// ─── DEBOUNCE DE MENSAGENS ────────────────────────────────────
// Agrupa mensagens consecutivas do mesmo usuario em uma unica chamada
// Gemini. Evita 3-4 calls paralelas quando o cliente manda "Nome\nCPF\nRG"
// em mensagens separadas dentro de poucos segundos.
const bufferMensagens = new Map();
const DEBOUNCE_MS = 3500;

function enfileirarMensagem(userId, texto, canal) {
  const chave = chaveSessao(canal, userId);
  let buffer = bufferMensagens.get(chave);

  if (buffer) {
    buffer.textos.push(texto);
    clearTimeout(buffer.timer);
  } else {
    buffer = { textos: [texto], canal, userId };
    bufferMensagens.set(chave, buffer);
  }

  buffer.timer = setTimeout(() => flushBuffer(chave), DEBOUNCE_MS);
}

function flushBuffer(chave) {
  const buffer = bufferMensagens.get(chave);
  if (!buffer) return;
  bufferMensagens.delete(chave);

  const { userId, canal, textos } = buffer;
  const textoCombinado = textos.join("\n");
  if (textos.length > 1) {
    console.log(`[DEBOUNCE] ${canal.nome}:${userId} agrupou ${textos.length} mensagens`);
  }

  const ultimo = filasSessao.get(chave) || Promise.resolve();
  const proximo = ultimo
    .catch(() => {}) // erro na msg anterior nao trava a fila
    .then(() => processarComTimeout(userId, textoCombinado, canal));
  filasSessao.set(chave, proximo);
  proximo.finally(() => {
    if (filasSessao.get(chave) === proximo) filasSessao.delete(chave);
  });
}

// ─── REGISTRO DOS WEBHOOKS DOS CANAIS ─────────────────────────
messenger.registrarWebhook(app, enfileirarMensagem);
if (whatsapp.ativo()) {
  whatsapp.registrarWebhook(app, enfileirarMensagem);
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

  const timer5min = setTimeout(() => {
    if (!estado.concluido) {
      estado.fallback60Enviado = true;
      console.warn(`[TIMEOUT] 5min sem resposta para ${canal.nome}:${userId}`);
      canal.enviarTexto(
        userId,
        "Desculpe a demora! Estamos com uma instabilidade no momento.\n\n" + linhaContato()
      ).catch(() => {});
    }
  }, 5 * 60 * 1000);

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
    clearTimeout(timer5min);
  }
}

// ─── SAUDACAO BASEADA NO HORARIO (fuso: America/Sao_Paulo) ────
function saudacao() {
  const hora = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "numeric",
    hour12: false,
  });
  const h = parseInt(hora, 10);
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

// ─── FLUXO PRINCIPAL POR MENSAGEM ─────────────────────────────
async function processarMensagem(userId, texto, canal) {
  const sessao = getSessao(canal, userId);

  // ── Estado: primeira mensagem — envia boas-vindas + menu ────
  if (sessao.estado === "boas_vindas") {
    sessao.estado = "menu";
    await canal.enviarTexto(
      userId,
      `${saudacao()}! Bem-vindo ao Crie seu Contrato!!!`
    );
    await new Promise((r) => setTimeout(r, 500));
    await canal.enviarTexto(userId, textoMenu());
    return;
  }

  // ── Estado: aguardando aceite LGPD → inicia atendimento com Gemini ─
  // (qualquer mensagem neste estado e tratada como aceite)
  if (sessao.estado === "lgpd_aguardando") {
    console.log(`[LGPD] Aceite registrado: ${canal.nome}:${userId} em ${new Date().toISOString()}`);
    sessao.estado = "atendimento";

    // Mensagem de boas-vindas exclusiva para o setor de suporte
    if (sessao.setor && sessao.setor.tipo === "suporte") {
      sessao.tentativasSuporte = 0;
      await canal.enviarTexto(
        userId,
        "Ola! Estou aqui para te ajudar \uD83D\uDE0A\nMe conta o que esta acontecendo que eu ja verifico para voce!"
      );
    }

    const promptEfetivo = sessao.setor.prompt + complementoPromptEstado(sessao.dadosColetados, sessao.setor);
    let respostaIA = await chamarGemini(sessao.historico, promptEfetivo);
    const progresso = extrairProgresso(respostaIA);
    if (progresso.dados) {
      sessao.dadosColetados = { ...sessao.dadosColetados, ...progresso.dados };
    }
    respostaIA = progresso.respostaLimpa;
    sessao.historico.push({ role: "model", parts: [{ text: respostaIA }] });
    await canal.enviarTexto(userId, respostaIA);
    return;
  }

  // ── Estado: pos-entrega — janela de 24h para correcoes ────────
  // O cliente pode enviar ate 4 mensagens descrevendo o problema.
  // Gemini acumula todo o contexto antes de decidir a correcao.
  // A sessao SO e resetada quando o problema for resolvido (ou encerrado).
  if (sessao.estado === "pos_entrega") {
    if (Date.now() - (sessao.entregueEm || 0) > TTL_ENTREGA_MS) {
      entregasRecentes.delete(chaveSessao(canal, userId));
      resetarSessao(canal, userId);
      await canal.enviarTexto(
        userId,
        "O prazo de 12 horas para solicitar correcoes ja encerrou. " +
        "Para qualquer outra ajuda, entre em contato com nossa equipe:\n\n" +
        linhaContato()
      );
      return;
    }

    // Acumula mensagens do cliente para ter contexto completo na revisao
    const MAX_MSGS_REVISAO = 4;
    if (!sessao.historicoRevisao) sessao.historicoRevisao = [];
    sessao.historicoRevisao.push(String(texto).slice(0, 500));

    if (sessao.historicoRevisao.length > MAX_MSGS_REVISAO) {
      resetarSessao(canal, userId);
      await enviarContatoPedro(userId, canal);
      return;
    }

    const entrega = sessao.dadosEntregues;
    const contextoCompleto = sessao.historicoRevisao.join("\n---\n");

    // revisarDocumento retorna true se o problema foi resolvido (reset sessao)
    const resolvido = await revisarDocumento(userId, contextoCompleto, entrega, canal);
    if (resolvido) resetarSessao(canal, userId);
    return;
  }

  if (sessao.estado === "menu") {
    const setor = buscarSetor(texto.trim());
    if (!setor) {
      await canal.enviarTexto(userId, textoMenu());
      return;
    }
    // Salva setor e solicita aceite LGPD antes de coletar dados
    sessao.setor = setor;
    sessao.historico = [];
    sessao.dadosColetados = {};
    sessao.estado = "lgpd_aguardando";
    console.log(`[TRIAGEM] ${canal.nome}:${userId} escolheu setor: ${setor.nome}`);

    const msgLgpd =
      "Para gerarmos seu documento, precisamos coletar alguns dados pessoais. " +
      "Ao continuar, voce declara estar de acordo com nossos Termos de Uso e autoriza " +
      "o tratamento dos dados apenas para esta finalidade. " +
      "Seus dados e o PDF serao excluidos permanentemente em 30 dias.";

    if (typeof canal.enviarQuickReply === "function") {
      await canal.enviarQuickReply(userId, msgLgpd, [
        { titulo: "Aceito e Continuar", payload: "LGPD_ACEITO" },
      ]);
    } else {
      await canal.enviarTexto(userId, msgLgpd + '\n\nDigite "aceito" para continuar.');
    }
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
      const promptEfetivo = sessao.setor.prompt + complementoPromptEstado(sessao.dadosColetados, sessao.setor);
      respostaIA = await chamarGemini(sessao.historico, promptEfetivo);
    } catch (err) {
      console.error("Erro Gemini:", err.message);
      sessao.historico.pop();

      // ── Fallback: Gemini indisponivel mas temos os dados minimos ──
      // Quando Gemini cai no final do fluxo (apos cliente fornecer tudo),
      // geramos o documento direto com os dados ja coletados via [PROGRESSO].
      const setorAtual = sessao.setor;
      if (
        setorAtual && setorAtual.tipo !== "suporte" &&
        temDadosMinimos(setorAtual.tipo, sessao.dadosColetados)
      ) {
        console.warn(
          `[FALLBACK] Gemini indisponivel — gerando ${setorAtual.tipo} com dados coletados para ${canal.nome}:${userId}`
        );
        const dadosFallback = aplicarDefaults(setorAtual.tipo, sessao.dadosColetados);
        resetarSessao(canal, userId);

        if (MODO_TESTE) {
          await canal.enviarTexto(
            userId,
            "Estamos com uma instabilidade no atendimento, mas ja tenho todos os seus dados. " +
            "Vou gerar seu documento agora mesmo!"
          );
          await entregarDocumento({
            userId, canalNome: canal.nome,
            tipo: setorAtual.tipo, dados: dadosFallback,
          });
        } else {
          await canal.enviarTexto(
            userId,
            "Estamos com uma instabilidade no atendimento, mas ja tenho todos os seus dados. " +
            "Vou gerar o PIX para finalizar!"
          );
          await processarPagamento(userId, setorAtual, dadosFallback, canal);
        }
        return;
      }

      // Sem dados suficientes — pede para o cliente repetir
      await canal.enviarTexto(
        userId,
        "Desculpe, tive uma instabilidade agora. Pode repetir sua ultima mensagem?"
      );
      return;
    }

    // Extrai [PROGRESSO:{...}] do Gemini e acumula no state tracker.
    // Remove o marcador da resposta antes de enviar ao cliente.
    const progresso = extrairProgresso(respostaIA);
    if (progresso.dados) {
      sessao.dadosColetados = { ...sessao.dadosColetados, ...progresso.dados };
      console.log(`[PROGRESSO] ${canal.nome}:${userId} — ${Object.keys(progresso.dados).join(", ")}`);
    }
    respostaIA = progresso.respostaLimpa;

    // Suporte: verifica se Gemini quer encaminhar para suporte humano
    if (respostaIA.includes("[ENCAMINHAR_PEDRO]")) {
      const msgCliente = respostaIA.replace(/\[ENCAMINHAR_PEDRO\]/g, "").trim();
      const historicoTexto = sessao.historico
        .filter(m => m.role === "user")
        .map(m => m.parts[0].text);
      resetarSessao(canal, userId);
      if (msgCliente) await canal.enviarTexto(userId, msgCliente);
      await enviarContatoPedro(userId, canal);
      return;
    }

    const marcacao = extrairMarcacao(respostaIA);

    if (marcacao) {
      console.log(`Marcacao detectada: tipo=${marcacao.tipo}`);
      const setorAtual = sessao.setor;
      resetarSessao(canal, userId);

      if (MODO_TESTE) {
        // Modo teste: pula o PIX e entrega direto
        console.warn(`[MODO_TESTE] Entrega direta sem pagamento: tipo=${marcacao.tipo} ${canal.nome}:${userId}`);
        await canal.enviarTexto(userId, "🧪 Modo de teste ativo — entregando seu documento sem cobrança...");
        await entregarDocumento({
          userId,
          canalNome: canal.nome,
          tipo: setorAtual.tipo,
          dados: marcacao.dados,
        });
      } else {
        await processarPagamento(userId, setorAtual, marcacao.dados, canal);
      }
      return;
    }

    sessao.historico.push({ role: "model", parts: [{ text: respostaIA }] });
    await canal.enviarTexto(userId, respostaIA);

    // Suporte: escalacao automatica apos 3 rodadas sem resolucao
    if (sessao.setor && sessao.setor.tipo === "suporte") {
      sessao.tentativasSuporte = (sessao.tentativasSuporte || 0) + 1;
      if (sessao.tentativasSuporte >= 3) {
        const suporte = nomeSuporte();
        console.log(`[SUPORTE] 3 tentativas sem resolucao — escalando para ${suporte}: ${canal.nome}:${userId}`);
        const historicoTexto = sessao.historico
          .filter(m => m.role === "user")
          .map(m => m.parts[0].text);
        resetarSessao(canal, userId);
        await canal.enviarTexto(
          userId,
          `Percebi que nao consegui resolver seu problema por aqui. ` +
          `Vou acionar nosso atendimento humano para te ajudar com isso!`
        );
        await enviarContatoPedro(userId, canal);
      }
    }
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
      "Salve o PDF agora — ele fica disponivel por 30 dias.\n\n" +
      "Encontrou algo errado? Voce tem ate 12 horas para solicitar uma correcao gratuita. " +
      "E so me dizer aqui o que precisa ajustar!"
    );
    // Ativa estado pos_entrega para capturar feedback do cliente
    const sessao = getSessao(canal, pedido.userId);
    sessao.estado = "pos_entrega";
    sessao.dadosEntregues = { tipo: pedido.tipo, dados: pedido.dados };
    sessao.entregueEm = Date.now();
    sessao.historicoRevisao = [];
    // Persiste contexto por 12h (sobrevive expiracao de sessao de 2h)
    entregasRecentes.set(chaveSessao(canal, pedido.userId), {
      tipo: pedido.tipo,
      dados: pedido.dados,
      entregueEm: sessao.entregueEm,
    });
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
// Retorna true quando o problema foi resolvido (sessao pode ser resetada).
// Retorna false quando a sessao deve permanecer em pos_entrega (ex: SEM_ERRO
// mas cliente ainda pode detalhar melhor o que precisa corrigir).
//
// Gemini analisa TODOS os dados originais + TODAS as mensagens do cliente:
//   [SEM_ERRO]          → pergunta se ha mais detalhes; sessao permanece aberta
//   [CORRECAO:{...}]    → regenera PDF com dados corrigidos e entrega → true
//   [ERRO_MANUAL]       → encaminha para Pedro → true
async function revisarDocumento(userId, reclamacao, entrega, canal) {
  console.log(`[REVISAO] Iniciando: tipo=${entrega.tipo} ${canal.nome}:${userId}`);

  const promptRevisao =
    `Voce e um revisor de documentos da Crie Seu Contrato.\n` +
    `Um cliente recebeu um documento e esta solicitando uma correcao. Seu objetivo e SEMPRE tentar corrigir automaticamente.\n\n` +
    `DADOS ORIGINAIS DO DOCUMENTO (tipo: ${entrega.tipo}):\n${JSON.stringify(entrega.dados, null, 2)}\n\n` +
    `MENSAGENS DO CLIENTE (em ordem cronologica):\n"${String(reclamacao).slice(0, 2000)}"\n\n` +
    `REGRAS FUNDAMENTAIS:\n` +
    `- NUNCA use [ERRO_MANUAL] apenas porque o cliente nao forneceu o valor correto ainda.\n` +
    `- Quando o cliente diz que algo esta errado mas nao informa o valor correto → use [SEM_ERRO] para PERGUNTAR.\n` +
    `- Quando o cliente ja forneceu o valor correto (mesmo que separado em outra mensagem) → use [CORRECAO].\n` +
    `- [ERRO_MANUAL] e reservado APENAS para casos que voce genuinamente nao pode resolver: pedido de reembolso, ` +
    `troca de tipo de documento, problema tecnico de pagamento, etc.\n\n` +
    `ESCOLHA EXATAMENTE UMA das tres opcoes abaixo:\n\n` +
    `OPCAO A — Use quando precisar de mais informacoes do cliente para fazer a correcao:\n` +
    `Exemplo: cliente disse "o CPF esta errado" mas nao informou o correto → pergunte qual e o CPF correto.\n` +
    `[SEM_ERRO]\n` +
    `<pergunta direta e empatica ao cliente — peca exatamente a informacao que falta para corrigir>\n\n` +
    `OPCAO B — Use quando JA TEM todos os dados necessarios para corrigir (inclusive vindos das mensagens do cliente):\n` +
    `Exemplo: cliente disse "o CPF deve ser 123.456.789-00" → corrija o campo e regenere.\n` +
    `[CORRECAO:{"tipo":"${entrega.tipo}","dados":{...JSON COMPLETO com TODOS os campos, corrigindo apenas o necessario...}}]\n` +
    `<mensagem breve e empatica confirmando o que foi corrigido>\n` +
    `IMPORTANTE: inclua TODOS os campos do JSON original. Corrija APENAS o campo mencionado pelo cliente.\n\n` +
    `OPCAO C — Use SOMENTE para problemas que voce genuinamente nao pode resolver automaticamente:\n` +
    `(pedido de reembolso, troca de tipo de documento, cobranca duplicada, problema tecnico grave)\n` +
    `[ERRO_MANUAL]\n` +
    `<descricao interna breve — nao exiba ao cliente>\n\n` +
    `Seja humano, breve e nunca exponha dados tecnicos ao cliente.`;

  try {
    const resposta = await chamarGemini(
      [{ role: "user", parts: [{ text: promptRevisao }] }],
      "Voce e um revisor tecnico de documentos. Siga rigorosamente o formato de resposta solicitado."
    );

    // ── Caso A: sem erro — sessao permanece aberta ─────────────
    if (resposta.includes("[SEM_ERRO]")) {
      const explicacao = resposta.replace(/\[SEM_ERRO\]/g, "").trim();
      console.log(`[REVISAO] Sem erros detectados (aguardando mais detalhes): ${canal.nome}:${userId}`);
      await canal.enviarTexto(userId, explicacao);
      return false; // sessao permanece em pos_entrega
    }

    // ── Caso B: correcao automatica ───────────────────────────
    if (resposta.includes("[CORRECAO:")) {
      const dadosCorrigidos = extrairCorrecao(resposta);
      const msgCliente = resposta.replace(/\[CORRECAO:[^\]]*\]/s, "").trim();

      if (!dadosCorrigidos) {
        console.error("[REVISAO] Falha ao parsear JSON de correcao — encaminhando para suporte");
        await enviarContatoPedro(userId, canal);
        return true;
      }

      console.log(`[REVISAO] Corrigindo automaticamente: tipo=${dadosCorrigidos.tipo} ${canal.nome}:${userId}`);
      await canal.enviarTexto(userId, "Encontrei o problema! Estou gerando uma versao corrigida para voce...");

      try {
        const resultado = await gerarDocumento(dadosCorrigidos.tipo, dadosCorrigidos.dados);

        if (!resultado.sucesso) throw new Error("gerarDocumento retornou sucesso=false");

        const enviouDoc = await canal.enviarArquivo(userId, resultado.caminho, resultado.nomeArquivo);

        if (enviouDoc) {
          await canal.enviarTexto(
            userId,
            (msgCliente || "Documento corrigido e reenviado!") +
            "\n\nQualquer outra duvida, e so chamar!"
          );
          console.log(`[REVISAO] Documento corrigido entregue: ${canal.nome}:${userId}`);
        } else {
          throw new Error("Falha no envio do arquivo corrigido");
        }
      } catch (errGeracao) {
        console.error(`[REVISAO] Falha na geracao/envio do doc corrigido: ${errGeracao.message}`);
        await enviarContatoPedro(userId, canal);
      }
      return true;
    }

    // ── Caso C: erro manual ───────────────────────────────────
    const motivo = resposta.replace(/\[ERRO_MANUAL\]/g, "").trim();
    console.warn(`[REVISAO] Erro manual: ${canal.nome}:${userId} — ${motivo}`);
    await enviarContatoPedro(userId, canal);
    return true;

  } catch (err) {
    console.error("[REVISAO] Erro ao chamar Gemini:", err.message);
    await enviarContatoPedro(userId, canal);
    return true;
  }
}

// Extrai e valida o JSON de correcao da resposta do Gemini
// Formato esperado: [CORRECAO:{"tipo":"...","dados":{...}}]
function extrairCorrecao(resposta) {
  const idx = resposta.indexOf("[CORRECAO:");
  if (idx === -1) return null;
  const inicio = resposta.indexOf("{", idx);
  if (inicio === -1) return null;
  let nivel = 0, fim = -1;
  for (let i = inicio; i < resposta.length; i++) {
    if (resposta[i] === "{") nivel++;
    else if (resposta[i] === "}") { nivel--; if (nivel === 0) { fim = i; break; } }
  }
  if (fim === -1) return null;
  try {
    const obj = JSON.parse(resposta.slice(inicio, fim + 1));
    if (!obj.tipo || !obj.dados) return null;
    return obj;
  } catch (e) {
    console.error("[REVISAO] JSON de correcao invalido:", e.message);
    return null;
  }
}

// Envia contato do suporte humano ao cliente (WhatsApp + email se configurado).
async function enviarContatoPedro(userId, canal) {
  await canal.enviarTexto(
    userId,
    `Vou acionar nosso atendimento humano para te ajudar — sem nenhum custo adicional!\n\n` +
    linhaContato()
  );
}

// ─── DETECTA [DADOS_COMPLETOS:{...}] ──────────────────────────
// Extrai [PROGRESSO:{...}] emitido pelo Gemini a cada turno.
// Retorna { dados, respostaLimpa } — respostaLimpa sem o marcador.
function extrairProgresso(texto) {
  if (!texto) return { dados: null, respostaLimpa: texto };
  const idx = texto.indexOf("[PROGRESSO:");
  if (idx === -1) return { dados: null, respostaLimpa: texto };
  const inicio = texto.indexOf("{", idx);
  if (inicio === -1) return { dados: null, respostaLimpa: texto };
  let nivel = 0, fim = -1;
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === "{") nivel++;
    else if (texto[i] === "}") { nivel--; if (nivel === 0) { fim = i; break; } }
  }
  if (fim === -1) return { dados: null, respostaLimpa: texto };
  // Avanca ate o `]` final da marcacao
  let finalMarcador = fim + 1;
  while (finalMarcador < texto.length && texto[finalMarcador] !== "]") finalMarcador++;
  if (texto[finalMarcador] === "]") finalMarcador++;
  try {
    const obj = JSON.parse(texto.slice(inicio, fim + 1));
    const respostaLimpa = (texto.slice(0, idx) + texto.slice(finalMarcador)).trim();
    return { dados: obj, respostaLimpa };
  } catch (e) {
    console.error("[PROGRESSO] JSON invalido:", e.message);
    return { dados: null, respostaLimpa: texto };
  }
}

// Monta instrucao suplementar para o prompt — injeta dados ja coletados
// e pede que o Gemini emita [PROGRESSO:{...}] a cada novo dado recebido.
function complementoPromptEstado(dadosColetados, setor) {
  if (!setor || setor.tipo === "suporte") return "";
  let sufixo = "";
  if (dadosColetados && Object.keys(dadosColetados).length > 0) {
    sufixo += `\n\n---\nDADOS JA COLETADOS NESTA CONVERSA (nao pergunte de novo, nao duvide):\n${JSON.stringify(dadosColetados, null, 2)}`;
  }
  sufixo += `\n\n---\nINSTRUCAO INTERNA (nao repassar ao cliente):
Sempre que o cliente fornecer dados nesta mensagem, inclua ao FINAL da sua resposta uma linha [PROGRESSO:{...}] com os campos novos. Isso sera removido antes de chegar ao cliente.

Exemplo real: se o cliente disse "Maria Silva" quando voce perguntou o nome do locador, emita:
[PROGRESSO:{"locador_nome":"Maria Silva"}]

Outro exemplo: se o cliente mandou nome e CPF juntos, emita:
[PROGRESSO:{"locador_nome":"Maria Silva","locador_cpf":"12345678900"}]

REGRAS:
- Use os nomes EXATOS dos campos da marcacao [DADOS_COMPLETOS] acima (locador_nome, locador_nacionalidade, locatario_rg, imovel_endereco, valor_aluguel, etc.)
- NUNCA use a palavra literal "campo" ou "valor" — use sempre o nome real do campo
- Inclua somente os campos NOVOS fornecidos nesta mensagem (nao repita os ja coletados)
- Se o cliente nao forneceu nenhum dado novo, nao emita a linha [PROGRESSO]`;
  return sufixo;
}

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

// ─── RASTREAMENTO DE USO DO GEMINI ────────────────────────────
// Preco Gemini 2.5 Flash (USD por 1M tokens)
const GEMINI_PRECO_ENTRADA = 0.075;  // input
const GEMINI_PRECO_SAIDA   = 0.300;  // output
const GEMINI_USO_PATH = path.join(__dirname, "relatorios", "gemini_uso.json");

// Acumulador em memoria — atualizado de forma sincrona (sem I/O no caminho critico).
// Carregado do disco na inicializacao e persistido de forma assincrona a cada 30s.
let geminiUso = {
  total_chamadas: 0, total_tokens_entrada: 0, total_tokens_saida: 0,
  custo_estimado_usd: 0, por_dia: {},
};
let geminiUsoSujo = false;

fs.promises.readFile(GEMINI_USO_PATH, "utf8")
  .then((conteudo) => {
    try {
      const dados = JSON.parse(conteudo);
      if (dados && typeof dados === "object") geminiUso = dados;
    } catch (_) {}
  })
  .catch(() => {}); // arquivo pode nao existir na primeira execucao

function registrarUsoGemini(inputTokens, outputTokens) {
  const hoje = new Date().toISOString().slice(0, 10);
  const custoUsd =
    (inputTokens  / 1_000_000) * GEMINI_PRECO_ENTRADA +
    (outputTokens / 1_000_000) * GEMINI_PRECO_SAIDA;

  geminiUso.total_chamadas++;
  geminiUso.total_tokens_entrada += inputTokens;
  geminiUso.total_tokens_saida   += outputTokens;
  geminiUso.custo_estimado_usd    = parseFloat((geminiUso.custo_estimado_usd + custoUsd).toFixed(6));

  if (!geminiUso.por_dia[hoje])
    geminiUso.por_dia[hoje] = { chamadas: 0, tokens_entrada: 0, tokens_saida: 0, custo_usd: 0 };
  geminiUso.por_dia[hoje].chamadas++;
  geminiUso.por_dia[hoje].tokens_entrada += inputTokens;
  geminiUso.por_dia[hoje].tokens_saida   += outputTokens;
  geminiUso.por_dia[hoje].custo_usd       = parseFloat((geminiUso.por_dia[hoje].custo_usd + custoUsd).toFixed(6));

  geminiUsoSujo = true;
}

// Persiste em disco de forma assincrona — sem bloquear o event loop.
async function flushGeminiUso() {
  if (!geminiUsoSujo) return;
  geminiUsoSujo = false;
  try {
    await fs.promises.mkdir(path.dirname(GEMINI_USO_PATH), { recursive: true });
    await fs.promises.writeFile(GEMINI_USO_PATH, JSON.stringify(geminiUso, null, 2), "utf8");
  } catch (e) {
    geminiUsoSujo = true; // tenta de novo no proximo ciclo
    console.error("[GEMINI] Falha ao persistir uso:", e.message);
  }
}

// Flush a cada 30s e no encerramento do processo
setInterval(flushGeminiUso, 30_000).unref();
process.on("SIGTERM", () => flushGeminiUso().finally(() => process.exit(0)));
process.on("SIGINT",  () => flushGeminiUso().finally(() => process.exit(0)));

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
      { timeout: 30000, httpsAgent: geminiHttpsAgent }
    );

    // Registra consumo de tokens para calculo de custo
    const uso = response.data.usageMetadata;
    if (uso) {
      registrarUsoGemini(uso.promptTokenCount || 0, uso.candidatesTokenCount || 0);
    }

    return response.data.candidates[0].content.parts[0].text.trim();
  } catch (err) {
    const status = err.response && err.response.status;
    const detalhe = err.response && JSON.stringify(err.response.data);
    console.error(`[GEMINI] Erro ${status} | detalhe: ${detalhe}`);
    if ((status === 429 || status === 503) && tentativa <= 5) {
      // Esperas: 5s, 15s, 30s, 60s, 90s — total ~3.3min (cabe no timeout de 5min)
      const esperas = [5000, 15000, 30000, 60000, 90000];
      console.warn(`[GEMINI] Tentativa ${tentativa}/5. Aguardando ${esperas[tentativa - 1] / 1000}s...`);
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

// ─── PAINEL UNIFICADO (painel.html) ───────────────────────────
app.get("/admin/painel", (req, res) => {
  if (!ADMIN_SECRET) return res.status(503).send("ADMIN_SECRET nao configurado");
  if (!compararSeguro(req.query.secret, ADMIN_SECRET)) return res.status(403).send("Acesso negado");
  res.sendFile(path.join(__dirname, "painel.html"));
});

// ─── GERADOR MANUAL DE DOCUMENTOS (gerar.html) ────────────────
app.get("/admin/gerar", (req, res) => {
  if (!ADMIN_SECRET) return res.status(503).send("ADMIN_SECRET nao configurado");
  if (!compararSeguro(req.query.secret, ADMIN_SECRET)) return res.status(403).send("Acesso negado");
  res.sendFile(path.join(__dirname, "gerar.html"));
});

// ─── ROTINA DE LIMPEZA (30 DIAS) ──────────────────────────────
limpeza.iniciarAgendamento();

// ─── ROTA DE SAUDE ────────────────────────────────────────────
app.get("/", (_req, res) => res.send(
  `chatleads ativo | modelo: ${GEMINI_MODEL}` +
  (MODO_TESTE ? " | ⚠️ MODO TESTE — sem cobrança" : "")
));

// ─── INICIA SERVIDOR ──────────────────────────────────────────
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
