// ============================================================
// logger.js
// Tee de logs: continua mostrando no stdout (Railway captura)
// E TAMBEM grava em logs/YYYY-MM-DD/app.log.
//
// Uso: require("./logger"); // uma unica vez no topo do index.js
// Apos o require, TODO console.log / warn / error vai para o arquivo.
// ============================================================

const fs = require("fs");
const path = require("path");

const PASTA_LOGS = path.join(__dirname, "logs");

function garantirPasta(caminho) {
  if (!fs.existsSync(caminho)) fs.mkdirSync(caminho, { recursive: true });
}

function dataHoje() {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function timestamp() {
  return new Date().toISOString();
}

// Mantem o stream aberto e troca automaticamente quando vira o dia
let streamAtual = null;
let dataStreamAtual = "";

function getStream() {
  const hoje = dataHoje();
  if (streamAtual && dataStreamAtual === hoje) return streamAtual;

  if (streamAtual) {
    try { streamAtual.end(); } catch (_) {}
  }
  const pasta = path.join(PASTA_LOGS, hoje);
  garantirPasta(pasta);
  streamAtual = fs.createWriteStream(path.join(pasta, "app.log"), { flags: "a" });
  dataStreamAtual = hoje;
  return streamAtual;
}

function escreverArquivo(nivel, args) {
  try {
    const linha =
      `[${timestamp()}] [${nivel}] ` +
      args
        .map((a) => {
          if (typeof a === "string") return a;
          try { return JSON.stringify(a); } catch { return String(a); }
        })
        .join(" ") +
      "\n";
    getStream().write(linha);
  } catch (_) {
    // Nunca deixar o logger derrubar o app
  }
}

const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origError = console.error.bind(console);
const origInfo = console.info.bind(console);

console.log = (...args) => { origLog(...args); escreverArquivo("INFO", args); };
console.info = (...args) => { origInfo(...args); escreverArquivo("INFO", args); };
console.warn = (...args) => { origWarn(...args); escreverArquivo("WARN", args); };
console.error = (...args) => { origError(...args); escreverArquivo("ERROR", args); };

// Flush no encerramento
process.on("beforeExit", () => { try { streamAtual && streamAtual.end(); } catch {} });
process.on("SIGTERM", () => { try { streamAtual && streamAtual.end(); } catch {} process.exit(0); });

module.exports = { PASTA_LOGS };
