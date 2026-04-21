// ============================================================
// documentos/contrato.js
// Gera um Contrato de Locação Residencial em PDF usando pdfkit.
// Template baseado no modelo estruturado V2 da empresa.
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

// Calcula data de término a partir de data_inicio + prazo em meses
function calcularDataFim(dataInicio, prazoMeses) {
  if (!dataInicio) return null;
  const d = new Date(dataInicio + "T00:00:00");
  d.setMonth(d.getMonth() + Number(prazoMeses || 0));
  return d.toISOString().slice(0, 10);
}

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
        .text("CONTRATO DE LOCA\u00c7\u00c3O", { align: "center" });
      doc.moveDown(0.3);
      doc.moveTo(70, doc.y).lineTo(70 + larguraUtil, doc.y).stroke();
      doc.moveDown(1.2);

      // ── Identificacao das partes ────────────────────────────
      doc.fontSize(12).font("Helvetica");

      const locadorRg = dados.locador_rg
        ? ` e no RG sob o n\u00ba ${dados.locador_rg}${dados.locador_orgao_exp ? ` ${dados.locador_orgao_exp}` : ""}`
        : "";
      const locatarioRg = dados.locatario_rg
        ? ` e no RG sob o n\u00ba ${dados.locatario_rg}${dados.locatario_orgao_exp ? ` ${dados.locatario_orgao_exp}` : ""}`
        : "";

      doc.font("Helvetica-Bold").text("LOCADOR: ", { continued: true })
        .font("Helvetica").text(
          `${dados.locador_nome || "________________"}, ` +
          `${dados.locador_nacionalidade || "________________"}, ` +
          `${dados.locador_estado_civil || "________________"}, ` +
          `${dados.locador_profissao || "________________"}, ` +
          `inscrito no RG sob o n\u00ba ${dados.locador_rg || "________________"}` +
          `${dados.locador_orgao_exp ? ` ${dados.locador_orgao_exp}` : ""}` +
          ` e no CPF sob o n\u00ba ${formatarCpfCnpj(dados.locador_cpf) || "________________"}, ` +
          `residente e domiciliado em ${dados.locador_endereco || "________________"}.`,
          { align: "justify", lineGap: 2 }
        );

      doc.moveDown(0.5);

      doc.font("Helvetica-Bold").text("LOCAT\u00c1RIO: ", { continued: true })
        .font("Helvetica").text(
          `${dados.locatario_nome || "________________"}, ` +
          `${dados.locatario_nacionalidade || "________________"}, ` +
          `${dados.locatario_estado_civil || "________________"}, ` +
          `${dados.locatario_profissao || "________________"}, ` +
          `inscrito no RG sob o n\u00ba ${dados.locatario_rg || "________________"}` +
          `${dados.locatario_orgao_exp ? ` ${dados.locatario_orgao_exp}` : ""}` +
          ` e no CPF sob o n\u00ba ${formatarCpfCnpj(dados.locatario_cpf) || "________________"}.`,
          { align: "justify", lineGap: 2 }
        );

      doc.moveDown(1);

      // ── Clausulas ───────────────────────────────────────────
      function clausula(titulo, texto) {
        doc.font("Helvetica-Bold").text(titulo);
        doc.moveDown(0.2);
        doc.font("Helvetica").text(texto, { align: "justify", lineGap: 3 });
        doc.moveDown(0.8);
      }

      clausula(
        "CL\u00c1USULA PRIMEIRA \u2013 DO OBJETO",
        `O objeto deste contrato \u00e9 a loca\u00e7\u00e3o do im\u00f3vel residencial situado em ` +
        `${dados.imovel_endereco || "________________"}. ` +
        `O im\u00f3vel \u00e9 entregue em perfeitas condi\u00e7\u00f5es de conserva\u00e7\u00e3o e limpeza, ` +
        `obrigando-se o LOCAT\u00c1RIO a restitu\u00ed-lo no mesmo estado.`
      );

      clausula(
        "CL\u00c1USULA SEGUNDA \u2013 DA DESTINA\u00c7\u00c3O",
        `O im\u00f3vel destina-se exclusivamente para fins residenciais do LOCAT\u00c1RIO e sua fam\u00edlia, ` +
        `sendo vedada qualquer altera\u00e7\u00e3o de finalidade, bem como a subloca\u00e7\u00e3o, cess\u00e3o ou ` +
        `empr\u00e9stimo do im\u00f3vel, total ou parcial, sem o consentimento pr\u00e9vio e por escrito do LOCADOR.`
      );

      const dataFim = dados.data_fim || calcularDataFim(dados.data_inicio, dados.prazo_meses);
      clausula(
        "CL\u00c1USULA TERCEIRA \u2013 DO PRAZO",
        `A loca\u00e7\u00e3o ter\u00e1 o prazo de ${dados.prazo_meses || "____"} meses, ` +
        `com in\u00edcio em ${dataPorExtenso(dados.data_inicio)} e t\u00e9rmino em ${dataPorExtenso(dataFim)}. ` +
        `Findo este prazo, o LOCAT\u00c1RIO dever\u00e1 desocupar o im\u00f3vel, independentemente de ` +
        `notifica\u00e7\u00e3o, sob pena de despejo.`
      );

      const valorAluguel = Number(dados.valor_aluguel) || 0;
      clausula(
        "CL\u00c1USULA QUARTA \u2013 DO ALUGUEL E ENCARGOS",
        `O aluguel mensal \u00e9 de ${formatarMoeda(valorAluguel)} (${valorPorExtenso(valorAluguel)}), ` +
        `a ser pago at\u00e9 o dia ${dados.dia_vencimento || "__"} de cada m\u00eas, ` +
        `via ${dados.forma_pagamento || "________________"}. ` +
        `Em caso de atraso, incidir\u00e1 multa de 10% sobre o valor devido e juros de mora de 1% ao m\u00eas.`
      );

      clausula(
        "CL\u00c1USULA QUINTA \u2013 DAS BENFEITORIAS",
        `Qualquer benfeitoria ou altera\u00e7\u00e3o no im\u00f3vel depender\u00e1 de autoriza\u00e7\u00e3o pr\u00e9via ` +
        `por escrito do LOCADOR. As benfeitorias \u00fateis ou volunt\u00e1rias n\u00e3o dar\u00e3o direito a ` +
        `reten\u00e7\u00e3o ou indeniza\u00e7\u00e3o, incorporando-se ao im\u00f3vel.`
      );

      const multaAlugueis = dados.multa_alugueis || "3";
      clausula(
        "CL\u00c1USULA SEXTA \u2013 DA MULTA RESCIS\u00d3RIA",
        `A infra\u00e7\u00e3o de qualquer cl\u00e1usula deste contrato sujeita a parte infratora \u00e0 multa de ` +
        `${multaAlugueis} alugu\u00e9is vigentes \u00e0 \u00e9poca da infra\u00e7\u00e3o, aplicada proporcionalmente ` +
        `ao tempo restante do contrato, conforme o Art. 4\u00ba da Lei 8.245/91.`
      );

      clausula(
        "CL\u00c1USULA S\u00c9TIMA \u2013 DO FORO",
        `As partes elegem o foro da Comarca de ${dados.comarca || "________________"} para dirimir ` +
        `quaisquer quest\u00f5es oriundas deste contrato.`
      );

      // ── Local e data ────────────────────────────────────────
      const localData = dados.cidade
        ? `${dados.cidade}${dados.estado ? ` - ${dados.estado}` : ""}, ${dataPorExtenso(dados.data_assinatura)}.`
        : `${dataPorExtenso(dados.data_assinatura)}.`;
      doc.fontSize(12).font("Helvetica").text(localData, { align: "right" });

      // ── Assinaturas ─────────────────────────────────────────
      doc.moveDown(3.5);
      const yAss = doc.y;
      const largAss = 200;
      const xEsq = 70 + (larguraUtil / 2 - largAss) / 2;
      const xDir = 70 + larguraUtil / 2 + (larguraUtil / 2 - largAss) / 2;

      doc.moveTo(xEsq, yAss).lineTo(xEsq + largAss, yAss).stroke();
      doc.moveTo(xDir, yAss).lineTo(xDir + largAss, yAss).stroke();
      doc.fontSize(10);
      doc.text(`LOCADOR - ${dados.locador_nome || "________________"}`, xEsq, yAss + 6, { width: largAss, align: "center" });
      doc.text(`LOCAT\u00c1RIO - ${dados.locatario_nome || "________________"}`, xDir, yAss + 6, { width: largAss, align: "center" });

      // ── Testemunhas ─────────────────────────────────────────
      doc.moveDown(3);
      const yTest = doc.y;
      doc.moveTo(xEsq, yTest).lineTo(xEsq + largAss, yTest).stroke();
      doc.moveTo(xDir, yTest).lineTo(xDir + largAss, yTest).stroke();
      doc.text("Testemunha:", xEsq, yTest + 6, { width: largAss, align: "center" });
      doc.text("Testemunha:", xDir, yTest + 6, { width: largAss, align: "center" });

      doc.fontSize(12);

      // ── Linha inferior + rodape ─────────────────────────────
      doc.y = yTest + 30;
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
