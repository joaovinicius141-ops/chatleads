// ============================================================
// index.js
// Servidor Express — webhook do Messenger + Gemini + gerador de PDFs
// ============================================================

require("dotenv").config();

const express = require("express");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const { INSTRUCOES } = require("./prompt");
const { gerarDocumento } = require("./gerador");

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "meu_token_secreto";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// Serve os PDFs gerados publicamente para o Messenger baixar
app.use("/arquivos", express.static(path.join(__dirname, "documentos_gerados")));

// Historico de conversa em memoria por usuario
const conversas = {};

// ─── VERIFICACAO DO WEBHOOK ───────────────────────────────────
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

  res.sendStatus(200); // responde rapido pro Facebook nao reenviar

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      if (!event.message || event.message.is_echo) continue;

      const senderId = event.sender.id;
      const texto = event.message.text;
      if (!texto) continue;

      console.log(`Mensagem de ${senderId}: ${texto}`);

      processarMensagem(senderId, texto).catch((err) => {
        console.error("Erro ao processar mensagem:", err.message);
      });
    }
  }
});

// ─── FLUXO PRINCIPAL POR MENSAGEM ────────────────────────────
async function processarMensagem(userId, mensagem) {
  if (!conversas[userId]) conversas[userId] = [];

  conversas[userId].push({ role: "user", parts: [{ text: mensagem }] });

  // Limita historico a 20 turnos para nao explodir o contexto
  if (conversas[userId].length > 20) {
    conversas[userId] = conversas[userId].slice(-20);
  }

  let respostaIA = "";
  try {
    respostaIA = await chamarGemini(conversas[userId]);
  } catch (err) {
    console.error("Erro Gemini:", err.message);
    await enviarTexto(userId, "Desculpe, tive um problema para responder. Pode tentar de novo?");
    return;
  }

  // Detecta marcacao [DADOS_COMPLETOS:{...}]
  const marcacao = extrairMarcacao(respostaIA);

  if (marcacao) {
    console.log(`Marcacao detectada: tipo=${marcacao.tipo}`);
    conversas[userId].push({ role: "model", parts: [{ text: "[DADOS_COMPLETOS]" }] });

    // Contrato: sem PDF, apenas salva JSON
    if (marcacao.tipo === "contrato") {
      await gerarDocumento("contrato", marcacao.dados);
      await enviarTexto(
        userId,
        "Otimo! Recebi todas as informacoes. O contrato sera preparado e entregue aqui mesmo no Messenger em ate 24 horas.\n" +
        "Para confirmar seu pedido e efetuar o pagamento de R$ 50, entre em contato com o administrador Pedro:\n" +
        "WhatsApp: (00) 00000-0000"
      );
      delete conversas[userId];
      return;
    }

    // Recibo e Declaracao: gera PDF e envia
    const resultado = await gerarDocumento(marcacao.tipo, marcacao.dados);

    if (!resultado.sucesso) {
      await enviarTexto(userId, "Ops, tive um problema para gerar seu documento. Tente novamente em instantes.");
      delete conversas[userId];
      return;
    }

    const enviou = await enviarArquivo(userId, resultado.caminho, resultado.nomeArquivo);

    if (enviou) {
      await enviarTexto(userId, "Documento gerado! Salva o arquivo aqui. Qualquer duvida e so chamar!");
    } else {
      await enviarTexto(
        userId,
        "Gerei seu documento mas nao consegui enviar aqui. Fale com o Pedro no WhatsApp: (00) 00000-0000"
      );
    }

    delete conversas[userId];
    return;
  }

  // Resposta normal
  conversas[userId].push({ role: "model", parts: [{ text: respostaIA }] });
  await enviarTexto(userId, respostaIA);
}

// ─── DETECTA [DADOS_COMPLETOS:{...}] ─────────────────────────
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

// ─── CHAMA O GEMINI (com retry automatico em caso de 429) ────
async function chamarGemini(historico, tentativa = 1) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY nao configurada");

  const url = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

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

    // 429 = rate limit: aguarda e tenta de novo (ate 3x)
    // O Google reseta o limite a cada 60s, entao espera generosa
    if (status === 429 && tentativa <= 3) {
      const esperas = [15000, 30000, 65000]; // 15s, 30s, 65s
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

// ─── ENVIA ARQUIVO PDF PELO MESSENGER ────────────────────────
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

// ─── ROTA DE SAUDE ───────────────────────────────────────────
app.get("/", (_req, res) => res.send(`chatleads: servidor ativo | modelo: ${GEMINI_MODEL}`));

// ─── INICIA SERVIDOR ─────────────────────────────────────────
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
