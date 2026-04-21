// ============================================================
// documentos/contrato.js
// Gera um Contrato de Locacao Residencial em PDF usando pdfkit.
// Modelo simples baseado na Lei 8.245/91 (Lei do Inquilinato).
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

function gerarContrato(dados, caminhoDestino) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 70, bufferPages: true });
      const stream = fs.createWriteStream(caminhoDestino);
      doc.pipe(stream);

      const larguraUtil = doc.page.width - 140;

      // ── Linha superior + titulo ─────────────────────────────
      doc.moveTo(70, doc.y).lineTo(70 + larguraUtil, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(16).font("Helvetica-Bold")
        .text("CONTRATO DE LOCA\u00c7\u00c3O RESIDENCIAL", { align: "center" });
      doc.moveDown(0.3);
      doc.moveTo(70, doc.y).lineTo(70 + larguraUtil, doc.y).stroke();
      doc.moveDown(1.2);

      // ── Partes ──────────────────────────────────────────────
      doc.fontSize(12).font("Helvetica");

      const rgLocador = dados.rg_locador
        ? ` e RG n\u00ba ${dados.rg_locador}${dados.orgao_exp_locador ? ` ${dados.orgao_exp_locador}` : ""}`
        : "";
      const rgLocatario = dados.rg_locatario
        ? ` e RG n\u00ba ${dados.rg_locatario}${dados.orgao_exp_locatario ? ` ${dados.orgao_exp_locatario}` : ""}`
        : "";

      doc.font("Helvetica-Bold").text("LOCADOR: ", { continued: true })
        .font("Helvetica").text(
          `${dados.locador || "________________"}, inscrito(a) no CPF sob o n\u00ba ` +
          `${formatarCpfCnpj(dados.cpf_locador) || "________________"}${rgLocador}.`,
          { align: "justify", lineGap: 2 }
        );

      doc.moveDown(0.5);

      doc.font("Helvetica-Bold").text("LOCAT\u00c1RIO: ", { continued: true })
        .font("Helvetica").text(
          `${dados.locatario || "________________"}, inscrito(a) no CPF sob o n\u00ba ` +
          `${formatarCpfCnpj(dados.cpf_locatario) || "________________"}${rgLocatario}.`,
          { align: "justify", lineGap: 2 }
        );

      doc.moveDown(1);
      doc.text(
        "As partes acima identificadas t\u00eam, entre si, justo e contratado, o presente " +
        "CONTRATO DE LOCA\u00c7\u00c3O RESIDENCIAL, que se regera pelas cl\u00e1usulas seguintes e pelas " +
        "condi\u00e7\u00f5es descritas no presente instrumento.",
        { align: "justify", lineGap: 3 }
      );

      doc.moveDown(0.8);

      // ── Clausulas ───────────────────────────────────────────
      function clausula(titulo, texto) {
        doc.font("Helvetica-Bold").text(titulo);
        doc.font("Helvetica").text(texto, { align: "justify", lineGap: 3 });
        doc.moveDown(0.7);
      }

      clausula(
        "CL\u00c1USULA 1\u00aa \u2014 DO OBJETO",
        `O LOCADOR d\u00e1 em loca\u00e7\u00e3o ao LOCAT\u00c1RIO o im\u00f3vel residencial ` +
        `situado em ${dados.endereco_imovel || "________________"}, ` +
        `para fins exclusivamente residenciais.`
      );

      clausula(
        "CL\u00c1USULA 2\u00aa \u2014 DO PRAZO",
        `A presente loca\u00e7\u00e3o ter\u00e1 o prazo de ${dados.duracao || "________"}, ` +
        `com in\u00edcio em ${dataPorExtenso(dados.data_inicio)}, ` +
        `podendo ser renovada mediante acordo entre as partes.`
      );

      const valorAluguel = Number(dados.valor_aluguel) || 0;
      clausula(
        "CL\u00c1USULA 3\u00aa \u2014 DO ALUGUEL",
        `O valor mensal do aluguel \u00e9 de ${formatarMoeda(valorAluguel)} ` +
        `(${valorPorExtenso(valorAluguel)}), a ser pago pelo LOCAT\u00c1RIO at\u00e9 o dia ` +
        `${dados.dia_vencimento || "__"} de cada m\u00eas, por meio acordado entre as partes.`
      );

      const valorCaucao = Number(dados.valor_caucao) || 0;
      if (valorCaucao > 0) {
        clausula(
          "CL\u00c1USULA 4\u00aa \u2014 DA CAU\u00c7\u00c3O",
          `O LOCAT\u00c1RIO entregou ao LOCADOR, a t\u00edtulo de cau\u00e7\u00e3o, a quantia de ` +
          `${formatarMoeda(valorCaucao)} (${valorPorExtenso(valorCaucao)}), que ser\u00e1 ` +
          `restitu\u00edda ao final da loca\u00e7\u00e3o, desde que o im\u00f3vel seja devolvido nas ` +
          `mesmas condi\u00e7\u00f5es em que foi recebido, e quitadas todas as obriga\u00e7\u00f5es contratuais.`
        );
      } else {
        clausula(
          "CL\u00c1USULA 4\u00aa \u2014 DA CAU\u00c7\u00c3O",
          `A presente loca\u00e7\u00e3o n\u00e3o est\u00e1 sujeita a cau\u00e7\u00e3o, conforme acordado entre as partes.`
        );
      }

      clausula(
        "CL\u00c1USULA 5\u00aa \u2014 DAS OBRIGA\u00c7\u00d5ES DO LOCAT\u00c1RIO",
        `O LOCAT\u00c1RIO compromete-se a: (a) pagar pontualmente o aluguel e as despesas ` +
        `ordin\u00e1rias do im\u00f3vel (\u00e1gua, luz, g\u00e1s, taxas de condom\u00ednio e IPTU, quando ` +
        `aplic\u00e1veis); (b) utilizar o im\u00f3vel exclusivamente para fins residenciais; ` +
        `(c) conservar o im\u00f3vel em bom estado, respondendo pelos danos que der causa; ` +
        `(d) devolver o im\u00f3vel, ao t\u00e9rmino da loca\u00e7\u00e3o, nas mesmas condi\u00e7\u00f5es em que o recebeu.`
      );

      clausula(
        "CL\u00c1USULA 6\u00aa \u2014 DA RESCIS\u00c3O",
        `A rescis\u00e3o do presente contrato, por qualquer das partes, observar\u00e1 as disposi\u00e7\u00f5es ` +
        `da Lei n\u00ba 8.245/1991 (Lei do Inquilinato). Em caso de rescis\u00e3o antecipada por ` +
        `iniciativa do LOCAT\u00c1RIO, aplicar-se-\u00e1 multa proporcional ao prazo restante, ` +
        `conforme o Art. 4\u00ba da referida lei.`
      );

      clausula(
        "CL\u00c1USULA 7\u00aa \u2014 DO FORO",
        `As partes elegem o foro da comarca da situa\u00e7\u00e3o do im\u00f3vel para dirimir quaisquer ` +
        `quest\u00f5es oriundas do presente contrato, com renuncia a qualquer outro, por mais privilegiado que seja.`
      );

      doc.moveDown(0.5);
      doc.text(
        "E por estarem assim justas e contratadas, as partes firmam o presente instrumento " +
        "em duas vias de igual teor e forma, na presen\u00e7a das testemunhas abaixo.",
        { align: "justify", lineGap: 3 }
      );

      doc.moveDown(1);
      const localData = dados.local_assinatura
        ? `${dados.local_assinatura}, ${dataPorExtenso(dados.data_assinatura)}.`
        : `${dataPorExtenso(dados.data_assinatura)}.`;
      doc.text(localData, { align: "right" });

      // ── Assinaturas (lado a lado) ───────────────────────────
      doc.moveDown(4);
      const yAssinatura = doc.y;
      const larguraAssinatura = 200;
      const xEsquerda = 70 + (larguraUtil / 2 - larguraAssinatura) / 2;
      const xDireita  = 70 + larguraUtil / 2 + (larguraUtil / 2 - larguraAssinatura) / 2;

      doc.moveTo(xEsquerda, yAssinatura).lineTo(xEsquerda + larguraAssinatura, yAssinatura).stroke();
      doc.moveTo(xDireita,  yAssinatura).lineTo(xDireita  + larguraAssinatura, yAssinatura).stroke();

      doc.fontSize(10);
      doc.text("LOCADOR", xEsquerda, yAssinatura + 6, { width: larguraAssinatura, align: "center" });
      doc.text(dados.locador || "________________", xEsquerda, yAssinatura + 20, { width: larguraAssinatura, align: "center" });
      doc.text(`CPF: ${formatarCpfCnpj(dados.cpf_locador) || ""}`, xEsquerda, yAssinatura + 34, { width: larguraAssinatura, align: "center" });

      doc.text("LOCAT\u00c1RIO", xDireita, yAssinatura + 6, { width: larguraAssinatura, align: "center" });
      doc.text(dados.locatario || "________________", xDireita, yAssinatura + 20, { width: larguraAssinatura, align: "center" });
      doc.text(`CPF: ${formatarCpfCnpj(dados.cpf_locatario) || ""}`, xDireita, yAssinatura + 34, { width: larguraAssinatura, align: "center" });

      doc.fontSize(12);

      // ── Linha inferior + rodape ─────────────────────────────
      doc.y = yAssinatura + 60;
      doc.moveTo(70, doc.y).lineTo(70 + larguraUtil, doc.y).stroke();

      adicionarRodape(doc);

      doc.end();
      stream.on("finish", () => resolve(caminhoDestino));
      stream.on("error", reject);
    } catch (erro) {
      reject(erro);
    }
  });
}

module.exports = { gerarContrato };
