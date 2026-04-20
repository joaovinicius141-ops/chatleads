// ============================================================
// email.js
// Envia notificacao por email quando um cliente e escalado para
// suporte humano (enviarContatoSuporte / [ENCAMINHAR_PEDRO]).
//
// Variaveis de ambiente necessarias:
//   EMAIL_EMPRESA     — destinatario das notificacoes (obrigatorio)
//   EMAIL_SMTP_HOST   — ex: smtp.gmail.com
//   EMAIL_SMTP_PORT   — ex: 587  (TLS) ou 465 (SSL) — default: 587
//   EMAIL_SMTP_USER   — usuario SMTP (geralmente o proprio email remetente)
//   EMAIL_SMTP_PASS   — senha de app (nunca a senha normal da conta)
//
// Se qualquer variavel estiver ausente, o envio e silenciosamente omitido
// (log de aviso) sem quebrar o fluxo do bot.
// ============================================================

const nodemailer = require("nodemailer");

const EMAIL_EMPRESA = process.env.EMAIL_EMPRESA || "";
const SMTP_HOST     = process.env.EMAIL_SMTP_HOST || "";
const SMTP_PORT     = Number(process.env.EMAIL_SMTP_PORT || 587);
const SMTP_USER     = process.env.EMAIL_SMTP_USER || "";
const SMTP_PASS     = process.env.EMAIL_SMTP_PASS || "";

function emailConfigurado() {
  return !!(EMAIL_EMPRESA && SMTP_HOST && SMTP_USER && SMTP_PASS);
}

// Lazy-init do transporter para nao falhar no startup sem config
let transporter = null;
function getTransporter() {
  if (!transporter && emailConfigurado()) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // SSL direto apenas na porta 465; demais usam STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

// ─── ENVIA NOTIFICACAO DE SUPORTE ─────────────────────────────
// Parametros:
//   canal           — nome do canal (ex: "messenger")
//   userId          — identificador do usuario no canal
//   motivo          — string descrevendo por que foi escalado
//   historicoMsgs   — string[] com as mensagens trocadas (opcional)
//   dadosEntregues  — { tipo, dados } do documento envolvido (opcional)
async function enviarEmailSuporte({ canal, userId, motivo, historicoMsgs, dadosEntregues }) {
  if (!emailConfigurado()) {
    console.warn(
      "[EMAIL] Nao configurado — notificacao omitida. " +
      "Adicione EMAIL_EMPRESA, EMAIL_SMTP_HOST, EMAIL_SMTP_USER e EMAIL_SMTP_PASS."
    );
    return;
  }

  const t = getTransporter();
  if (!t) return;

  const nomeSuporte = process.env.NOME_SUPORTE || "Suporte";
  const timestamp = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const secaoHistorico =
    Array.isArray(historicoMsgs) && historicoMsgs.length > 0
      ? historicoMsgs.map((m, i) => `  ${i + 1}. ${m}`).join("\n")
      : "  (sem mensagens registradas)";

  const secaoDocumento = dadosEntregues
    ? `Tipo: ${dadosEntregues.tipo}\n\n${JSON.stringify(dadosEntregues.dados, null, 2)}`
    : "Nenhum documento vinculado a este atendimento.";

  const publicUrl = process.env.PUBLIC_URL || "";

  const corpoTexto = `
Crie Seu Contrato — Solicitacao de Suporte Humano
==================================================

Data/Hora : ${timestamp}
Canal     : ${canal}
Usuario ID: ${userId}
Motivo    : ${motivo || "Nao especificado"}

─── Historico de Mensagens do Cliente ───────────────────────
${secaoHistorico}

─── Documento Relacionado ───────────────────────────────────
${secaoDocumento}

${publicUrl ? `Dashboard: ${publicUrl}/admin/painel\n` : ""}
──────────────────────────────────────────────────────────────
Mensagem automatica gerada pelo bot Crie Seu Contrato.
Atencao, ${nomeSuporte}: o cliente esta aguardando retorno.
`.trim();

  // Versao HTML mais legivel para clientes de email modernos
  const corpoHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#1a1a2e;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">📋 Crie Seu Contrato — Suporte Humano</h2>
    <p style="margin:4px 0 0;opacity:.75;font-size:13px">${timestamp}</p>
  </div>
  <div style="border:1px solid #e0e0e0;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:4px 8px;color:#666;width:110px">Canal</td><td style="padding:4px 8px"><strong>${canal}</strong></td></tr>
      <tr><td style="padding:4px 8px;color:#666">Usuário ID</td><td style="padding:4px 8px"><code>${userId}</code></td></tr>
      <tr><td style="padding:4px 8px;color:#666">Motivo</td><td style="padding:4px 8px">${motivo || "Não especificado"}</td></tr>
    </table>

    <hr style="border:none;border-top:1px solid #eee;margin:16px 0">

    <h3 style="font-size:14px;color:#333;margin:0 0 8px">Mensagens do Cliente</h3>
    <div style="background:#f9f9f9;border-left:3px solid #6c63ff;padding:12px 16px;font-size:13px;line-height:1.6">
      ${
        Array.isArray(historicoMsgs) && historicoMsgs.length > 0
          ? historicoMsgs.map((m, i) => `<p style="margin:4px 0"><strong>${i + 1}.</strong> ${m}</p>`).join("")
          : "<em style='color:#999'>Sem mensagens registradas</em>"
      }
    </div>

    ${dadosEntregues ? `
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
    <h3 style="font-size:14px;color:#333;margin:0 0 8px">Documento Relacionado</h3>
    <div style="background:#f9f9f9;padding:12px 16px;font-size:13px;border-radius:4px">
      <strong>Tipo:</strong> ${dadosEntregues.tipo}<br><br>
      <pre style="margin:0;font-size:12px;white-space:pre-wrap">${JSON.stringify(dadosEntregues.dados, null, 2)}</pre>
    </div>` : ""}

    ${publicUrl ? `
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
    <a href="${publicUrl}/admin/painel" style="display:inline-block;background:#6c63ff;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px">Abrir Dashboard →</a>` : ""}

    <p style="font-size:12px;color:#999;margin:20px 0 0">
      Atençao, <strong>${nomeSuporte}</strong>: o cliente está aguardando retorno.<br>
      Esta mensagem foi gerada automaticamente pelo bot Crie Seu Contrato.
    </p>
  </div>
</div>
`.trim();

  try {
    await t.sendMail({
      from: `"Crie Seu Contrato" <${SMTP_USER}>`,
      to: EMAIL_EMPRESA,
      subject: `[Suporte] Novo atendimento aguardando — ${canal}:${userId.slice(-6)}`,
      text: corpoTexto,
      html: corpoHtml,
    });
    console.log(`[EMAIL] Notificacao de suporte enviada para ${EMAIL_EMPRESA}`);
  } catch (err) {
    console.error("[EMAIL] Falha ao enviar notificacao:", err.message);
  }
}

module.exports = { enviarEmailSuporte, emailConfigurado };
