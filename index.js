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

const { gerarDocumento } = require("./gerador");
const { criarCobrancaPix, verificarPagamento } = require("./pagamento");
const { textoMenu, buscarSetor } = require("./setores");

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "meu_token_secreto";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

app.use("/arquivos", express.static(path.join(__dirname, "documentos_gerados")));

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
const sessoes = {};

function getSessao(psid) {
  if (!sessoes[psid]) {
    sessoes[psid] = { estado: "menu", setor: null, historico: [] };
  }
  return sessoes[psid];
}

function resetarSessao(psid) {
  sessoes[psid] = { estado: "menu", setor: null, historico: [] };
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
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado com sucesso!");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ─── RECEBE MENSAGENS DO MESSENGER ────────────────────────────
app.post("/webhook", async (req, res) => {
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
      processarMensagem(psid, texto).catch((err) =>
        console.error("Erro ao processar mensagem:", err.message)
      );
    }
  }
});

// ─── WEBHOOK DO MERCADO PAGO ──────────────────────────────────
app.post("/pagamento/webhook", async (req, res) => {
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
    sessao.historico.push({ role: "user", parts: [{ text: texto }] });

    // Limita historico
    if (sessao.historico.length > 20) {
      sessao.historico = sessao.historico.slice(-20);
    }

    let respostaIA = "";
    try {
      respostaIA = await chamarGemini(sessao.historico, sessao.setor.prompt);
    } catch (err) {
      console.error("Erro Gemini:", err.message);
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
      "Tive um problema para gerar o PIX. Fale com o Pedro no WhatsApp: (00) 00000-0000"
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
      "Nossa equipe prepara e entrega em ate 24h.\n" +
      "Fale com o Pedro: (00) 00000-0000"
    );
    return;
  }

  const resultado = await gerarDocumento(pedido.tipo, pedido.dados);

  if (!resultado.sucesso) {
    await enviarTexto(
      pedido.psid,
      "Pagamento recebido! Mas tive um problema ao gerar o documento.\n" +
      "Fale com o Pedro no WhatsApp: (00) 00000-0000"
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
      "Pagamento recebido! Tive um problema para enviar o arquivo.\n" +
      "Fale com o Pedro no WhatsApp: (00) 00000-0000"
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
    if (status === 429 && tentativa <= 3) {
      const esperas = [15000, 30000, 65000];
      console.warn(`[GEMINI] Rate limit. Tentativa ${tentativa}/3. Aguardando ${esperas[tentativa - 1] / 1000}s...`);
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
// Remova esta rota antes de ir para producao real.
app.get("/aprovar-teste/:paymentId", async (req, res) => {
  const { paymentId } = req.params;
  if (req.query.secret !== "chatleads_teste_2026") return res.status(403).send("Acesso negado");

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
