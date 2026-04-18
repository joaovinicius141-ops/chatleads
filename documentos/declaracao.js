// ============================================================
// documentos/declaracao.js
// Gera uma Declaracao de Residencia em PDF usando pdfkit.
// Layout fiel ao modelo textual da empresa.
// ============================================================

const fs = require("fs");
const PDFDocument = require("pdfkit");
const { dataPorExtenso } = require("./recibo");

// ── Rodape legal em 8pt cinza (posicionado absolutamente no fim da pagina) ──
function adicionarRodape(doc) {
  const texto =
    "AVISO LEGAL: Este documento foi gerado automaticamente pela plataforma Crie Seu Contrato " +
    "com base nas informacoes fornecidas pelo usuario. O servico limita-se a automacao de redacao, " +
    "nao constituindo assessoria ou consultoria juridica. A veracidade e a conferencia dos dados " +
    "sao de inteira responsabilidade do declarante/contratante.";
  const yRodape = doc.page.height - 35;
  doc.save()
    .fontSize(8)
    .fillColor("#888888")
    .text(texto, 70, yRodape, { width: doc.page.width - 140, align: "center" })
    .restore();
}

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
        `inscrito(a) no RG sob o n\u00ba ${dados.rg || "________________"}` +
        `${dados.orgao_expedidor ? ` ${dados.orgao_expedidor}` : ""} ` +
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
        "efeitos legais.",
        { align: "justify", lineGap: 3 }
      );

      doc.moveDown(1);

      // ── Aviso legal Art. 299 ────────────────────────────────
      doc.text(
        "Declaro ainda, estar ciente de que a falsidade da presente declara\u00e7\u00e3o pode implicar " +
        "na san\u00e7\u00e3o penal prevista no Art. 299 do C\u00f3digo Penal, conforme transcri\u00e7\u00e3o abaixo:",
        { align: "justify", lineGap: 3 }
      );

      doc.moveDown(0.8);
      doc.font("Helvetica-Oblique").fontSize(11);
      doc.text(
        "\u201cArt. 299 \u2013 Omitir, em documento p\u00fablico ou particular, declara\u00e7\u00e3o que nele deveria " +
        "constar ou nele inserir ou fazer inserir declara\u00e7\u00e3o falsa ou diversa da que deveria ser escrita, " +
        "com o fim de prejudicar direito, criar obriga\u00e7\u00e3o ou alterar a verdade sobre fato juridicamente " +
        "relevante.\u201d",
        { align: "justify", lineGap: 3 }
      );

      doc.moveDown(0.5);
      doc.text(
        "\u201cPena: reclus\u00e3o de 1 (um) a 5 (cinco) anos e multa, se o documento \u00e9 p\u00fablico e " +
        "reclus\u00e3o de 1 (um) a 3 (tr\u00eas) anos, se o documento \u00e9 particular.\u201d",
        { align: "justify", lineGap: 3 }
      );
      doc.font("Helvetica").fontSize(12);

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

module.exports = { gerarDeclaracao };
