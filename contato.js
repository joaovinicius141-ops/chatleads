// ============================================================
// contato.js
// Retorna a linha de contato do suporte humano respeitando o
// horario comercial (America/Sao_Paulo, 8h-22h).
//
// Fora do horario, o bot NAO passa o numero direto — pede para o
// cliente mandar mensagem no WhatsApp que sera respondida depois.
//
// Config via .env:
//   NOME_SUPORTE     — nome do responsavel pelo suporte (default: "Suporte")
//   WHATSAPP_PEDRO   — numero do WhatsApp do suporte (ex: "(81) 99999-0000")
//   HORARIO_INICIO   — hora de inicio (default 8)
//   HORARIO_FIM      — hora de fim   (default 22)
//   TIMEZONE         — default "America/Sao_Paulo"
// ============================================================

const NOME_SUPORTE   = process.env.NOME_SUPORTE || "Suporte";
const WHATSAPP_PEDRO = process.env.WHATSAPP_PEDRO || "(00) 00000-0000";
const EMAIL_EMPRESA  = process.env.EMAIL_EMPRESA || "";
const HORARIO_INICIO = Number(process.env.HORARIO_INICIO || 8);
const HORARIO_FIM = Number(process.env.HORARIO_FIM || 22);
const TIMEZONE = process.env.TIMEZONE || "America/Sao_Paulo";

// Retorna a hora atual (0-23) no fuso configurado.
function horaAtualBR() {
  try {
    const hora = new Intl.DateTimeFormat("pt-BR", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      hour12: false,
    }).format(new Date());
    // Em algumas runtimes, "24" aparece no lugar de "00"
    const n = Number(hora);
    return n === 24 ? 0 : n;
  } catch (_e) {
    // Fallback: hora local do servidor
    return new Date().getHours();
  }
}

function dentroDoHorario() {
  const h = horaAtualBR();
  return h >= HORARIO_INICIO && h < HORARIO_FIM;
}

// Linha que vai embaixo de qualquer mensagem de fallback.
// Dentro do horario: passa o numero direto.
// Fora do horario: orienta a mandar mensagem para ser respondido depois.
function linhaContato() {
  const linhaEmail = EMAIL_EMPRESA ? `\nEmail: ${EMAIL_EMPRESA}` : "";
  if (dentroDoHorario()) {
    return `Fale com ${NOME_SUPORTE}:\nWhatsApp: ${WHATSAPP_PEDRO}${linhaEmail}`;
  }
  return (
    `Nosso atendimento humano funciona das ${HORARIO_INICIO}h as ${HORARIO_FIM}h.\n` +
    `Mande uma mensagem para ${NOME_SUPORTE} que ele responde assim que estiver disponivel:\n` +
    `WhatsApp: ${WHATSAPP_PEDRO}${linhaEmail}`
  );
}

// Exporta o nome do suporte para uso em outros modulos
function nomeSuporte() {
  return NOME_SUPORTE;
}

module.exports = { linhaContato, nomeSuporte, dentroDoHorario, horaAtualBR };
