// ============================================================
// documentos/declaracao_dono.js
// Gera uma Declaracao de Residencia do Proprietario em PDF.
// O proprietario declara que outra pessoa reside em seu imovel.
// Layout baseado no modelo oficial da empresa.
// ============================================================

const fs = require("fs");
const PDFDocument = require("pdfkit");
const { formatarCpfCnpj, dataPorExtenso, adicionarRodape } = require("./utils");

function gerarDeclaracaoDono(dados, caminhoDestino) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 70, bufferPages: true });
      const stream = fs.createWriteStream(caminhoDestino);
      doc.pipe(stream);

      const larguraUtil = doc.page.width - 140;

      // ── Linha superior ──────────────────────────────────────
      doc.moveTo(70, doc.y).lineTo(70 + larguraUtil, doc.y).stroke();
      doc.moveDown(0.5);

      // ── Titulo ─────────────────────────────────────────────
      doc.fontSize(16).font("Helvetica-Bold")
        .text("DECLARAÇÃO DE RESIDÊNCIA", { align: "center" });

      doc.moveDown(0.3);
      doc.moveTo(70, doc.y).lineTo(70 + larguraUtil, doc.y).stroke();
      doc.moveDown(1.5);

      // ── Corpo ───────────────────────────────────────────────
      doc.fontSize(12).font("Helvetica");

      const orgao = dados.proprietario_orgao_exp
        ? ` ${dados.proprietario_orgao_exp}`
        : "";

      const corpo =
        `Eu, ${dados.proprietario_nome || "________________"}, ` +
        `nacionalidade ${dados.proprietario_nacionalidade || "________________"}, ` +
        `estado civil ${dados.proprietario_estado_civil || "________________"}, ` +
        `profissão ${dados.proprietario_profissao || "________________"}, ` +
        `inscrito(a) no RG sob o nº ${dados.proprietario_rg || "________________"}` +
        `${orgao} ` +
        `e no CPF sob o nº ${formatarCpfCnpj(dados.proprietario_cpf) || "________________"}, ` +
        `DECLARO para os devidos fins de direito e sob as penas da lei, que ` +
        `${dados.residente_nome || "________________"}, ` +
        `inscrito(a) no CPF sob o nº ${formatarCpfCnpj(dados.residente_cpf) || "________________"}, ` +
        `reside e mantém domicílio no imóvel de minha propriedade situado no endereço abaixo:`;

      doc.text(corpo, { align: "justify", lineGap: 3 });

      doc.moveDown(1);

      // ── Bloco de endereco ───────────────────────────────────
      const enderecoLinha = [
        dados.imovel_endereco || "________________",
        dados.imovel_bairro   || null,
      ].filter(Boolean).join(", ");

      doc.font("Helvetica-Bold").text(enderecoLinha);
      doc.text(
        `Cidade: ${dados.imovel_cidade || "________________"} - UF: ${dados.imovel_uf || "__"}`
      );
      doc.text(`CEP: ${dados.imovel_cep || "________________"}`);
      doc.font("Helvetica");

      doc.moveDown(1);
      doc.text(
        "Por ser a expressão da verdade, firmo a presente declaração para que produza seus " +
        "efeitos legais.",
        { align: "justify", lineGap: 3 }
      );

      doc.moveDown(1);

      // ── Aviso legal Art. 299 ────────────────────────────────
      doc.text(
        "Declaro ainda, estar ciente de que a falsidade da presente declaração pode implicar " +
        "na sanção penal prevista no Art. 299 do Código Penal, conforme transcrição abaixo:",
        { align: "justify", lineGap: 3 }
      );

      doc.moveDown(0.8);
      doc.font("Helvetica-Oblique").fontSize(11);
      doc.text(
        "“Art. 299 – Omitir, em documento público ou particular, declaração que nele deveria " +
        "constar ou nele inserir ou fazer inserir declaração falsa ou diversa da que deveria ser escrita, " +
        "com o fim de prejudicar direito, criar obrigação ou alterar a verdade sobre fato juridicamente " +
        "relevante.”",
        { align: "justify", lineGap: 3 }
      );

      doc.moveDown(0.5);
      doc.text(
        "“Pena: reclusão de 1 (um) a 5 (cinco) anos e multa, se o documento é público e " +
        "reclusão de 1 (um) a 3 (três) anos, se o documento é particular.”",
        { align: "justify", lineGap: 3 }
      );
      doc.font("Helvetica").fontSize(12);

      doc.moveDown(1.5);
      doc.text(
        `${dados.imovel_cidade || "____________"} - ${dados.imovel_uf || "__"}, ${dataPorExtenso(dados.data)}.`,
        { align: "right" }
      );

      // ── Assinatura (proprietario) ───────────────────────────
      doc.moveDown(3.5);
      const xLinha = (doc.page.width - 250) / 2;
      doc.moveTo(xLinha, doc.y).lineTo(xLinha + 250, doc.y).stroke();
      doc.moveDown(0.4);
      doc.fontSize(11)
        .text(dados.proprietario_nome || "________________", { align: "center" });
      doc.text(
        `CPF: ${formatarCpfCnpj(dados.proprietario_cpf) || ""}`,
        { align: "center" }
      );

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

module.exports = { gerarDeclaracaoDono };
