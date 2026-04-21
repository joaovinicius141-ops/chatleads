// ============================================================
// documentos/recibo.js
// Gera um Recibo de Pagamento em PDF usando pdfkit.
// Layout fiel ao modelo textual da empresa.
// ============================================================

const fs = require("fs");
const PDFDocument = require("pdfkit");
const {
  formatarCpfCnpj,
  formatarMoeda,
  valorPorExtenso,
  dataPorExtenso,
  adicionarRodape,
} = require("./utils");

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
