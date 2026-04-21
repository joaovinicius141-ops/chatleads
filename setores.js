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

module.exports = { SETORES, textoMenu, buscarSetor, PRECO_DECLARACAO, PRECO_RECIBO, PRECO_CONTRATO };
