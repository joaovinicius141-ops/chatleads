// ============================================================
// setores.js
// Registro central de todos os setores de atendimento.
//
// Para adicionar um novo setor:
// 1) Crie o arquivo em prompts/nome_do_setor.js
// 2) Adicione uma entrada no array SETORES abaixo
// 3) Crie o gerador do documento em documentos/nome.js (se necessario)
// Nao precisa mexer em nenhum outro arquivo.
//
// Precos configurados via variaveis de ambiente (.env / Railway):
//   PRECO_DECLARACAO  — default: 15
//   PRECO_RECIBO      — default: 25
//   PRECO_CONTRATO    — default: 50
// ============================================================

const { getConfig } = require("./config-manager");

const PRECO_DECLARACAO = Number(process.env.PRECO_DECLARACAO) || 15;
const PRECO_RECIBO     = Number(process.env.PRECO_RECIBO)     || 25;
const PRECO_CONTRATO   = Number(process.env.PRECO_CONTRATO)   || 50;

const SETORES = [
  {
    numero: 1,
    nome: "Declaracao de Residencia",
    tipo: "declaracao",
    preco: PRECO_DECLARACAO,
    prompt: require("./prompts/declaracao_residencia")(PRECO_DECLARACAO),
  },
  {
    numero: 2,
    nome: "Recibo de Pagamento",
    tipo: "recibo",
    preco: PRECO_RECIBO,
    prompt: require("./prompts/recibo_pagamento")(PRECO_RECIBO),
  },
  {
    numero: 3,
    nome: "Contrato de Aluguel",
    tipo: "contrato",
    preco: PRECO_CONTRATO,
    prompt: require("./prompts/contrato_aluguel")(PRECO_CONTRATO),
  },
  {
    numero: 4,
    nome: "Suporte",
    tipo: "suporte",
    preco: 0,
    // Funcao chamada no startup para incluir variaveis de ambiente
    prompt: require("./prompts/suporte")(),
  },
];

// Monta o texto do menu que e enviado ao cliente (le precos frescos do config)
function textoMenu() {
  const cfg = getConfig();
  const precosAtivos = {
    declaracao: cfg.preco_declaracao,
    recibo:     cfg.preco_recibo,
    contrato:   cfg.preco_contrato,
  };
  const linhas = SETORES.map((s) => {
    const preco = precosAtivos[s.tipo] ?? s.preco;
    if (preco > 0) {
      return `${s.numero}) ${s.nome} \u2014 R$ ${preco.toFixed(2).replace(".", ",")}`;
    }
    return `${s.numero}) ${s.nome}`;
  });
  return (
    "Aqui voce tira seu documento de um jeito rapido e facil, sem sair de casa.\n\n" +
    "Qual documento voce precisa hoje?\n\n" +
    linhas.join("\n") +
    "\n\nE so responder com o numero do que voce quer (por exemplo: 1)."
  );
}

// Retorna o setor pelo numero digitado pelo cliente.
// Aceita variacoes como "1", "1.", "1 - Declaracao", "Opcao 1" etc.
function buscarSetor(entrada) {
  const texto = String(entrada || "").trim();
  // Pega o primeiro numero que aparecer
  const match = texto.match(/\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  return SETORES.find((s) => s.numero === n) || null;
}

// ─── CAMPOS MINIMOS POR TIPO ──────────────────────────────────
// Usado no fallback quando Gemini fica indisponivel no fim do fluxo:
// se o state tracker ja tem TODOS os campos minimos, geramos o documento
// com os dados coletados e defaults para o restante.
const CAMPOS_MINIMOS = {
  declaracao: ["nome", "cpf", "endereco", "cidade", "estado"],
  recibo:     ["pagador", "recebedor", "valor", "descricao"],
  contrato:   [
    "locador_nome", "locador_cpf",
    "locatario_nome", "locatario_cpf",
    "imovel_endereco", "valor_aluguel",
    "prazo_meses", "data_inicio",
  ],
};

// Defaults aplicados aos campos opcionais se estiverem ausentes
function aplicarDefaults(tipo, dados) {
  const hoje = new Date().toISOString().slice(0, 10);
  const out = { ...dados };
  if (tipo === "declaracao") {
    if (!out.data) out.data = hoje;
    if (!out.nacionalidade) out.nacionalidade = "brasileira";
    if (!out.estado_civil) out.estado_civil = "";
    if (!out.profissao) out.profissao = "";
    if (!out.rg) out.rg = "";
    if (!out.orgao_expedidor) out.orgao_expedidor = "";
    if (!out.cep) out.cep = "";
  } else if (tipo === "recibo") {
    if (!out.data) out.data = hoje;
    if (!out.cpf_pagador) out.cpf_pagador = "";
    if (!out.cpf_recebedor) out.cpf_recebedor = "";
    if (!out.cidade) out.cidade = "";
    if (!out.estado) out.estado = "";
  } else if (tipo === "contrato") {
    if (!out.data_assinatura) out.data_assinatura = hoje;
    if (!out.locador_nacionalidade) out.locador_nacionalidade = "brasileiro(a)";
    if (!out.locador_estado_civil) out.locador_estado_civil = "";
    if (!out.locador_profissao) out.locador_profissao = "";
    if (!out.locador_rg) out.locador_rg = "";
    if (!out.locador_orgao_exp) out.locador_orgao_exp = "";
    if (!out.locador_endereco) out.locador_endereco = "";
    if (!out.locatario_nacionalidade) out.locatario_nacionalidade = "brasileiro(a)";
    if (!out.locatario_estado_civil) out.locatario_estado_civil = "";
    if (!out.locatario_profissao) out.locatario_profissao = "";
    if (!out.locatario_rg) out.locatario_rg = "";
    if (!out.locatario_orgao_exp) out.locatario_orgao_exp = "";
    if (out.dia_vencimento == null) out.dia_vencimento = 10;
    if (!out.forma_pagamento) out.forma_pagamento = "PIX";
    if (out.multa_alugueis == null) out.multa_alugueis = 3;
    if (!out.comarca) out.comarca = out.cidade || "";
    if (!out.cidade) out.cidade = "";
    if (!out.estado) out.estado = "";
  }
  return out;
}

function temDadosMinimos(tipo, dados) {
  const campos = CAMPOS_MINIMOS[tipo];
  if (!campos || !dados) return false;
  return campos.every((c) => {
    const v = dados[c];
    return v !== undefined && v !== null && String(v).trim() !== "";
  });
}

module.exports = {
  SETORES, textoMenu, buscarSetor,
  PRECO_DECLARACAO, PRECO_RECIBO, PRECO_CONTRATO,
  CAMPOS_MINIMOS, aplicarDefaults, temDadosMinimos,
};
