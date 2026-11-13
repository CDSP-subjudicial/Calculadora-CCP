#!/usr/bin/env node
/*
 * Baixa do Banco Central (SGS) as séries usadas pela calculadora e grava data/indices.js.
 * Uso: node scripts/atualizar-indices.mjs     (Node 18 ou superior; precisa de acesso à internet)
 *
 * Séries: 10764 IPCA-E (% a.m.) · 433 IPCA (% a.m.) · 4390 SELIC acumulada no mês (% a.m.)
 *         432 Meta SELIC (% a.a., diária) — usada para os juros da poupança (Lei 12.703/2012).
 */
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E = require(path.join(raiz, "js/engine.js"));

const fmt = (d) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

async function sgs(codigo, de, ate) {
  const out = {};
  let ini = new Date(Date.UTC(de.getUTCFullYear(), de.getUTCMonth(), 1));
  while (ini <= ate) {
    const cinco = new Date(Date.UTC(ini.getUTCFullYear() + 5, ini.getUTCMonth(), 0));
    const fim = cinco < ate ? cinco : ate;
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json&dataInicial=${fmt(ini)}&dataFinal=${fmt(fim)}`;
    let tentativa = 0;
    for (;;) {
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      if (resp.ok) { for (const d of await resp.json()) out[d.data] = Number(String(d.valor).replace(",", ".")); break; }
      if (++tentativa >= 3 || resp.status < 500) throw new Error(`SGS ${codigo} ${fmt(ini)}–${fmt(fim)}: HTTP ${resp.status}`);
      await new Promise((r) => setTimeout(r, 2000 * tentativa));
    }
    ini = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth(), fim.getUTCDate() + 1));
  }
  return out;
}

function porMes(diario, primeiro = false) {
  const out = {};
  for (const [data, valor] of Object.entries(diario)) {
    const k = E.monthKey(data);
    if (!k || !Number.isFinite(valor)) continue;
    if (!primeiro || !(k in out)) out[k] = valor;
  }
  return out;
}

const hoje = new Date();
const ate = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
const [ipcae, ipca, selic, meta] = await Promise.all([
  sgs(10764, new Date(Date.UTC(2001, 0, 1)), ate),
  sgs(433, new Date(Date.UTC(2025, 0, 1)), ate),
  sgs(4390, new Date(Date.UTC(2021, 0, 1)), ate),
  sgs(432, new Date(Date.UTC(2012, 4, 1)), ate)
]);
const metaMes = porMes(meta, true);
const poupancaJuros = {};
for (const k of E.monthRange("2009-07", E.monthKey(ate))) {
  poupancaJuros[k] = Math.round(E.jurosPoupancaMes(k, metaMes[k]) * 1e6) / 1e6;
}
const dados = {
  fonte: "Banco Central do Brasil — SGS (10764, 433, 4390, 432)",
  atualizadoEm: new Date().toISOString(),
  series: { ipcae: porMes(ipcae), ipca: porMes(ipca), selic: porMes(selic), poupancaJuros }
};
const cab = "/* Tabela de índices da Calculadora CEPREC — gerada por scripts/atualizar-indices.mjs. Não edite à mão. */\n";
await writeFile(path.join(raiz, "data/indices.js"), `${cab}window.CEPREC_INDICES = ${JSON.stringify(dados, null, 1)};\n`);
await writeFile(path.join(raiz, "data/indices.json"), JSON.stringify(dados, null, 1));
const cob = E.cobertura(dados);
console.log("Índices gravados:", Object.entries(cob).map(([k, c]) => `${k} ${c ? `${c.de}..${c.ate} (${c.meses})` : "vazio"}`).join(" | "));
