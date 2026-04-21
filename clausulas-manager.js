// ============================================================
// clausulas-manager.js
// Gerencia os textos das clausulas do Contrato de Aluguel.
// Le de dados/clausulas.json, com fallback para os textos padrao.
//
// Variaveis disponiveis nos textos (use {{nome_campo}}):
//   Partes    : locador_nome, locador_cpf_fmt, locatario_nome, locatario_cpf_fmt
//   Imovel    : imovel_endereco
//   Prazo     : prazo_meses, data_inicio_ext, data_fim_ext
//   Aluguel   : valor_aluguel_fmt, valor_aluguel_ext, dia_vencimento, forma_pagamento
//   Rescisao  : multa_alugueis
//   Foro      : comarca
// ============================================================

const fs   = require("fs");
const path = require("path");

const CLAUSULAS_PATH = path.join(__dirname, "dados", "clausulas.json");

const DEFAULTS = [
  {
    titulo: "CL\u00c1USULA PRIMEIRA \u2013 DO OBJETO",
    texto:
      "O objeto deste contrato \u00e9 a loca\u00e7\u00e3o do im\u00f3vel residencial situado em {{imovel_endereco}}. " +
      "O im\u00f3vel \u00e9 entregue em perfeitas condi\u00e7\u00f5es de conserva\u00e7\u00e3o e limpeza, " +
      "obrigando-se o LOCAT\u00c1RIO a restitu\u00ed-lo no mesmo estado.",
  },
  {
    titulo: "CL\u00c1USULA SEGUNDA \u2013 DA DESTINA\u00c7\u00c3O",
    texto:
      "O im\u00f3vel destina-se exclusivamente para fins residenciais do LOCAT\u00c1RIO e sua fam\u00edlia, " +
      "sendo vedada qualquer altera\u00e7\u00e3o de finalidade, bem como a subloca\u00e7\u00e3o, cess\u00e3o ou " +
      "empr\u00e9stimo do im\u00f3vel, total ou parcial, sem o consentimento pr\u00e9vio e por escrito do LOCADOR.",
  },
  {
    titulo: "CL\u00c1USULA TERCEIRA \u2013 DO PRAZO",
    texto:
      "A loca\u00e7\u00e3o ter\u00e1 o prazo de {{prazo_meses}} meses, " +
      "com in\u00edcio em {{data_inicio_ext}} e t\u00e9rmino em {{data_fim_ext}}. " +
      "Findo este prazo, o LOCAT\u00c1RIO dever\u00e1 desocupar o im\u00f3vel, independentemente de " +
      "notifica\u00e7\u00e3o, sob pena de despejo.",
  },
  {
    titulo: "CL\u00c1USULA QUARTA \u2013 DO ALUGUEL E ENCARGOS",
    texto:
      "O aluguel mensal \u00e9 de {{valor_aluguel_fmt}} ({{valor_aluguel_ext}}), " +
      "a ser pago at\u00e9 o dia {{dia_vencimento}} de cada m\u00eas, via {{forma_pagamento}}. " +
      "Em caso de atraso, incidir\u00e1 multa de 10% sobre o valor devido e juros de mora de 1% ao m\u00eas.",
  },
  {
    titulo: "CL\u00c1USULA QUINTA \u2013 DAS BENFEITORIAS",
    texto:
      "Qualquer benfeitoria ou altera\u00e7\u00e3o no im\u00f3vel depender\u00e1 de autoriza\u00e7\u00e3o pr\u00e9via " +
      "por escrito do LOCADOR. As benfeitorias \u00fateis ou volunt\u00e1rias n\u00e3o dar\u00e3o direito a " +
      "reten\u00e7\u00e3o ou indeniza\u00e7\u00e3o, incorporando-se ao im\u00f3vel.",
  },
  {
    titulo: "CL\u00c1USULA SEXTA \u2013 DA MULTA RESCIS\u00d3RIA",
    texto:
      "A infra\u00e7\u00e3o de qualquer cl\u00e1usula deste contrato sujeita a parte infratora \u00e0 multa de " +
      "{{multa_alugueis}} alugu\u00e9is vigentes \u00e0 \u00e9poca da infra\u00e7\u00e3o, aplicada proporcionalmente " +
      "ao tempo restante do contrato, conforme o Art. 4\u00ba da Lei 8.245/91.",
  },
  {
    titulo: "CL\u00c1USULA S\u00c9TIMA \u2013 DO FORO",
    texto:
      "As partes elegem o foro da Comarca de {{comarca}} para dirimir " +
      "quaisquer quest\u00f5es oriundas deste contrato.",
  },
];

function getClausulas() {
  try {
    if (fs.existsSync(CLAUSULAS_PATH)) {
      return JSON.parse(fs.readFileSync(CLAUSULAS_PATH, "utf8"));
    }
  } catch (e) {
    console.error("[CLAUSULAS] Erro ao ler clausulas.json:", e.message);
  }
  return DEFAULTS.map((c) => ({ ...c }));
}

function saveClausulas(clausulas) {
  fs.mkdirSync(path.dirname(CLAUSULAS_PATH), { recursive: true });
  fs.writeFileSync(CLAUSULAS_PATH, JSON.stringify(clausulas, null, 2), "utf8");
}

// Substitui {{variavel}} pelos valores do objeto dados.
function interpolar(texto, dados) {
  return texto.replace(/\{\{(\w+)\}\}/g, (_, chave) =>
    dados[chave] !== undefined ? String(dados[chave]) : `[${chave}]`
  );
}

module.exports = { getClausulas, saveClausulas, interpolar, DEFAULTS };
