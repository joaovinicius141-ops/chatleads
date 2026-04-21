// ============================================================
// contato.js
// Retorna a linha de contato do suporte humano respeitando o
// horario comercial. Configuracoes lidas dinamicamente do
// config-manager (painel admin) com fallback para env vars.
// ============================================================

const { getConfig } = require("./config-manager");

function horaAtualBR() {
  try {
    const tz = getConfig().timezone || "America/Sao_Paulo";
    const hora = new Intl.DateTimeFormat("pt-BR", {
      timeZone: tz, hour: "2-digit", hour12: false,
    }).format(new Date());
    const n = Number(hora);
    return n === 24 ? 0 : n;
  } catch (_e) {
    return new Date().getHours();
  }
}

function dentroDoHorario() {
  const cfg = getConfig();
  const h = horaAtualBR();
  return h >= cfg.horario_inicio && h < cfg.horario_fim;
}

function linhaContato() {
  const cfg = getConfig();
  const linhaEmail = cfg.email_empresa ? `\nEmail: ${cfg.email_empresa}` : "";
  if (dentroDoHorario()) {
    return `Fale com ${cfg.nome_suporte}:\nWhatsApp: ${cfg.whatsapp_suporte}${linhaEmail}`;
  }
  return (
    `Nosso atendimento humano funciona das ${cfg.horario_inicio}h as ${cfg.horario_fim}h.\n` +
    `Mande uma mensagem para ${cfg.nome_suporte} que ele responde assim que estiver disponivel:\n` +
    `WhatsApp: ${cfg.whatsapp_suporte}${linhaEmail}`
  );
}

function nomeSuporte() {
  return getConfig().nome_suporte;
}

module.exports = { linhaContato, nomeSuporte, dentroDoHorario, horaAtualBR };
