// ============================================================
// documentos/contrato.js
// Nao gera PDF. Apenas salva os dados em JSON para que a equipe
// prepare o contrato manualmente e entregue em ate 24h.
// ============================================================

const fs = require("fs");

function salvarContrato(dados, caminhoDestino) {
  return new Promise((resolve, reject) => {
    try {
      const registro = {
        recebido_em: new Date().toISOString(),
        status: "pendente_processamento_manual",
        dados: dados,
      };
      fs.writeFile(
        caminhoDestino,
        JSON.stringify(registro, null, 2),
        "utf8",
        (err) => {
          if (err) return reject(err);
          resolve(caminhoDestino);
        }
      );
    } catch (erro) {
      reject(erro);
    }
  });
}

module.exports = { salvarContrato };
