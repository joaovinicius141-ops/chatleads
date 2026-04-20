// ============================================================
// setores.js
// Registro central de todos os setores de atendimento.
//
// Para adicionar um novo setor:
// 1) Crie o arquivo em prompts/nome_do_setor.js
// 2) Adicione uma entrada no array SETORES abaixo
// 3) Crie o gerador do documento em documentos/nome.js (se necessario)
// Nao precisa mexer em nenhum outro arquivo.
// ============================================================

const SETORES = [
  {
    numero: 1,
    nome: "Declaracao de Residencia",
    tipo: "declaracao",
    preco: 15.00,
    prompt: require("./prompts/declaracao_residencia"),
  },
  {
    numero: 2,
    nome: "Recibo de Pagamento",
    tipo: "recibo",
    preco: 25.00,
    prompt: require("./prompts/recibo_pagamento"),
  },
  {
    numero: 3,
    nome: "Contrato de Aluguel",
    tipo: "contrato",
    preco: 50.00,
    prompt: require("./prompts/contrato_aluguel"),
  },
  {
    numero: 4,
    nome: "Suporte",
    tipo: "suporte",
    preco: 0,
    prompt: require("./prompts/suporte"),
  },
];

// Monta o texto do menu que e enviado ao cliente
function textoMenu() {
  const linhas = SETORES.map((s) => {
    if (s.preco > 0) {
      return `${s.numero}) ${s.nome} \u2014 R$ ${s.preco.toFixed(2).replace(".", ",")}`;
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

module.exports = { SETORES, textoMenu, buscarSetor };
