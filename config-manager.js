// ============================================================
// config-manager.js
// Gerencia configuracoes dinamicas do sistema.
// Le de dados/config.json (se existir), com fallback para env vars.
// Alteracoes via painel sobrevivem a reinicios mas nao a redeploys.
// ============================================================

const fs   = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "dados", "config.json");

// Valores padrao lidos das variaveis de ambiente no startup
const DEFAULTS = {
  preco_declaracao: Number(process.env.PRECO_DECLARACAO) || 15,
  preco_recibo:     Number(process.env.PRECO_RECIBO)     || 25,
  preco_contrato:   Number(process.env.PRECO_CONTRATO)   || 50,
  nome_suporte:     process.env.NOME_SUPORTE    || "Suporte",
  whatsapp_suporte: process.env.WHATSAPP_PEDRO  || "(00) 00000-0000",
  email_empresa:    process.env.EMAIL_EMPRESA   || "",
  horario_inicio:   Number(process.env.HORARIO_INICIO) || 8,
  horario_fim:      Number(process.env.HORARIO_FIM)    || 22,
  timezone:         process.env.TIMEZONE || "America/Sao_Paulo",
};

// Retorna config sempre fresca (le arquivo a cada chamada).
function getConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const salvo = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      return { ...DEFAULTS, ...salvo };
    }
  } catch (e) {
    console.error("[CONFIG] Erro ao ler config.json:", e.message);
  }
  return { ...DEFAULTS };
}

// Salva config mesclando com defaults (nao perde campos nao enviados).
function saveConfig(dados) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const atual = getConfig();
  const novo  = { ...atual, ...dados };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(novo, null, 2), "utf8");
  return novo;
}

module.exports = { getConfig, saveConfig, DEFAULTS };
