/* Testes do motor de cálculo. Os índices abaixo são SINTÉTICOS (constantes), usados só para conferir a lógica. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../js/engine.js");

let n = 0;
const t = (nome, fn) => { fn(); n++; console.log("ok -", nome); };
const perto = (a, b, tol = 0.005) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

function sinteticos({ ipcae = 0.5, poup = 0.5, selic = 1, ipca = 0.4 } = {}) {
  const s = { ipcae: {}, ipca: {}, selic: {}, poupancaJuros: {} };
  for (const k of E.monthRange("2001-01", "2027-12")) { s.ipcae[k] = ipcae; s.ipca[k] = ipca; s.selic[k] = selic; s.poupancaJuros[k] = poup; }
  return { series: s };
}

t("CNJ: dígito verificador", () => {
  assert.equal(E.validarCnj("1028936-19.2017.8.11.0041"), true);
  assert.equal(E.validarCnj("0154722-58.2013.8.11.0000"), true);
  assert.equal(E.validarCnj("1028936-18.2017.8.11.0041"), false);
  assert.equal(E.formatarCnj("10289361920178110041"), "1028936-19.2017.8.11.0041");
});

t("Terço efetivo confere com a planilha da Contadoria (680,24)", () => {
  assert.deepEqual(E.tercoEfetivo(4081.41, 12), { ferias15: 2040.71, terco: 680.24 });
});

t("Licença-prêmio confere com a planilha (180 dias × 986,05 = 5.916,30)", () => {
  assert.deepEqual(E.licencaPremio(986.05, 180), { meses: 6, valor: 5916.3 });
});

t("Terço temporário: subsídio × avos ÷ 24 confere com a planilha", () => {
  assert.equal(E.tercoTemporario(2128.5, 6), 532.13);
  assert.equal(E.tercoTemporario(435.27, 7), 126.95);
  assert.equal(E.tercoTemporario(1703.64, 1), 70.99);
});

t("Avos: vínculo inferior a 15 dias = 0; fração ≥ 15 dias = 1 avo", () => {
  assert.equal(E.avosVinculo("2017-01-01", "2017-01-01").avos, 0);
  assert.equal(E.avosVinculo("2018-06-14", "2018-07-01").avos, 1);
  assert.equal(E.avosVinculo("2017-01-01", "2017-12-31").avos, 12);
});

t("Atualização completa: IPCA-E + juros, SELIC e EC 136 (sem teto)", () => {
  const r = E.atualizarParcela({ valor: 1000, termoCorrecao: "2020-01-15", termoJuros: "2020-01-20" }, "2026-01-15", sinteticos());
  assert.equal(r.erro, null);
  const a = 1000 * Math.pow(1.005, 23);           // 01/2020 a 11/2021
  const ja = a * 0.115;                            // 23 × 0,5%
  const b = (a + ja) * 1.45;                       // 12/2021 a 08/2025: 45 × 1%
  const prop = Math.pow(1.004, 4) * (1 + (2 / 12 * 4) / 100); // 09/2025 a 12/2025
  perto(r.valorFinal, b * prop);
  perto(r.juros, ja);
  assert.equal(r.etapas.length, 4);
});

t("EC 136: limitado à SELIC quando IPCA + 2% a.a. supera a SELIC", () => {
  const r = E.atualizarParcela({ valor: 1000, termoCorrecao: "2025-09-01" }, "2026-01-10", sinteticos({ selic: 0.1, ipca: 0.5 }));
  perto(r.valorFinal, 1000 * 1.004);
  assert.match(r.etapas[0].etapa, /limitado/);
});

t("Juros 1% a.m. até 07/2001 e 0,5% a.m. até 06/2009", () => {
  const r = E.atualizarParcela({ valor: 100, termoCorrecao: "2001-06-01", termoJuros: "2001-06-01" }, "2001-10-01", sinteticos({ ipcae: 0 }));
  perto(r.juros, 100 * (1 + 1 + 0.5 + 0.5) / 100); // 06,07 a 1%; 08,09 a 0,5%
});

t("Termo inicial anterior a 01/2001 é recusado", () => {
  const r = E.atualizarParcela({ valor: 100, termoCorrecao: "2000-05-01" }, "2026-01-01", sinteticos());
  assert.match(r.erro, /anterior a 01\/2001/);
});

t("Índice ausente gera erro explícito", () => {
  const ind = sinteticos(); delete ind.series.selic["2023-05"];
  const r = E.atualizarParcela({ valor: 100, termoCorrecao: "2022-01-01" }, "2024-01-01", ind);
  assert.match(r.erro, /selic/);
});

t("Classificação RPV × precatório pelo limite de 100 UPF", () => {
  assert.deepEqual(E.classificarRequisicao(26000, 265.28), { limite: 26528, tipo: "RPV" });
  assert.equal(E.classificarRequisicao(26600, 265.28).tipo, "Precatório");
});

t("Leitura de CSV do SGS", () => {
  const s = E.parseSerieCsv('"data";"valor"\n"01/01/2024";"0,42"\n"01/02/2024";"0,78"\n');
  assert.deepEqual(s, { "2024-01": 0.42, "2024-02": 0.78 });
});

t("Juros da poupança (Lei 12.703/2012)", () => {
  assert.equal(E.jurosPoupancaMes("2011-03", 11), 0.5);
  assert.equal(E.jurosPoupancaMes("2019-03", 10), 0.5);
  perto(E.jurosPoupancaMes("2020-08", 2), (Math.pow(1.014, 1 / 12) - 1) * 100, 1e-9);
});

console.log(`\n${n} testes passaram.`);
