// ============================================================
// pagamento.js
// Integração com Mercado Pago para geração de cobranças PIX.
// Cria a cobrança, devolve o código copia e cola, e verifica
// o status quando o webhook chega.
// ============================================================

const axios = require("axios");
const crypto = require("crypto");

const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN || "";
const { SETORES } = require("./setores");
const { getConfig } = require("./config-manager");

// Descricoes estaticas por tipo
const DESCRICOES = {};
for (const s of SETORES) {
  DESCRICOES[s.tipo] = `${s.nome} - Crie Seu Contrato`;
}

// Precos dinamicos — lidos do config-manager a cada pagamento
function getPreco(tipo) {
  const cfg = getConfig();
  const mapa = {
    declaracao: cfg.preco_declaracao,
    recibo:     cfg.preco_recibo,
    contrato:   cfg.preco_contrato,
  };
  return mapa[tipo] ?? (SETORES.find((s) => s.tipo === tipo) || {}).preco;
}

// ------------------------------------------------------------
// Cria uma cobrança PIX no Mercado Pago.
// Retorna: { id, codigoPix, valor } ou lança erro.
// ------------------------------------------------------------
async function criarCobrancaPix(tipo, psid) {
  if (!MP_TOKEN) throw new Error("MERCADOPAGO_ACCESS_TOKEN nao configurado");

  const valor = getPreco(tipo);
  if (!valor) throw new Error(`Tipo de documento sem preço definido: ${tipo}`);

  const webhookUrl = process.env.PUBLIC_URL
    ? `${process.env.PUBLIC_URL}/pagamento/webhook`
    : null;

  const payload = {
    transaction_amount: valor,
    description: DESCRICOES[tipo] || "Documento - Crie Seu Contrato",
    payment_method_id: "pix",
    // Mercado Pago exige um email do pagador.
    // Como nao coletamos o email, usamos um generico da empresa.
    payer: {
      email: process.env.EMAIL_EMPRESA || "pagamento@crieseuconstrato.com.br",
    },
    // Validade de 30 minutos
    date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    // Identificador interno para rastrear qual usuario fez o pagamento.
    // Usamos hash do psid para nao vazar o ID do Messenger no Mercado Pago.
    external_reference: `${crypto.createHash("sha256").update(String(psid)).digest("hex").slice(0, 16)}_${tipo}_${Date.now()}`,
    ...(webhookUrl && { notification_url: webhookUrl }),
  };

  // Idempotency-Key UNICA por tentativa. Se o cliente tentar gerar PIX
  // duas vezes em sequencia (ex: por retry de rede), geramos cobrancas
  // distintas — a validade de 30min limita exposicao.
  const idempotencyKey = crypto.randomUUID();

  const response = await axios.post(
    "https://api.mercadopago.com/v1/payments",
    payload,
    {
      headers: {
        Authorization: `Bearer ${MP_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      timeout: 15000,
    }
  );

  const dados = response.data;
  const codigoPix =
    dados.point_of_interaction &&
    dados.point_of_interaction.transaction_data &&
    dados.point_of_interaction.transaction_data.qr_code;

  if (!codigoPix) throw new Error("Mercado Pago nao retornou codigo PIX");

  console.log(`[PAGAMENTO] Cobrança criada: id=${dados.id} tipo=${tipo} valor=R$${valor} psid=${psid}`);

  return {
    id: dados.id,
    codigoPix,
    valor,
  };
}

// ------------------------------------------------------------
// Consulta o status de um pagamento no Mercado Pago.
// Retorna: { pago, status, externalReference }
// ------------------------------------------------------------
async function verificarPagamento(paymentId) {
  if (!MP_TOKEN) throw new Error("MERCADOPAGO_ACCESS_TOKEN nao configurado");

  const response = await axios.get(
    `https://api.mercadopago.com/v1/payments/${paymentId}`,
    {
      headers: { Authorization: `Bearer ${MP_TOKEN}` },
      timeout: 10000,
    }
  );

  const dados = response.data;
  return {
    pago: dados.status === "approved",
    status: dados.status,
    externalReference: dados.external_reference || "",
  };
}

module.exports = { criarCobrancaPix, verificarPagamento, PRECOS };
