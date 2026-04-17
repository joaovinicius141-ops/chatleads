// ============================================================
// index.js
// Servidor Express — webhook do Messenger + Gemini + PIX + PDF
// ============================================================

require("dotenv").config();

const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const { INSTRUCOES } = require("./prompt");
const { gerarDocumento } = require("./gerador");
const { criarCobrancaPix, verificarPagamento, PRECOS } = require("./pagamento");

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "meu_token_secreto";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// Serve os PDFs gerados publicamente
app.use("/arquivos", express.static(path.join(__dirname, "documentos_gerados")));

// ─── ARMAZENAMENTO EM MEMORIA ─────────────────────────────────
// Historico de conversa por usuario
const conversas = {};

// Pagamentos aguardando confirmacao:
// paymentId -> { psid, tipo, dados, timestamp }
const pagamentosPendentes = new Map();

// Limpa pagamentos com mais de 35 minutos (expirados)
setInterval(() => {
  const limite = Date.now() - 35 * 60 * 1000;
  for (const [id, p] of pagamentosPendentes.entries()) {
    if (p.timestamp < limite) {
      pagamentosPendentes.delete(id);
      console.log(`[PAGAMENTO] Expirado e removido: id=${id}`);
    }
  }
}, 5 * 60 * 1000); // roda a cada 5 minutos

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

      processarMensagem(psid, texto).catch((err) => {
        console.error("Erro ao processar mensagem:", err.message);
      });
    }
  }
});

// ─── WEBHOOK DO MERCADO PAGO ──────────────────────────────────
// O Mercado Pago avisa aqui quando um pagamento muda de status.
app.post("/pagamento/webhook", async (req, res) => {
  // Responde 200 imediatamente para o MP nao reenviar
  res.sendStatus(200);

  try {
    const { action, data } = req.body;
    if (!data || !data.id) return;

    // So processa eventos de pagamento aprovado
    if (action !== "payment.updated" && action !== "payment.created") return;

    const paymentId = String(data.id);
    console.log(`[PAGAMENTO] Webhook recebido: id=${paymentId} action=${action}`);

    // Verifica o status real com o Mercado Pago
    const { pago, status } = await verificarPagamento(paymentId);
    console.log(`[PAGAMENTO] Status: ${status} | pago=${pago}`);

    if (!pago) return; // ainda nao aprovado, aguarda proximo webhook

    // Busca o pedido pendente
    const pedido = pagamentosPendentes.get(paymentId);
    if (!pedido) {
      console.warn(`[PAGAMENTO] Pagamento aprovado mas pedido nao encontrado: id=${paymentId}`);
      return;
    }

    // Remove da fila para nao processar duas vezes
    pagamentosPendentes.delete(paymentId);

    console.log(`[PAGAMENTO] Aprovado! Gerando documento tipo=${pedido.tipo} para psid=${pedido.psid}`);

    // Contrato: sem PDF, entrega manual
    if (pedido.tipo === "contrato") {
      await gerarDocumento("contrato", pedido.dados);
      await enviarTexto(
        pedido.psid,
        "Pagamento confirmado! Recebemos seu pedido de contrato. " +
        "Nossa equipe prepara e entrega em ate 24h. " +
        "Fale com o Pedro pelo WhatsApp: (00) 00000-0000"
      );
      return;
    }

    // Recibo / Declaracao: gera PDF e envia
    const resultado = await gerarDocumento(pedido.tipo, pedido.dados);

    if (!resultado.sucesso) {
      await enviarTexto(
        pedido.psid,
        "Pagamento recebido! Mas tive um problema para gerar o documento. " +
        "Fale com o Pedro no WhatsApp: (00) 00000-0000 e ele resolve na hora."
      );
      return;
    }

    const enviou = await enviarArquivo(pedido.psid, resultado.caminho, resultado.nomeArquivo);
    if (enviou) {
      await enviarTexto(
        pedido.psid,
        "Pagamento confirmado e documento gerado! Salva o arquivo aqui. Qualquer duvida e so chamar!"
      );
    } else {
      await enviarTexto(
        pedido.psid,
        "Pagamento recebido! Tive um problema para enviar o arquivo aqui. " +
        "Fale com o Pedro no WhatsApp: (00) 00000-0000 e ele envia manualmente."
      );
    }
  } catch (erro) {
    console.error("[PAGAMENTO] Erro no webhook:", erro.message);
  }
});

// ─── FLUXO PRINCIPAL POR MENSAGEM ─────────────────────────────
async function processarMensagem(psid, mensagem) {
  if (!conversas[psid]) conversas[psid] = [];

  conversas[psid].push({ role: "user", parts: [{ text: mensagem }] });

  if (conversas[psid].length > 20) {
    conversas[psid] = conversas[psid].slice(-20);
  }

  let respostaIA = "";
  try {
    respostaIA = await chamarGemini(conversas[psid]);
  } catch (err) {
    console.error("Erro Gemini:", err.message);
    await enviarTexto(psid, "Desculpe, tive um problema para responder. Pode tentar de novo?");
    return;
  }

  // Detecta marcacao [DADOS_COMPLETOS:{...}]
  const marcacao = extrairMarcacao(respostaIA);

  if (marcacao) {
    console.log(`Marcacao detectada: tipo=${marcacao.tipo}`);
    conversas[psid].push({ role: "model", parts: [{ text: "[DADOS_COMPLETOS]" }] });
    delete conversas[psid]; // limpa historico apos coletar dados

    await processarPagamento(psid, marcacao.tipo, marcacao.dados);
    return;
  }

  // Resposta normal
  conversas[psid].push({ role: "model", parts: [{ text: respostaIA }] });
  await enviarTexto(psid, respostaIA);
}

// ─── CRIA COBRANÇA PIX E AGUARDA PAGAMENTO ────────────────────
async function processarPagamento(psid, tipo, dados) {
  // Contrato: avisa sobre entrega manual e ja gera o PIX
  const valor = PRECOS[tipo] || 0;

  // Avisa o cliente que está gerando o PIX
  await enviarTexto(psid, "Perfeito! Gerando o PIX para voce, um segundo...");

  try {
    const cobranca = await criarCobrancaPix(tipo, psid);

    // Guarda o pedido aguardando confirmacao de pagamento
    pagamentosPendentes.set(String(cobranca.id), {
      psid,
      tipo,
      dados,
      timestamp: Date.now(),
    });

    // Envia o codigo PIX copia e cola
    await enviarTexto(
      psid,
      `Para finalizar, faca o PIX de R$ ${valor.toFixed(2).replace(".", ",")}:\n\n` +
      `Codigo PIX (copia e cola):\n${cobranca.codigoPix}\n\n` +
      `Valido por 30 minutos. Assim que o pagamento for confirmado, seu documento chega aqui automaticamente!`
    );

  } catch (erro) {
    console.error("[PAGAMENTO] Erro ao criar cobranca:", erro.message);
    await enviarTexto(
      psid,
      "Tive um problema para gerar o PIX. Por favor, fale com o Pedro no WhatsApp: (00) 00000-0000"
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
    else if (texto[i] === "}") {
      nivel--;
      if (nivel === 0) { fim = i; break; }
    }
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

// ─── CHAMA O GEMINI (com retry em caso de 429) ───────────────
async function chamarGemini(historico, tentativa = 1) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY nao configurada");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const response = await axios.post(
      url,
      {
        system_instruction: { parts: [{ text: INSTRUCOES }] },
        contents: historico,
        generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
      },
      { timeout: 30000 }
    );
    return response.data.candidates[0].content.parts[0].text.trim();
  } catch (err) {
    const status = err.response && err.response.status;
    const detalhe = err.response && JSON.stringify(err.response.data);
    console.error(`[GEMINI] Erro ${status} | modelo: ${GEMINI_MODEL} | detalhe: ${detalhe}`);

    if (status === 429 && tentativa <= 3) {
      const esperas = [15000, 30000, 65000];
      const espera = esperas[tentativa - 1];
      console.warn(`[GEMINI] 429 rate limit. Tentativa ${tentativa}/3. Aguardando ${espera / 1000}s...`);
      await new Promise((r) => setTimeout(r, espera));
      return chamarGemini(historico, tentativa + 1);
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
  if (!PAGE_ACCESS_TOKEN) { console.warn("PAGE_ACCESS_TOKEN nao configurado"); return false; }
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

// ─── ROTA DE SAUDE ────────────────────────────────────────────
app.get("/", (_req, res) => res.send(`chatleads: servidor ativo | modelo: ${GEMINI_MODEL}`));

// ─── INICIA SERVIDOR ──────────────────────────────────────────
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
