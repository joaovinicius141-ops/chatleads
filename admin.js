// ============================================================
// admin.js
// Endpoints administrativos protegidos por ADMIN_SECRET.
// Permite:
//   GET  /admin/documentos?secret=XXX           -> lista todas as datas
//   GET  /admin/documentos/YYYY-MM-DD?secret=X  -> lista arquivos do dia
//   GET  /admin/arquivo/YYYY-MM-DD/nome?secret= -> baixa um arquivo
//   GET  /admin/logs?secret=XXX                 -> lista datas com log
//   GET  /admin/logs/YYYY-MM-DD?secret=XXX      -> baixa o log do dia
//   GET  /admin/stats?secret=XXX                -> resumo agregado
// ============================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PASTA_DOCUMENTOS = path.join(__dirname, "documentos_gerados");
const PASTA_LOGS = path.join(__dirname, "logs");
const PASTA_RELATORIOS = path.join(__dirname, "relatorios");

function compararSeguro(a, b) {
  const ba = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function dataEhValida(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Impede path traversal: recusa qualquer nome com "/" ou ".."
function nomeArquivoSeguro(nome) {
  return typeof nome === "string" &&
    !nome.includes("..") &&
    !nome.includes("/") &&
    !nome.includes("\\") &&
    nome.length < 200;
}

function registrar(app, ADMIN_SECRET) {
  // Middleware de autenticacao
  function auth(req, res, next) {
    if (!ADMIN_SECRET) {
      return res.status(503).json({ erro: "ADMIN_SECRET nao configurado" });
    }
    if (!compararSeguro(req.query.secret, ADMIN_SECRET)) {
      return res.status(403).json({ erro: "Acesso negado" });
    }
    next();
  }

  // Lista pastas diarias com documentos
  app.get("/admin/documentos", auth, (_req, res) => {
    if (!fs.existsSync(PASTA_DOCUMENTOS)) return res.json({ datas: [] });
    const datas = fs.readdirSync(PASTA_DOCUMENTOS)
      .filter(dataEhValida)
      .sort()
      .reverse();
    res.json({ datas, total: datas.length });
  });

  // Lista arquivos de uma data especifica
  app.get("/admin/documentos/:data", auth, (req, res) => {
    const { data } = req.params;
    if (!dataEhValida(data)) return res.status(400).json({ erro: "data invalida" });
    const pasta = path.join(PASTA_DOCUMENTOS, data);
    if (!fs.existsSync(pasta)) return res.json({ data, arquivos: [] });
    const arquivos = fs.readdirSync(pasta).map((nome) => {
      const stat = fs.statSync(path.join(pasta, nome));
      return { nome, tamanho: stat.size, criado: stat.mtime };
    });
    res.json({ data, arquivos, total: arquivos.length });
  });

  // Baixa um arquivo especifico
  app.get("/admin/arquivo/:data/:nome", auth, (req, res) => {
    const { data, nome } = req.params;
    if (!dataEhValida(data) || !nomeArquivoSeguro(nome)) {
      return res.status(400).json({ erro: "parametro invalido" });
    }
    const caminho = path.join(PASTA_DOCUMENTOS, data, nome);
    if (!fs.existsSync(caminho)) return res.status(404).json({ erro: "nao encontrado" });
    res.download(caminho);
  });

  // Lista datas com logs
  app.get("/admin/logs", auth, (_req, res) => {
    if (!fs.existsSync(PASTA_LOGS)) return res.json({ datas: [] });
    const datas = fs.readdirSync(PASTA_LOGS)
      .filter(dataEhValida)
      .sort()
      .reverse();
    res.json({ datas });
  });

  // Baixa o log de uma data
  app.get("/admin/logs/:data", auth, (req, res) => {
    const { data } = req.params;
    if (!dataEhValida(data)) return res.status(400).json({ erro: "data invalida" });
    const caminho = path.join(PASTA_LOGS, data, "app.log");
    if (!fs.existsSync(caminho)) return res.status(404).json({ erro: "nao encontrado" });
    res.download(caminho, `app-${data}.log`);
  });

  // Estatisticas agregadas (usa o relatorio_geral.csv)
  app.get("/admin/stats", auth, (_req, res) => {
    const stats = { total: 0, por_tipo: {}, por_data: {}, ultimos_7dias: 0 };
    const csv = path.join(PASTA_RELATORIOS, "relatorio_geral.csv");
    if (!fs.existsSync(csv)) return res.json(stats);

    const linhas = fs.readFileSync(csv, "utf8").split("\n").slice(1);
    const seteDiasAtras = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const linha of linhas) {
      if (!linha.trim()) continue;
      const cols = linha.match(/"([^"]*)"/g) || [];
      if (cols.length < 5) continue;
      const [data, , tipo, , status] = cols.map((c) => c.slice(1, -1));
      if (status !== "gerado") continue;
      stats.total++;
      stats.por_tipo[tipo] = (stats.por_tipo[tipo] || 0) + 1;
      stats.por_data[data] = (stats.por_data[data] || 0) + 1;
      const [y, m, d] = data.split("-").map(Number);
      if (new Date(y, m - 1, d).getTime() >= seteDiasAtras) stats.ultimos_7dias++;
    }
    res.json(stats);
  });

  // Dashboard completo: dados agregados para o painel visual
  const PRECO_POR_TIPO = { declaracao: 15, recibo: 25, contrato: 50 };

  app.get("/admin/dashboard", auth, (_req, res) => {
    const csv = path.join(PASTA_RELATORIOS, "relatorio_geral.csv");

    const resultado = {
      total_vendas: 0,
      faturamento_total: 0,
      ticket_medio: 0,
      ultimos_7dias: { vendas: 0, faturamento: 0 },
      por_tipo: {},       // { recibo: { vendas, faturamento } }
      por_dia: {},        // { "2026-04-17": { vendas, faturamento } }
      clientes_unicos: 0,
    };

    if (!fs.existsSync(csv)) return res.json(resultado);

    const linhas = fs.readFileSync(csv, "utf8").split("\n").slice(1);
    const agora = Date.now();
    const seteDiasAtras = agora - 7 * 24 * 60 * 60 * 1000;
    const trintaDiasAtras = agora - 30 * 24 * 60 * 60 * 1000;
    const clientesSet = new Set();

    for (const linha of linhas) {
      if (!linha.trim()) continue;
      const cols = linha.match(/"([^"]*)"/g) || [];
      if (cols.length < 5) continue;
      const [data, , tipo, cliente, status] = cols.map((c) => c.slice(1, -1));
      if (status !== "gerado") continue;

      const preco = PRECO_POR_TIPO[tipo] || 0;
      const [y, m, d] = data.split("-").map(Number);
      const ts = new Date(y, m - 1, d).getTime();

      resultado.total_vendas++;
      resultado.faturamento_total += preco;
      if (cliente) clientesSet.add(cliente.toLowerCase().trim());

      // Por tipo
      if (!resultado.por_tipo[tipo]) resultado.por_tipo[tipo] = { vendas: 0, faturamento: 0 };
      resultado.por_tipo[tipo].vendas++;
      resultado.por_tipo[tipo].faturamento += preco;

      // Ultimos 7 dias
      if (ts >= seteDiasAtras) {
        resultado.ultimos_7dias.vendas++;
        resultado.ultimos_7dias.faturamento += preco;
      }

      // Por dia (ultimos 30 dias)
      if (ts >= trintaDiasAtras) {
        if (!resultado.por_dia[data]) resultado.por_dia[data] = { vendas: 0, faturamento: 0 };
        resultado.por_dia[data].vendas++;
        resultado.por_dia[data].faturamento += preco;
      }
    }

    resultado.ticket_medio = resultado.total_vendas > 0
      ? parseFloat((resultado.faturamento_total / resultado.total_vendas).toFixed(2))
      : 0;
    resultado.clientes_unicos = clientesSet.size;

    res.json(resultado);
  });

  console.log("[ADMIN] Endpoints registrados em /admin/*");
}

module.exports = { registrar };
