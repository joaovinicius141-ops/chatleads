// ============================================================
// documentos/utils.js
// Utilitarios compartilhados por todos os geradores de PDF.
//
// Para criar um novo documento, importe o que precisar:
//   const { formatarCpfCnpj, adicionarRodape, dataPorExtenso } = require("./utils");
// ============================================================

// ─── FORMATACAO DE CPF / CNPJ ─────────────────────────────
// CPF  (11 digitos): "09802058408"     → "098.020.584-08"
// CNPJ (14 digitos): "11222333000181"  → "11.222.333/0001-81"
// Outros valores sao retornados sem alteracao.
function formatarCpfCnpj(valor) {
  const digits = String(valor || "").replace(/\D/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  return valor || "";
}

// ─── FORMATACAO DE MOEDA ──────────────────────────────────
// Exemplo: 1500.5 → "R$ 1.500,50"
function formatarMoeda(valor) {
  const num = Number(valor) || 0;
  return "R$ " + num.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// ─── DATA POR EXTENSO ─────────────────────────────────────
// Exemplo: "2025-06-15" → "15 de junho de 2025"
// Sem argumento: data de hoje (fuso do servidor).
const MESES = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function dataPorExtenso(iso) {
  if (!iso) {
    const d = new Date();
    return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  }
  const p = String(iso).split("-");
  if (p.length !== 3) return iso;
  return `${parseInt(p[2], 10)} de ${MESES[parseInt(p[1], 10) - 1] || ""} de ${p[0]}`;
}

// ─── VALOR POR EXTENSO ────────────────────────────────────
// Exemplo: 1500.50 → "mil e quinhentos reais e cinquenta centavos"
const UNIDADES = [
  "", "um", "dois", "tres", "quatro", "cinco",
  "seis", "sete", "oito", "nove", "dez", "onze",
  "doze", "treze", "quatorze", "quinze", "dezesseis",
  "dezessete", "dezoito", "dezenove",
];
const DEZENAS = [
  "", "", "vinte", "trinta", "quarenta", "cinquenta",
  "sessenta", "setenta", "oitenta", "noventa",
];
const CENTENAS = [
  "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos",
  "seiscentos", "setecentos", "oitocentos", "novecentos",
];

function grupoPorExtenso(n) {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const partes = [];
  if (c > 0) partes.push(CENTENAS[c]);
  const resto = n % 100;
  if (resto < 20 && resto > 0) {
    partes.push(UNIDADES[resto]);
  } else {
    const d = Math.floor(resto / 10);
    const u = resto % 10;
    if (d > 0) partes.push(DEZENAS[d]);
    if (u > 0) partes.push(UNIDADES[u]);
  }
  return partes.join(" e ");
}

function inteiroPorExtenso(n) {
  if (n === 0) return "zero";
  const grupos = [];
  let x = n;
  while (x > 0) { grupos.push(x % 1000); x = Math.floor(x / 1000); }
  const escalas = ["", "mil", "milhoes", "bilhoes"];
  const partes = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (g === 0) continue;
    let texto = grupoPorExtenso(g);
    if (i === 1) texto = (g === 1 ? "" : texto + " ") + "mil";
    else if (i > 1) texto += " " + escalas[i];
    partes.push(texto.trim());
  }
  return partes.join(" e ");
}

function valorPorExtenso(valor) {
  const num = Number(valor);
  if (isNaN(num)) return "valor invalido";
  const reais = Math.floor(num);
  const centavos = Math.round((num - reais) * 100);
  let texto = "";
  if (reais > 0) texto = inteiroPorExtenso(reais) + (reais === 1 ? " real" : " reais");
  if (centavos > 0) {
    const c = inteiroPorExtenso(centavos) + (centavos === 1 ? " centavo" : " centavos");
    texto = texto ? `${texto} e ${c}` : c;
  }
  return texto || "zero reais";
}

// ─── RODAPE LEGAL (compartilhado por todos os PDFs) ──────
// Requer bufferPages:true no construtor do PDFDocument.
// Imprime na ultima pagina sem criar pagina extra.
function adicionarRodape(doc) {
  const range = doc.bufferedPageRange();
  const ultimaPagina = range.start + range.count - 1;
  doc.switchToPage(ultimaPagina);

  const texto =
    "AVISO LEGAL: Este documento foi gerado automaticamente pela plataforma Crie Seu Contrato " +
    "com base nas informacoes fornecidas pelo usuario. O servico limita-se a automacao de redacao, " +
    "nao constituindo assessoria ou consultoria juridica. A veracidade e a conferencia dos dados " +
    "sao de inteira responsabilidade do declarante/contratante.";

  const margemOriginal = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  doc.fontSize(8)
     .fillColor("#888888")
     .text(texto, 70, doc.page.height - 30, {
       width: doc.page.width - 140,
       align: "center",
       lineBreak: true,
     });

  doc.page.margins.bottom = margemOriginal;
  doc.fillColor("#000000").fontSize(12); // restaura cor e fonte padrao
}

module.exports = {
  formatarCpfCnpj,
  formatarMoeda,
  dataPorExtenso,
  valorPorExtenso,
  adicionarRodape,
};
