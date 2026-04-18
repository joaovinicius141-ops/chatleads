// ============================================================
// canais/whatsapp.js
// ESQUELETO — pronto para ativar quando tiver credenciais do
// WhatsApp Cloud API (Meta Business).
//
// Variaveis de ambiente necessarias (ainda nao ativas):
//   WA_PHONE_NUMBER_ID     — ID do numero no Meta Business
//   WA_ACCESS_TOKEN        — token permanente do sistema
//   WA_VERIFY_TOKEN        — senha do webhook (voce inventa)
//   WA_APP_SECRET          — secret do app para validar assinatura
//
// Quando for ativar:
// 1) Preencha as variaveis no Railway
// 2) Descomente a linha de registro no index.js
// 3) Configure o webhook no painel do Meta Business apontando
//    para https://SEU-DOMINIO/webhook/whatsapp
// ============================================================

const axios = require("axios");
const fs = require("fs");
const crypto = require("crypto");

const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || "";
const WA_ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN || "";
const WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || "";
const WA_APP_SECRET = process.env.WA_APP_SECRET || "";

function ativo() {
  return !!(WA_PHONE_NUMBER_ID && WA_ACCESS_TOKEN);
}

async function enviarTexto(numero, texto) {
  if (!ativo()) {
    console.warn("[WHATSAPP] Canal nao configurado");
    return false;
  }
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${WA_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: numero,
        type: "text",
        text: { body: texto },
      },
      {
        headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` },
        timeout: 15000,
      }
    );
    return true;
  } catch (err) {
    console.error("[WHATSAPP] enviarTexto:", err.response ? JSON.stringify(err.response.data) : err.message);
    return false;
  }
}

async function enviarArquivo(numero, caminhoArquivo, nomeArquivo) {
  if (!ativo()) return false;
  if (!fs.existsSync(caminhoArquivo)) return false;
  try {
    // 1) Upload do arquivo para obter media_id
    const FormData = require("form-data");
    const form = new FormData();
    form.append("file", fs.createReadStream(caminhoArquivo), {
      filename: nomeArquivo,
      contentType: "application/pdf",
    });
    form.append("type", "application/pdf");
    form.append("messaging_product", "whatsapp");

    const upload = await axios.post(
      `https://graph.facebook.com/v19.0/${WA_PHONE_NUMBER_ID}/media`,
      form,
      {
        headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}`, ...form.getHeaders() },
        timeout: 30000,
      }
    );
    const mediaId = upload.data.id;

    // 2) Envia mensagem com documento
    await axios.post(
      `https://graph.facebook.com/v19.0/${WA_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: numero,
        type: "document",
        document: { id: mediaId, filename: nomeArquivo },
      },
      { headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` }, timeout: 15000 }
    );
    return true;
  } catch (err) {
    console.error("[WHATSAPP] enviarArquivo:", err.response ? JSON.stringify(err.response.data) : err.message);
    return false;
  }
}

function assinaturaValida(req) {
  if (!WA_APP_SECRET) return true; // em dev
  const assinatura = req.get("x-hub-signature-256") || "";
  if (!assinatura.startsWith("sha256=") || !req.rawBody) return false;
  const esperado = "sha256=" +
    crypto.createHmac("sha256", WA_APP_SECRET).update(req.rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperado));
  } catch { return false; }
}

function registrarWebhook(app, onMensagem) {
  if (!ativo()) {
    console.log("[WHATSAPP] Canal nao ativo — webhook nao registrado");
    return;
  }

  app.get("/webhook/whatsapp", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" &&
        req.query["hub.verify_token"] === WA_VERIFY_TOKEN) {
      return res.status(200).send(req.query["hub.challenge"]);
    }
    res.sendStatus(403);
  });

  app.post("/webhook/whatsapp", (req, res) => {
    if (!assinaturaValida(req)) return res.sendStatus(403);
    res.sendStatus(200);

    const entries = req.body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const messages = (change.value && change.value.messages) || [];
        for (const msg of messages) {
          if (msg.type !== "text") continue;
          const numero = msg.from;
          const texto = msg.text && msg.text.body;
          if (!numero || !texto) continue;
          console.log(`[WHATSAPP] Mensagem de ${numero}: ${texto}`);
          onMensagem(numero, texto, module.exports);
        }
      }
    }
  });

  console.log("[WHATSAPP] Webhook registrado em /webhook/whatsapp");
}

module.exports = {
  nome: "whatsapp",
  ativo,
  enviarTexto,
  enviarArquivo,
  registrarWebhook,
};
