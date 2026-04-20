// ============================================================
// documentos/recibo.js
// Gera um Recibo de Pagamento em PDF usando pdfkit.
// Layout fiel ao modelo textual da empresa.
// ============================================================

const fs = require("fs");
const PDFDocument = require("pdfkit");

// ------------------------------------------------------------
// Valor por extenso em reais (sem acentos para compatibilidade)
// ------------------------------------------------------------
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
  let partes = [];
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
  let partes = [];
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

function formatarMoeda(valor) {
  const num = Number(valor) || 0;
  return "R$ " + num.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const MESES = [
  "janeiro","fevereiro","marco","abril","maio","junho",
  "julho","agosto","setembro","outubro","novembro","dezembro",
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

// Formata CPF (11 digitos) ou CNPJ (14 digitos); outros valores retornados sem alteracao.
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

// ── Rodape legal em 8pt cinza na ultima pagina ─────────────────
// Requer bufferPages:true no construtor do PDFDocument.
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
  doc.fillColor("#000000").fontSize(12);
}

// ------------------------------------------------------------
// Gera o PDF do recibo
// ------------------------------------------------------------
function gerarRecibo(dados, caminhoDestino) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 70, bufferPages: true });
      const stream = fs.createWriteStream(caminhoDestino);
      doc.pipe(stream);

      const larguraUtil = doc.page.width - 140; // margem 70 de cada lado

      // ── Linha superior ──────────────────────────────────────
      doc.moveTo(70, doc.y).lineTo(70 + larguraUtil, doc.y).stroke();
      doc.moveDown(0.5);

      // ── Titulo ─────────────────────────────────────────────
      doc.fontSize(16).font("Helvetica-Bold")
        .text("RECIBO DE PAGAMENTO", { align: "center" });

      doc.moveDown(0.3);
      doc.moveTo(70, doc.y).lineTo(70 + larguraUtil, doc.y).stroke();
      doc.moveDown(1);

      // ── Valor em destaque ───────────────────────────────────
      doc.fontSize(14).font("Helvetica-Bold")
        .text(`VALOR: ${formatarMoeda(dados.valor)}`, { align: "center" });

      doc.moveDown(1.5);

      // ── Corpo ───────────────────────────────────────────────
      doc.fontSize(12).font("Helvetica");

      const corpo =
        `Recebi(emos) de ${dados.pagador || "________________"}, ` +
        `inscrito(a) no CPF/CNPJ sob o n\u00ba ${formatarCpfCnpj(dados.cpf_pagador) || "____________"}, ` +
        `a import\u00e2ncia de ${formatarMoeda(dados.valor)} ` +
        `(${valorPorExtenso(dados.valor)}).`;
      doc.text(corpo, { align: "justify", lineGap: 3 });

      doc.moveDown(0.8);
      doc.text("O referido pagamento \u00e9 referente a:", { align: "left" });
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").text(dados.descricao || "________________", { align: "left" });
      doc.font("Helvetica");

      doc.moveDown(0.8);
      doc.text(
        "Pelo presente, dou(amos) plena, geral e irrevog\u00e1vel quit\u00e0\u00e7\u00e3o do valor acima descrito, " +
        "para nada mais reclamar no futuro.",
        { align: "justify", lineGap: 3 }
      );

      doc.moveDown(1.5);
      doc.text(
        `${dados.cidade || "____________"} - ${dados.estado || "__"}, ${dataPorExtenso(dados.data)}.`,
        { align: "right" }
      );

      // ── Assinatura ──────────────────────────────────────────
      doc.moveDown(3.5);
      const xLinha = (doc.page.width - 250) / 2;
      doc.moveTo(xLinha, doc.y).lineTo(xLinha + 250, doc.y).stroke();
      doc.moveDown(0.4);
      doc.fontSize(11)
        .text(dados.recebedor || "________________", { align: "center" });
      doc.text(`CPF/CNPJ: ${formatarCpfCnpj(dados.cpf_recebedor) || ""}`, { align: "center" });

      // ── Linha inferior ──────────────────────────────────────
      doc.moveDown(1);
      doc.moveTo(70, doc.y).lineTo(70 + larguraUtil, doc.y).stroke();

      // ── Rodape legal (8pt, cinza) ───────────────────────────
      adicionarRodape(doc);

      doc.end();
      stream.on("finish", () => resolve(caminhoDestino));
      stream.on("error", reject);
    } catch (erro) {
      reject(erro);
    }
  });
}

module.exports = { gerarRecibo, valorPorExtenso, formatarMoeda, dataPorExtenso };
