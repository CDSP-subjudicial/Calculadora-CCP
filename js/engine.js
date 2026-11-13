/*
 * Motor de cálculo da Calculadora CEPREC.
 * Funções puras, sem DOM, para uso no navegador (window.CeprecEngine) e em testes Node.
 *
 * Regimes de atualização (diretrizes da Contadoria da CEPREC):
 *  - Correção: IPCA-E até 11/2021 (termo inicial a partir de 01/2001).
 *  - Juros de mora até 11/2021: 1% a.m. até 07/2001; 0,5% a.m. de 08/2001 a 06/2009;
 *    remuneração da caderneta de poupança (juros) de 07/2009 a 11/2021. Juros simples.
 *  - SELIC (EC 113/2021): de 12/2021 a 08/2025, soma simples das taxas mensais,
 *    aplicada uma única vez sobre o valor corrigido acrescido de juros.
 *  - EC 136/2025: a partir de 09/2025, IPCA + juros simples de 2% a.a.,
 *    limitado ao acumulado da SELIC no mesmo período.
 * Convenção mensal: os índices do mês do termo inicial até o mês anterior ao da data-base.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.CeprecEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MARCOS = Object.freeze({
    inicioIpcae: "2001-01",
    fimJurosUmPorCento: "2001-07",
    fimJurosMeioPorCento: "2009-06",
    fimRegimeAntigo: "2021-11",
    inicioSelic: "2021-12",
    fimSelic: "2025-08",
    inicioEc136: "2025-09"
  });

  // ---------- datas ----------
  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    const s = String(value).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    return null;
  }
  function monthKey(date) {
    const d = parseDate(date);
    return d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : null;
  }
  function addMonths(key, n) {
    const [y, m] = key.split("-").map(Number);
    const t = y * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  }
  function monthRange(fromKey, toKey) {
    const out = [];
    if (!fromKey || !toKey || fromKey > toKey) return out;
    for (let k = fromKey; k <= toKey; k = addMonths(k, 1)) out.push(k);
    return out;
  }
  function maxKey(a, b) { return !a ? b : !b ? a : (a > b ? a : b); }
  function minKey(a, b) { return !a ? b : !b ? a : (a < b ? a : b); }
  function formatMonth(key) { const [y, m] = key.split("-"); return `${m}/${y}`; }
  function formatDate(date) {
    const d = parseDate(date);
    return d ? `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}` : "";
  }

  // ---------- números ----------
  function round2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }

  // ---------- validação CNJ ----------
  function validarCnj(numero) {
    const digits = String(numero || "").replace(/\D/g, "");
    if (digits.length !== 20) return false;
    const n = digits.slice(0, 7), dv = digits.slice(7, 9), ano = digits.slice(9, 13), jtr = digits.slice(13, 16), oooo = digits.slice(16, 20);
    const base = BigInt(n + ano + jtr + oooo + "00");
    const calc = 98n - (base % 97n);
    return String(calc).padStart(2, "0") === dv;
  }
  function formatarCnj(numero) {
    const d = String(numero || "").replace(/\D/g, "");
    if (d.length !== 20) return String(numero || "");
    return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
  }

  // ---------- regras de base de cálculo (modelos da Contadoria) ----------
  /** Terço de férias de professor efetivo: 1/3 sobre os 15 dias adicionais (professor tem 45 dias). */
  function tercoEfetivo(subsidio, meses) {
    const m = Number.isFinite(meses) ? meses : 12;
    const ferias15 = round2((subsidio / 2) * (m / 12));
    const terco = round2(ferias15 / 3);
    return { ferias15, terco };
  }

  /** Avos de férias de vínculo temporário: meses completos + 1 se a fração restante tiver 15 dias ou mais; vínculo inferior a 15 dias = 0. */
  function avosVinculo(inicio, fim) {
    const a = parseDate(inicio), b = parseDate(fim);
    if (!a || !b || b < a) return { avos: 0, dias: 0, motivo: "datas inválidas" };
    const dias = Math.round((b - a) / 86400000) + 1;
    if (dias < 15) return { avos: 0, dias, motivo: "vínculo inferior a 15 dias" };
    let meses = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
    let ancora = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + meses, a.getUTCDate()));
    if (ancora > b) { meses -= 1; ancora = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + meses, a.getUTCDate())); }
    const resto = Math.round((b - ancora) / 86400000) + 1;
    const avos = Math.min(12, meses + (resto >= 15 ? 1 : 0));
    return { avos, dias, motivo: "" };
  }
  /** Terço de férias de professor temporário: subsídio da rescisão × avos / 24 (1/3 de 45 dias por avo). */
  function tercoTemporario(subsidioRescisao, avos) {
    return round2((subsidioRescisao * avos) / 24);
  }
  /** Licença-prêmio: último subsídio em atividade × (dias em saldo / 30). */
  function licencaPremio(subsidio, diasSaldo) {
    const meses = round2(diasSaldo / 30);
    return { meses, valor: round2(subsidio * meses) };
  }

  // ---------- índices ----------
  function serie(indices, nome) {
    return (indices && indices.series && indices.series[nome]) || {};
  }
  function exigir(indices, nome, meses, faltas) {
    const s = serie(indices, nome);
    const ausentes = meses.filter((k) => !(k in s));
    if (ausentes.length) faltas.push({ serie: nome, meses: ausentes });
    return s;
  }
  function jurosAntigosPercentual(k, poup) {
    if (k <= MARCOS.fimJurosUmPorCento) return 1;
    if (k <= MARCOS.fimJurosMeioPorCento) return 0.5;
    return poup[k];
  }

  /**
   * Atualiza uma parcela até a data-base.
   * @param {object} p { valor, termoCorrecao, termoJuros }
   * @param {string|Date} dataBase
   * @param {object} indices { series: { ipcae, ipca, selic, poupancaJuros } } com valores em % ao mês por "AAAA-MM"
   */
  function atualizarParcela(p, dataBase, indices) {
    const valor = Number(p.valor) || 0;
    const kBase = monthKey(dataBase);
    const kCorr = monthKey(p.termoCorrecao);
    const kJurosBruto = p.termoJuros ? monthKey(p.termoJuros) : null;
    const res = { valor, termoCorrecao: kCorr, etapas: [], avisos: [], faltas: [], erro: null };
    if (!kBase || !kCorr) { res.erro = "Informe o termo inicial da correção e a data-base."; return res; }
    if (kCorr < MARCOS.inicioIpcae) { res.erro = `Termo inicial anterior a 01/2001 (${formatMonth(kCorr)}): fora do escopo automático; aplicar o Manual de Cálculos da Justiça Federal.`; return res; }
    const ultimo = addMonths(kBase, -1);
    if (kCorr > ultimo) { res.avisos.push("Termo inicial no mês da data-base: sem atualização."); res.valorFinal = round2(valor); res.correcao = 0; res.juros = 0; return res; }
    const kJuros = kJurosBruto ? maxKey(kJurosBruto, kCorr) : null;

    // Etapa A — IPCA-E + juros (até 11/2021)
    let valorA = valor, jurosA = 0;
    const mesesA = monthRange(kCorr, minKey(MARCOS.fimRegimeAntigo, ultimo));
    if (mesesA.length) {
      const ipcae = exigir(indices, "ipcae", mesesA, res.faltas);
      const fator = mesesA.reduce((f, k) => f * (1 + (ipcae[k] || 0) / 100), 1);
      valorA = valor * fator;
      res.etapas.push({ etapa: "Correção IPCA-E", de: mesesA[0], ate: mesesA[mesesA.length - 1], indice: (fator - 1) * 100, tipo: "fator", valorApos: valorA });
      if (kJuros && kJuros <= MARCOS.fimRegimeAntigo) {
        const mesesJ = monthRange(kJuros, minKey(MARCOS.fimRegimeAntigo, ultimo));
        const poupMeses = mesesJ.filter((k) => k > MARCOS.fimJurosMeioPorCento);
        const poup = exigir(indices, "poupancaJuros", poupMeses, res.faltas);
        const perc = mesesJ.reduce((s, k) => s + (jurosAntigosPercentual(k, poup) || 0), 0);
        jurosA = valorA * perc / 100;
        res.etapas.push({ etapa: "Juros de mora (1% / 0,5% / poupança)", de: mesesJ[0], ate: mesesJ[mesesJ.length - 1], indice: perc, tipo: "simples", valorApos: valorA + jurosA });
      }
    }
    let saldo = valorA + jurosA;

    // Etapa B — SELIC (12/2021 a 08/2025)
    const mesesB = monthRange(maxKey(kCorr, MARCOS.inicioSelic), minKey(MARCOS.fimSelic, ultimo));
    let selicB = 0;
    if (mesesB.length) {
      const selic = exigir(indices, "selic", mesesB, res.faltas);
      selicB = mesesB.reduce((s, k) => s + (selic[k] || 0), 0);
      const antes = saldo;
      saldo = saldo * (1 + selicB / 100);
      res.etapas.push({ etapa: "SELIC (EC 113/2021)", de: mesesB[0], ate: mesesB[mesesB.length - 1], indice: selicB, tipo: "simples", valorApos: saldo, base: antes });
      if (kJuros && kJuros > MARCOS.fimRegimeAntigo && kJuros > kCorr) res.avisos.push("Termo inicial dos juros posterior a 11/2021: a SELIC foi aplicada desde o termo inicial da correção. Conferir.");
    }

    // Etapa C — EC 136/2025 (a partir de 09/2025)
    const mesesC = monthRange(maxKey(kCorr, MARCOS.inicioEc136), ultimo);
    if (mesesC.length) {
      const ipca = exigir(indices, "ipca", mesesC, res.faltas);
      const selic = exigir(indices, "selic", mesesC, res.faltas);
      const fatorIpca = mesesC.reduce((f, k) => f * (1 + (ipca[k] || 0) / 100), 1);
      const jurosPerc = (2 / 12) * mesesC.length;
      const proposto = fatorIpca * (1 + jurosPerc / 100);
      const selicC = mesesC.reduce((s, k) => s + (selic[k] || 0), 0);
      const teto = 1 + selicC / 100;
      const limitado = proposto > teto;
      const antes = saldo;
      saldo = saldo * (limitado ? teto : proposto);
      res.etapas.push({
        etapa: limitado ? "EC 136/2025 — limitado à SELIC" : "EC 136/2025 — IPCA + 2% a.a.",
        de: mesesC[0], ate: mesesC[mesesC.length - 1],
        indice: ((limitado ? teto : proposto) - 1) * 100, tipo: "fator", valorApos: saldo, base: antes,
        detalhe: { ipca: (fatorIpca - 1) * 100, juros: jurosPerc, selic: selicC, limitado }
      });
    }

    res.valorFinal = round2(saldo);
    res.juros = round2(jurosA);
    res.correcao = round2(res.valorFinal - valor - res.juros);
    if (res.faltas.length) res.erro = "Índices ausentes na tabela carregada: " + res.faltas.map((f) => `${f.serie} (${f.meses.map(formatMonth).slice(0, 4).join(", ")}${f.meses.length > 4 ? "…" : ""})`).join("; ") + ".";
    return res;
  }

  function atualizarParcelas(parcelas, dataBase, indices) {
    const itens = parcelas.map((p) => ({ ...p, resultado: atualizarParcela(p, dataBase, indices) }));
    const ok = itens.every((i) => !i.resultado.erro);
    const soma = (f) => round2(itens.reduce((s, i) => s + (Number(f(i)) || 0), 0));
    return {
      itens,
      ok,
      principal: soma((i) => i.valor),
      juros: ok ? soma((i) => i.resultado.juros) : null,
      total: ok ? soma((i) => i.resultado.valorFinal) : null,
      erros: itens.filter((i) => i.resultado.erro).map((i) => i.resultado.erro)
    };
  }

  /** Classifica a requisição pelo limite de 100 UPF/MT (Lei MT 10.656/2017). */
  function classificarRequisicao(total, valorUpf) {
    if (!Number.isFinite(total) || !Number.isFinite(valorUpf) || valorUpf <= 0) return null;
    const limite = round2(valorUpf * 100);
    return { limite, tipo: total <= limite ? "RPV" : "Precatório" };
  }

  /** Converte o CSV do SGS/BCB ("data;valor" com dd/mm/aaaa e vírgula decimal) em { "AAAA-MM": número }. */
  function parseSerieCsv(texto) {
    const out = {};
    for (const linha of String(texto || "").split(/\r?\n/)) {
      const m = linha.match(/"?(\d{2})\/(\d{2})\/(\d{4})"?\s*[;,\t]\s*"?(-?[\d.]*,?\d+)"?/);
      if (!m) continue;
      const num = Number(m[4].includes(",") ? m[4].replace(/\./g, "").replace(",", ".") : m[4]);
      if (Number.isFinite(num)) out[`${m[3]}-${m[2]}`] = num;
    }
    return out;
  }

  /** Juros da poupança (Lei 12.703/2012): 0,5% a.m. até 04/2012; depois, 0,5% se meta SELIC > 8,5% a.a., senão 70% da meta mensalizada. */
  function jurosPoupancaMes(key, metaSelicAnual) {
    if (key < "2012-05" || !Number.isFinite(metaSelicAnual) || metaSelicAnual > 8.5) return 0.5;
    return (Math.pow(1 + (0.7 * metaSelicAnual) / 100, 1 / 12) - 1) * 100;
  }

  function cobertura(indices) {
    const out = {};
    for (const nome of ["ipcae", "ipca", "selic", "poupancaJuros"]) {
      const ks = Object.keys(serie(indices, nome)).sort();
      out[nome] = ks.length ? { de: ks[0], ate: ks[ks.length - 1], meses: ks.length } : null;
    }
    return out;
  }

  return Object.freeze({
    MARCOS, parseDate, monthKey, addMonths, monthRange, formatMonth, formatDate, round2,
    validarCnj, formatarCnj, tercoEfetivo, avosVinculo, tercoTemporario, licencaPremio,
    atualizarParcela, atualizarParcelas, classificarRequisicao, parseSerieCsv, jurosPoupancaMes, cobertura
  });
});
