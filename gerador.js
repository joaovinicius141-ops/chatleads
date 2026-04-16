// ============================================================
// gerador.js
// Orquestra a geracao de documentos. Recebe tipo + dados,
// chama o modulo correto, salva o arquivo na pasta do dia
// e registra no relatorio.
//
// Para adicionar um novo tipo de documento:
// 1) Crie um arquivo em documentos/<novo>.js que exporte uma
//    funcao gerar<Novo>(dados, caminhoDestino) retornando Promise.
// 2) Importe-o aqui e adicione uma entrada no objeto GERADORES.
// ============================================================

const fs = require("fs");
const path = require("path");

const { gerarRecibo } = require("./documentos/recibo");
const { gerarDeclaracao } = require("./documentos/declaracao");
const { salvarContrato } = require("./documentos/contrato");
const relatorios = require("./relatorios");

const PASTA_SAIDA = path.join(__dirname, "documentos_gerados");

// --------- Mapa de geradores ---------------------------------
// Cada entrada define:
//   - extensao : extensao do arquivo final ("pdf" ou "json")
//   - gerar    : funcao(dados, caminho) => Promise
//   - nomeCliente(dados): extrai o nome do cliente para o arquivo
const GERADORES = {
  recibo: {
    extensao: "pdf",
    gerar: gerarRecibo,
    nomeCliente: (d) => d.pagador || d.recebedor || "cliente",
  },
  declaracao: {
    extensao: "pdf",
    gerar: gerarDeclaracao,
    nomeCliente: (d) => d.nome || "cliente",
  },
  contrato: {
    extensao: "json",
    gerar: salvarContrato,
    nomeCliente: (d) => d.locatario || d.locador || "cliente",
  },
};

// --------- Utilitarios ---------------------------------------

// Remove acentos, espacos e caracteres especiais do nome do arquivo
function sanitizar(texto) {
  if (!texto) return "cliente";
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "cliente";
}

function dataHojeISO() {
  const d = new Date();
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function horaCompacta() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}${m}${s}`;
}

function garantirPasta(caminho) {
  if (!fs.existsSync(caminho)) {
    fs.mkdirSync(caminho, { recursive: true });
  }
}

// --------- Funcao principal ----------------------------------
// Retorna: { sucesso, caminho, nomeArquivo, tipo, erro }
async function gerarDocumento(tipo, dados) {
  const config = GERADORES[tipo];

  if (!config) {
    const msg = `Tipo de documento desconhecido: ${tipo}`;
    console.error("[GERADOR]", msg);
    relatorios.registrar({
      tipo: tipo || "desconhecido",
      cliente: "",
      status: "erro",
      arquivo: "",
    });
    return { sucesso: false, erro: msg };
  }

  try {
    const hoje = dataHojeISO();
    const pastaDia = path.join(PASTA_SAIDA, hoje);
    garantirPasta(pastaDia);

    const nomeCliente = sanitizar(config.nomeCliente(dados || {}));
    const nomeArquivo = `${tipo}_${nomeCliente}_${horaCompacta()}.${config.extensao}`;
    const caminho = path.join(pastaDia, nomeArquivo);

    console.log(`[GERADOR] Gerando ${tipo} -> ${nomeArquivo}`);
    await config.gerar(dados, caminho);

    relatorios.registrar({
      tipo,
      cliente: config.nomeCliente(dados || {}),
      status: "gerado",
      arquivo: nomeArquivo,
    });

    console.log(`[GERADOR] OK: ${caminho}`);
    return {
      sucesso: true,
      tipo,
      caminho,
      nomeArquivo,
    };
  } catch (erro) {
    console.error(`[GERADOR] Erro ao gerar ${tipo}:`, erro.message);
    relatorios.registrar({
      tipo,
      cliente: (config.nomeCliente(dados || {}) || ""),
      status: "erro",
      arquivo: "",
    });
    return { sucesso: false, erro: erro.message };
  }
}

module.exports = { gerarDocumento };
