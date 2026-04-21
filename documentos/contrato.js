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
const { getClausulas, interpolar } = require("../clausulas-manager");

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

      // ── Clausulas (lidas do clausulas-manager — editaveis pelo painel) ──
      const dataFim = dados.data_fim || calcularDataFim(dados.data_inicio, dados.prazo_meses);
      const valorAluguel = Number(dados.valor_aluguel) || 0;

      // Variaveis disponiveis nos templates de clausula
      const varsClausula = {
        ...dados,
        locador_cpf_fmt:       formatarCpfCnpj(dados.locador_cpf),
        locatario_cpf_fmt:     formatarCpfCnpj(dados.locatario_cpf),
        valor_aluguel_fmt:     formatarMoeda(valorAluguel),
        valor_aluguel_ext:     valorPorExtenso(valorAluguel),
        data_inicio_ext:       dataPorExtenso(dados.data_inicio),
        data_fim_ext:          dataPorExtenso(dataFim),
        multa_alugueis:        dados.multa_alugueis || "3",
        comarca:               dados.comarca || "________________",
        forma_pagamento:       dados.forma_pagamento || "________________",
        dia_vencimento:        dados.dia_vencimento || "__",
        imovel_endereco:       dados.imovel_endereco || "________________",
        prazo_meses:           dados.prazo_meses || "____",
      };

      function renderClausula(titulo, texto) {
        doc.font("Helvetica-Bold").text(titulo);
        doc.moveDown(0.2);
        doc.font("Helvetica").text(interpolar(texto, varsClausula), { align: "justify", lineGap: 3 });
        doc.moveDown(0.8);
      }

      for (const c of getClausulas()) {
        renderClausula(c.titulo, c.texto);
      }

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
