import { test } from "node:test";
import assert from "node:assert/strict";
import { Acervo } from "../src/db.js";
import { pesquisar, montarConsultaFts } from "../src/search.js";
import { interpretarCitacao, verificarCitacao } from "../src/citation.js";
import { aliasTribunal, cnjValido, formatarCnj } from "../src/sources/datajud.js";
import { interpretarSru } from "../src/sources/lexml.js";
import { lerCsv } from "../src/ingest/csv.js";
import { mapearEspelho, mapearTema, normalizarData } from "../src/ingest/stj.js";
import { Cota } from "../src/http.js";

const espelho = {
  id: "1460311",
  numeroProcesso: "1990285",
  numeroRegistro: "202200686198",
  siglaClasse: "REsp",
  descricaoClasse: "RECURSO ESPECIAL",
  nomeOrgaoJulgador: "TERCEIRA TURMA",
  ministroRelator: "MOURA RIBEIRO",
  dataPublicacao: "DJEN       DATA:30/10/2025",
  ementa: "DIREITO CIVIL. RECURSO ESPECIAL. IMPOSIÇÃO DE ALUGUEL-PENA. REEXAME. IMPOSSIBILIDADE. SÚMULAS N. 5 E 7/STJ.",
  dataDecisao: "20251027",
  decisao: "Acordam os Ministros da TERCEIRA TURMA...",
  teseJuridica: null,
  tema: null,
  referenciasLegislativas: ["LEG:FED LEI:013105 ANO:2015\n *****  CPC-15"],
};

const tema = (over: Record<string, string> = {}) => ({
  tipoPrecedente: "Tema",
  numeroPrecedente: "922",
  dataJulgamento: "2016-04-27",
  dataPublicacaoAcordao: "2016-05-30",
  situacao: "Trânsito em Julgado",
  questaoSubmetidaAJulgamento: "Inscrição indevida em cadastro de inadimplentes e dano moral.",
  teseFirmada: "A inscrição indevida comandada pelo credor em cadastro de inadimplentes, quando preexistente legítima anotação, não enseja indenização por dano moral.",
  orgaoJulgador: "S2",
  Assuntos: "DIREITO DO CONSUMIDOR",
  ...over,
});

function acervoDeTeste() {
  const a = new Acervo(":memory:");
  const docs = [
    mapearEspelho(espelho)!,
    mapearTema(tema())!,
    mapearTema(tema({ numeroPrecedente: "1", situacao: "Cancelado", teseFirmada: "Dano moral por inscrição indevida em cadastro é presumido." }))!,
    mapearEspelho({ ...espelho, id: "2", numeroProcesso: "123", ementa: "Dano moral. Inscrição indevida em cadastro de inadimplentes. Valor da indenização.", dataDecisao: "20260101" })!,
  ];
  a.salvar(docs);
  return a;
}

test("normalizarData aceita os formatos do STJ", () => {
  assert.equal(normalizarData("20251027"), "2025-10-27");
  assert.equal(normalizarData("DJEN       DATA:30/10/2025"), "2025-10-30");
  assert.equal(normalizarData("2026-09-09"), "2026-09-09");
  assert.equal(normalizarData(null), null);
});

test("mapearEspelho e mapearTema classificam autoridade", () => {
  const d = mapearEspelho(espelho)!;
  assert.equal(d.id, "STJ-ACOR-1460311");
  assert.equal(d.autoridade, "D");
  assert.equal(d.data_julgamento, "2025-10-27");
  assert.match(d.fonte_url!, /202200686198/);
  assert.equal(mapearEspelho({ ...espelho, nomeOrgaoJulgador: "CORTE ESPECIAL" })!.autoridade, "C");

  assert.equal(mapearTema(tema())!.autoridade, "B");
  assert.equal(mapearTema(tema())!.orgao, "SEGUNDA SEÇÃO");
  assert.equal(mapearTema(tema({ teseFirmada: "" }))!.autoridade, "E");
  assert.equal(mapearTema(tema({ tipoPrecedente: "Controvérsia" })), null);
});

test("lerCsv trata aspas e quebras de linha", () => {
  const r = lerCsv('﻿a,b\n1,"x, ""y""\nz"\n2,w\n');
  assert.deepEqual(r, [{ a: "1", b: 'x, "y"\nz' }, { a: "2", b: "w" }]);
});

test("montarConsultaFts gera expressão segura", () => {
  assert.equal(montarConsultaFts('"dano moral" AND indenização'), '"dano moral" OR indeniza*');
  assert.equal(montarConsultaFts("de a o"), null);
  assert.doesNotThrow(() => pesquisar(acervoDeTeste(), { consulta: 'NEAR( * ) "' }));
});

test("pesquisar prioriza precedente qualificado e oculta cancelados", () => {
  const a = acervoDeTeste();
  const r = pesquisar(a, { consulta: "dano moral inscrição indevida cadastro" });
  assert.equal(r.resultados[0].id, "STJ-Tema-922");
  assert.ok(!r.resultados.some((x) => x.id === "STJ-Tema-1"));
  const comCancelados = pesquisar(a, { consulta: "dano moral inscrição indevida cadastro", incluir_cancelados: true });
  assert.ok(comCancelados.resultados.some((x) => x.id === "STJ-Tema-1"));
  const soB = pesquisar(a, { consulta: "dano moral", autoridade_minima: "B" });
  assert.ok(soB.resultados.every((x) => x.autoridade <= "B"));
});

test("interpretarCitacao reconhece formatos usuais", () => {
  assert.deepEqual(interpretarCitacao("REsp 1.990.285/SP"), { tipo: "processo", classe: "REsp", numero: "1990285" });
  assert.deepEqual(interpretarCitacao("AgInt no AREsp n. 2.123.456/RJ")?.classe, "AgInt no AREsp");
  assert.deepEqual(interpretarCitacao("Tema Repetitivo 988"), { tipo: "precedente", numero: "988", tribunal: "STJ", classe: "Tema" });
  assert.deepEqual(interpretarCitacao("Súmula Vinculante nº 13"), { tipo: "precedente", classe: "SV", numero: "13", tribunal: "STF" });
  assert.deepEqual(interpretarCitacao("Súmula 385/STJ"), { tipo: "precedente", classe: "Súmula", numero: "385", tribunal: "STJ" });
  assert.deepEqual(interpretarCitacao("Súmula nº 331 do TST"), { tipo: "precedente", classe: "Súmula", numero: "331", tribunal: "TST" });
  assert.deepEqual(interpretarCitacao("Tema 1.046 da Repercussão Geral"), { tipo: "precedente", classe: "Tema", numero: "1046", tribunal: "STF" });
  assert.deepEqual(interpretarCitacao("Tema 1046/STF"), { tipo: "precedente", classe: "Tema", numero: "1046", tribunal: "STF" });
  assert.deepEqual(interpretarCitacao("IRDR 62/TJSP"), { tipo: "precedente", classe: "IRDR", numero: "62", tribunal: "TJSP" });
  assert.deepEqual(interpretarCitacao("ADI 5.766"), { tipo: "precedente", classe: "ADI", numero: "5766", tribunal: "STF" });
  assert.equal(interpretarCitacao("0025207-95.2016.8.19.0208")?.tipo, "cnj");
  assert.equal(interpretarCitacao("conforme a doutrina"), null);
});

test("verificarCitacao confirma, diverge e não encontra", () => {
  const a = acervoDeTeste();
  assert.equal(verificarCitacao(a, "REsp 1.990.285/SP").status, "CONFIRMADO");
  assert.equal(verificarCitacao(a, "REsp 1.990.285/SP", "Min. Nancy Andrighi").status, "DIVERGENCIA");
  assert.equal(verificarCitacao(a, "REsp 1.990.285/SP", "Ministro Moura Ribeiro").status, "CONFIRMADO");
  assert.equal(verificarCitacao(a, "AREsp 1.990.285").status, "DIVERGENCIA");
  assert.equal(verificarCitacao(a, "REsp 7.777.777").status, "NAO_ENCONTRADO");
  assert.equal(verificarCitacao(a, "Tema 922/STJ").status, "CONFIRMADO");
});

test("número CNJ: dígito verificador e tribunal", () => {
  assert.ok(cnjValido("0025207-95.2016.8.19.0208"));
  assert.ok(!cnjValido("0025207-96.2016.8.19.0208"));
  assert.equal(formatarCnj("00252079520168190208"), "0025207-95.2016.8.19.0208");
  assert.equal(aliasTribunal("00252079520168190208"), "tjrj");
  assert.equal(aliasTribunal("00000000020248260000"), "tjsp");
  assert.equal(aliasTribunal("00000000020244030000"), "trf3");
  assert.equal(aliasTribunal("00000000020245020000"), "trt2");
  assert.equal(aliasTribunal("00000000020245000000"), "tst");
  assert.equal(aliasTribunal("00000000020246070000"), "tre-df");
});

test("interpretarSru extrai registros do LexML", () => {
  const xml = `<srw:searchRetrieveResponse xmlns:srw="x"><srw:numberOfRecords>1</srw:numberOfRecords><srw:records><srw:record>
    <srw:recordData><srw_dc:dc><urn>urn:lex:br:federal:lei:2018-08-14;13709</urn><dc:title>Lei nº 13.709, de 14 de Agosto de 2018</dc:title>
    <dc:description>Lei Geral de Proteção de Dados Pessoais (LGPD).</dc:description><dc:date>2018-08-14</dc:date><tipoDocumento>Lei</tipoDocumento>
    </srw_dc:dc></srw:recordData></srw:record></srw:records></srw:searchRetrieveResponse>`;
  const r = interpretarSru(xml);
  assert.equal(r.total, 1);
  assert.equal(r.normas[0].titulo, "Lei nº 13.709, de 14 de Agosto de 2018");
  assert.equal(r.normas[0].url, "https://www.lexml.gov.br/urn/urn:lex:br:federal:lei:2018-08-14;13709");
});

test("Cota bloqueia após o limite mensal", () => {
  const c = new Cota(2);
  const d = new Date("2026-10-01");
  c.consumir("k", d);
  c.consumir("k", d);
  assert.throws(() => c.consumir("k", d), /Cota mensal/);
  assert.doesNotThrow(() => c.consumir("k", new Date("2026-11-01")));
  assert.doesNotThrow(() => new Cota(0).consumir("k"));
});
