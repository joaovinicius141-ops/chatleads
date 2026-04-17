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
];

// Monta o texto do menu que e enviado ao cliente
function textoMenu() {
  const linhas = SETORES.map(
    (s) => `${s.numero} - ${s.nome} — R$ ${s.preco.toFixed(2).replace(".", ",")}`
  );
  return (
    "Ola! Bem-vindo a Crie Seu Contrato!\n\n" +
    "Selecione o documento que voce precisa:\n\n" +
    linhas.join("\n") +
    "\n\nDigite o numero do servico desejado."
  );
}

// Retorna o setor pelo numero digitado pelo cliente
function buscarSetor(numero) {
  return SETORES.find((s) => s.numero === Number(numero)) || null;
}

module.exports = { SETORES, textoMenu, buscarSetor };
