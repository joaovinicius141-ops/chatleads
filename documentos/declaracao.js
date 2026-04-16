// ============================================================
// documentos/declaracao.js
// Gera uma Declaracao de Residencia em PDF usando pdfkit.
// Layout fiel ao modelo textual da empresa.
// ============================================================

const fs = require("fs");
const PDFDocument = require("pdfkit");
const { dataPorExtenso } = require("./recibo");

function gerarDeclaracao(dados, caminhoDestino) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 70 });
      const stream = fs.createWriteStream(caminhoDestino);
      doc.pipe(stream);

      const larguraUtil = doc.page.width - 140;

      // ── Linha superior ──────────────────────────────────────
      doc.moveTo(70, doc.y).lineTo(70 + larguraUtil, doc.y).stroke();
      doc.moveDown(0.5);

      // ── Titulo ─────────────────────────────────────────────
      doc.fontSize(16).font("Helvetica-Bold")
        .text("DECLARA\u00c7\u00c3O DE RESID\u00caNCIA", { align: "center" });

      doc.moveDown(0.3);
      doc.moveTo(70, doc.y).lineTo(70 + larguraUtil, doc.y).stroke();
      doc.moveDown(1.5);

      // ── Corpo ───────────────────────────────────────────────
      doc.fontSize(12).font("Helvetica");

      const corpo =
        `Eu, ${dados.nome || "________________"}, ` +
        `nacionalidade ${dados.nacionalidade || "________________"}, ` +
        `estado civil ${dados.estado_civil || "________________"}, ` +
        `profiss\u00e3o ${dados.profissao || "________________"}, ` +
        `inscrito(a) no RG sob o n\u00ba ${dados.rg || "________________"} ` +
        `e no CPF sob o n\u00ba ${dados.cpf || "________________"}, ` +
        `DECLARO para os devidos fins de direito e sob as penas da lei, ` +
        `que resido e mantenho domic\u00edlio no endere\u00e7o abaixo:`;
      doc.text(corpo, { align: "justify", lineGap: 3 });

      doc.moveDown(1);

      // Bloco de endereco
      doc.font("Helvetica-Bold")
        .text(dados.endereco || "________________");
      doc.text(`Cidade: ${dados.cidade || "________________"} - UF: ${dados.estado || "__"}`);
      doc.text(`CEP: ${dados.cep || "________________"}`);
      doc.font("Helvetica");

      doc.moveDown(1);
      doc.text(
        "Por ser a express\u00e3o da verdade, firmo a presente declara\u00e7\u00e3o para que produza seus " +
        "efeitos legais, estando ciente de que a falsidade das informa\u00e7\u00f5es aqui prestadas " +
        "pode configurar crime de falsidade ideol\u00f3gica (Art. 299 do C\u00f3digo Penal).",
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
        .text(dados.nome || "________________", { align: "center" });
      doc.text(`CPF: ${dados.cpf || ""}`, { align: "center" });

      // ── Linha inferior ──────────────────────────────────────
      doc.moveDown(1);
      doc.moveTo(70, doc.y).lineTo(70 + larguraUtil, doc.y).stroke();

      doc.end();
      stream.on("finish", () => resolve(caminhoDestino));
      stream.on("error", reject);
    } catch (erro) {
      reject(erro);
    }
  });
}

module.exports = { gerarDeclaracao };
