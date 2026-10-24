import { test } from "node:test";
import assert from "node:assert/strict";
import { Acervo, type Documento } from "../src/db.js";
import { pesquisar } from "../src/search.js";
import { normalizar, type Embedder } from "../src/embeddings.js";
import { vetorizarPendentes } from "../src/vetorizar.js";
import { pesquisarAoVivo, selecionarFontes } from "../src/federado.js";
import type { FonteAoVivo } from "../src/fontes/tipos.js";

/** Embedder falso: um eixo por conceito, com sinônimos mapeados para o mesmo eixo. */
const CONCEITOS: string[][] = [
  ["negativacao", "inscricao", "cadastro", "spc", "serasa", "inadimplentes"],
  ["licitacao", "pregao", "contratacao", "edital"],
  ["tributo", "icms", "imposto", "pis", "cofins"],
];
const fake: Embedder = {
  id: "fake:3",
  dimensoes: 3,
  async vetorizar(textos) {
    return textos.map((t) => {
      const palavras = t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/\W+/);
      return normalizar(Float32Array.from(CONCEITOS.map((c) => palavras.filter((p) => c.includes(p)).length + 0.01)));
    });
  },
};

function doc(id: string, ementa: string, extra: Partial<Documento> = {}): Documento {
  return {
    id, tribunal: "TJSP", tipo: "acordao", classe: "Apelação", numero: id, registro: null, orgao: null, relator: null,
    data_julgamento: "2025-01-01", data_publicacao: null, autoridade: "D", situacao: null, titulo: `Apelação ${id}`,
    ementa, tese: null, inteiro_teor: null, referencias: null, assuntos: null, fonte: "teste", fonte_url: null,
    atualizado_em: "2026-01-01", ...extra,
  };
}

test("busca híbrida acha documento sem palavra em comum com a consulta", async () => {
  const a = new Acervo(":memory:");
  a.salvar([
    doc("1", "Apontamento do nome do consumidor no SPC e Serasa sem notificação prévia."),
    doc("2", "Pregão eletrônico. Desclassificação de proposta."),
    doc("3", "ICMS sobre energia elétrica. Base de cálculo."),
  ]);
  a.prepararVetores(fake.id, fake.dimensoes);
  assert.equal(await vetorizarPendentes(a, fake), 3);
  assert.equal(a.contarVetores(), 3);

  const consulta = "negativação indevida";
  assert.equal(pesquisar(a, { consulta, usar_sinonimos: false }).resultados.length, 0, "sem vetores nem sinônimos, a via lexical não acha nada");
  assert.equal(pesquisar(a, { consulta }).resultados[0]?.id, "1", "os sinônimos (negativação = SPC/Serasa) acham pela via lexical");
  const [vetor] = await fake.vetorizar([consulta], "consulta");
  const r = pesquisar(a, { consulta }, { vetorConsulta: vetor });
  assert.equal(r.modo, "hibrido");
  assert.equal(r.resultados[0].id, "1");
  // filtros também valem para a via vetorial
  assert.equal(pesquisar(a, { consulta, tribunais: ["TJMG"] }, { vetorConsulta: vetor }).resultados.length, 0);
});

test("trocar de modelo exige recriar o índice", () => {
  const a = new Acervo(":memory:");
  a.prepararVetores("m1:3", 3);
  assert.throws(() => a.prepararVetores("m2:3", 3), /recriar/);
  assert.doesNotThrow(() => a.prepararVetores("m2:4", 4, true));
});

const fonte = (id: string, tribunais: string[], padrao: boolean, impl: FonteAoVivo["pesquisar"]): FonteAoVivo => ({
  id, nome: id, tribunais, padrao, pesquisar: impl,
});

test("selecionarFontes respeita filtro de tribunal e fontes padrão", () => {
  const fs = [fonte("esaj", ["TJSP", "TJMS"], false, async () => []), fonte("tcu", ["TCU"], true, async () => [])];
  assert.deepEqual(selecionarFontes(fs, ["tjsp"]).map((s) => [s.fonte.id, s.tribunais]), [["esaj", ["TJSP"]]]);
  assert.deepEqual(selecionarFontes(fs).map((s) => s.fonte.id), ["tcu"]);
  assert.deepEqual(selecionarFontes(fs, ["STJ"]), []);
});

test("pesquisarAoVivo grava resultados e isola falhas", async () => {
  const a = new Acervo(":memory:");
  const fs = [
    fonte("ok", ["TJSP"], true, async (f) => [doc("V1", `Resultado ao vivo para ${f.consulta}`)]),
    fonte("quebrada", ["TJMG"], true, async () => {
      throw new Error("HTTP 503");
    }),
    fonte("lenta", ["TJRS"], true, (_f, ctx) => new Promise((_, rej) => ctx.signal.addEventListener("abort", () => rej(ctx.signal.reason)))),
  ];
  const rel = await pesquisarAoVivo(a, fs, { consulta: "usucapião" }, { timeoutMs: 50 });
  assert.deepEqual(rel.map((r) => r.status), ["ok", "erro", "tempo_esgotado"]);
  assert.ok(a.obter("V1"));
  assert.equal(pesquisar(a, { consulta: "usucapião" }).resultados[0].id, "V1");
});
