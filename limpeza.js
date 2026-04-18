// ============================================================
// limpeza.js
// Rotina de retencao: remove pastas diarias mais velhas que N dias
// de documentos_gerados/ e logs/.
//
// Roda na inicializacao e depois a cada 12 horas.
// Configuravel via .env:
//   DIAS_RETENCAO (default 30)
// ============================================================

const fs = require("fs");
const path = require("path");

const DIAS_RETENCAO = Number(process.env.DIAS_RETENCAO || 30);

const ALVOS = [
  path.join(__dirname, "documentos_gerados"),
  path.join(__dirname, "logs"),
];

// Pastas diarias seguem o padrao YYYY-MM-DD
function pastaEhDataValida(nome) {
  return /^\d{4}-\d{2}-\d{2}$/.test(nome);
}

function diasDesdeData(iso) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const d = new Date(ano, mes - 1, dia);
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

function removerRecursivo(caminho) {
  // fs.rmSync existe a partir do Node 14.14
  try {
    fs.rmSync(caminho, { recursive: true, force: true });
  } catch (e) {
    // Fallback para versoes antigas
    try {
      fs.rmdirSync(caminho, { recursive: true });
    } catch (e2) {
      throw e2;
    }
  }
}

function limparPastaRaiz(raiz) {
  if (!fs.existsSync(raiz)) return { removidas: 0, mantidas: 0 };

  let removidas = 0;
  let mantidas = 0;

  for (const nome of fs.readdirSync(raiz)) {
    const completo = path.join(raiz, nome);
    let stat;
    try { stat = fs.statSync(completo); } catch { continue; }
    if (!stat.isDirectory()) continue;
    if (!pastaEhDataValida(nome)) { mantidas++; continue; }

    const dias = diasDesdeData(nome);
    if (dias > DIAS_RETENCAO) {
      try {
        removerRecursivo(completo);
        removidas++;
        console.log(`[LIMPEZA] Removida pasta ${nome} (${dias} dias) de ${path.basename(raiz)}`);
      } catch (e) {
        console.error(`[LIMPEZA] Falha ao remover ${completo}: ${e.message}`);
      }
    } else {
      mantidas++;
    }
  }
  return { removidas, mantidas };
}

function executarLimpeza() {
  console.log(`[LIMPEZA] Iniciando (retencao=${DIAS_RETENCAO} dias)`);
  let totalRem = 0, totalMant = 0;
  for (const raiz of ALVOS) {
    const r = limparPastaRaiz(raiz);
    totalRem += r.removidas;
    totalMant += r.mantidas;
  }
  console.log(`[LIMPEZA] Concluida: ${totalRem} pastas removidas, ${totalMant} mantidas`);
}

// Agenda: roda na inicializacao e a cada 12 horas
function iniciarAgendamento() {
  // Roda 30s apos subir para nao competir com o boot
  setTimeout(executarLimpeza, 30 * 1000);
  setInterval(executarLimpeza, 12 * 60 * 60 * 1000);
}

module.exports = { iniciarAgendamento, executarLimpeza, DIAS_RETENCAO };
