// ============================================================
// relatorios.js
// Registra cada documento gerado (ou erro) em relatorios JSON
// e CSV. Cria tambem um CSV acumulado geral.
// ============================================================

const fs = require("fs");
const path = require("path");

const PASTA_RELATORIOS = path.join(__dirname, "relatorios");

// Retorna data no formato YYYY-MM-DD
function dataHoje() {
  const d = new Date();
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

// Retorna hora no formato HH:MM:SS
function horaAgora() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// Monta uma linha CSV com aspas e escape basico
function linhaCSV(valores) {
  return valores
    .map((v) => {
      const s = String(v == null ? "" : v).replace(/"/g, '""');
      return `"${s}"`;
    })
    .join(",");
}

const CABECALHO_CSV = linhaCSV([
  "data",
  "hora",
  "tipo",
  "cliente",
  "status",
  "arquivo",
]);

// Funcao principal: registra um evento no relatorio
// registro = { tipo, cliente, status, arquivo }
function registrar(registro) {
  try {
    // mkdirSync com recursive e idempotente — sem existsSync necessario
    fs.mkdirSync(PASTA_RELATORIOS, { recursive: true });

    const hoje = dataHoje();
    const hora = horaAgora();

    const evento = {
      data: hoje,
      hora: hora,
      tipo: registro.tipo || "desconhecido",
      cliente: registro.cliente || "",
      status: registro.status || "gerado",
      arquivo: registro.arquivo || "",
    };

    const linha = linhaCSV([
      evento.data, evento.hora, evento.tipo,
      evento.cliente, evento.status, evento.arquivo,
    ]) + "\n";

    // 1) NDJSON diario (append-only — sem race condition de read-modify-write)
    const ndjsonPath = path.join(PASTA_RELATORIOS, `relatorio_${hoje}.ndjson`);
    fs.appendFileSync(ndjsonPath, JSON.stringify(evento) + "\n", "utf8");

    // 2) CSV diario
    const csvPath = path.join(PASTA_RELATORIOS, `relatorio_${hoje}.csv`);
    if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, CABECALHO_CSV + "\n", "utf8");
    fs.appendFileSync(csvPath, linha, "utf8");

    // 3) CSV geral acumulado (lido pelo admin /stats e /dashboard)
    const geralPath = path.join(PASTA_RELATORIOS, "relatorio_geral.csv");
    if (!fs.existsSync(geralPath)) fs.writeFileSync(geralPath, CABECALHO_CSV + "\n", "utf8");
    fs.appendFileSync(geralPath, linha, "utf8");

    console.log(
      `[RELATORIO] ${evento.data} ${evento.hora} | ${evento.tipo} | ${evento.cliente} | ${evento.status}`
    );
  } catch (erro) {
    // Nunca derrubar o servidor por causa de relatorio
    console.error("[RELATORIO] Falha ao registrar:", erro.message);
  }
}

module.exports = { registrar };
