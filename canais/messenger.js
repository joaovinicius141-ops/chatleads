// ============================================================
// canais/messenger.js
// Implementacao do canal Facebook Messenger.
// Exporta o contrato padrao usado em todos os canais:
//   { nome, enviarTexto, enviarArquivo, enviarQuickReply, registrarWebhook }
// ============================================================

const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const https = require("https");

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "";
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "meu_token_secreto";
const FB_APP_SECRET = process.env.FB_APP_SECRET || "";
const NODE_ENV = process.env.NODE_ENV || "development";

// Agentes HTTP com keep-alive — reduz latencia em chamadas concorrentes
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

function compararSeguro(a, b) {
  const ba = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

async function enviarTexto(userId, texto) {
  if (!PAGE_ACCESS_TOKEN) {
    console.warn("[MESSENGER] PAGE_ACCESS_TOKEN nao configurado");
    return false;
  }
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      { recipient: { id: userId }, message: { text: texto } },
      {
        params: { access_token: PAGE_ACCESS_TOKEN },
        timeout: 15000,
        httpAgent,
        httpsAgent,
      }
    );
    return true;
  } catch (err) {
    console.error("[MESSENGER] enviarTexto:", err.response ? JSON.stringify(err.response.data) : err.message);
    return false;
  }
}

// Envia mensagem com botoes de resposta rapida (Quick Reply)
// opcoes: [{ titulo: "Aceito e Continuar", payload: "LGPD_ACEITO" }]
async function enviarQuickReply(userId, texto, opcoes) {
  if (!PAGE_ACCESS_TOKEN) return false;
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      {
        recipient: { id: userId },
        message: {
          text: texto,
          quick_replies: opcoes.map((o) => ({
            content_type: "text",
            title: o.titulo,
            payload: o.payload,
          })),
        },
      },
      {
        params: { access_token: PAGE_ACCESS_TOKEN },
        timeout: 15000,
        httpAgent,
        httpsAgent,
      }
    );
    return true;
  } catch (err) {
    console.error("[MESSENGER] enviarQuickReply:", err.response ? JSON.stringify(err.response.data) : err.message);
    return false;
  }
}

async function enviarArquivo(userId, caminhoArquivo, nomeArquivo) {
  if (!PAGE_ACCESS_TOKEN) return false;
  if (!fs.existsSync(caminhoArquivo)) {
    console.error("[MESSENGER] arquivo nao encontrado:", caminhoArquivo);
    return false;
  }
  try {
    const form = new FormData();
    form.append("recipient", JSON.stringify({ id: userId }));
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
      {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 30000,
        httpAgent,
        httpsAgent,
      }
    );
    console.log("[MESSENGER] arquivo enviado:", nomeArquivo);
    return true;
  } catch (err) {
    console.error("[MESSENGER] enviarArquivo:", err.response ? JSON.stringify(err.response.data) : err.message);
    return false;
  }
}

// Valida assinatura X-Hub-Signature-256
function assinaturaValida(req) {
  if (!FB_APP_SECRET) {
    if (NODE_ENV === "production") {
      console.error("[SEG] FB_APP_SECRET nao configurado em producao!");
      return false;
    }
    return true;
  }
  const assinatura = req.get("x-hub-signature-256") || "";
  if (!assinatura.startsWith("sha256=") || !req.rawBody) return false;
  const esperado =
    "sha256=" +
    crypto.createHmac("sha256", FB_APP_SECRET).update(req.rawBody).digest("hex");
  return compararSeguro(assinatura, esperado);
}

// Registra os endpoints no app Express.
// onMensagem recebe (userId, texto, canal)
function registrarWebhook(app, onMensagem) {
  app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && compararSeguro(token, VERIFY_TOKEN)) {
      console.log("[MESSENGER] Webhook verificado");
      return res.status(200).send(challenge);
    }
    res.sendStatus(403);
  });

  app.post("/webhook", (req, res) => {
    if (!assinaturaValida(req)) {
      console.warn("[SEG] Assinatura invalida no /webhook");
      return res.sendStatus(403);
    }
    const body = req.body;
    if (body.object !== "page") return res.sendStatus(404);
    res.sendStatus(200);

    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        if (!event.message || event.message.is_echo) continue;
        const userId = event.sender.id;

        // ── Bloqueio de midia (LGPD / seguranca) ──────────────
        // Ignora fotos, arquivos e audios — so aceita texto digitado.
        if (event.message.attachments && event.message.attachments.length > 0) {
          console.log(`[MESSENGER] Anexo bloqueado de ${userId}: tipo=${event.message.attachments[0].type}`);
          enviarTexto(
            userId,
            "Por questoes de seguranca e protecao de dados, nao aceitamos fotos ou arquivos. " +
            "Por favor, digite as informacoes diretamente no chat."
          ).catch(() => {});
          continue;
        }

        const texto = event.message.text;
        if (!texto) continue;
        console.log(`[MESSENGER] Mensagem de ${userId}: ${texto}`);
        onMensagem(userId, texto, module.exports);
      }
    }
  });
}

module.exports = {
  nome: "messenger",
  enviarTexto,
  enviarArquivo,
  enviarQuickReply,
  registrarWebhook,
};
