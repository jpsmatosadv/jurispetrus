import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Acervo, type Documento } from "../src/db.js";
import { chaveDoJulgado, montarConsultaFts, pesquisar } from "../src/search.js";
import { expandirSinonimos } from "../src/sinonimos.js";
import { criarServidor } from "../src/server.js";
import type { AnalistaIA, Triagem } from "../src/ia.js";

function doc(id: string, ementa: string, extra: Partial<Documento> = {}): Documento {
  return {
    id, tribunal: "TJSP", tipo: "acordao", classe: "Apelação", numero: id, registro: null, orgao: "1ª Câmara", relator: null,
    data_julgamento: "2025-01-01", data_publicacao: null, autoridade: "D", situacao: null, titulo: `Apelação ${id}`,
    ementa, tese: null, inteiro_teor: null, referencias: null, assuntos: null, fonte: "teste", fonte_url: null,
    atualizado_em: "2026-01-01", ...extra,
  };
}

test("sinônimos: expressões equivalentes entram como proximidade com radical", () => {
  const extras = expandirSinonimos("Negativação indevida e dano moral");
  assert.ok(extras.includes("inscricao indevida"));
  assert.ok(extras.includes("cadastro de inadimplentes"));
  assert.ok(!extras.includes("negativacao"), "não repete o que já está na consulta");
  assert.deepEqual(expandirSinonimos("usucapião extraordinária"), ["prescricao aquisitiva"]);
  assert.deepEqual(expandirSinonimos("contrato de locação comercial"), []);
  const fts = montarConsultaFts("negativação", ["cadastro de inadimplentes"])!;
  assert.match(fts, /NEAR\(cadastr\* inadimplent\*, 3\)/);
});

test("consultas alternativas: o julgado achado por várias formulações sobe", () => {
  const a = new Acervo(":memory:");
  a.salvar([
    doc("1", "Inscrição indevida em cadastro de inadimplentes. Dano moral presumido."),
    doc("2", "Dano moral. Ofensa à honra em rede social. Dano moral configurado. Dano moral."),
  ]);
  const so = pesquisar(a, { consulta: "dano moral", usar_sinonimos: false, relevancia_minima: 0 });
  assert.equal(so.resultados[0].id, "2");
  const varias = pesquisar(a, {
    consulta: "dano moral",
    consultas_alternativas: ["inscrição indevida cadastro de inadimplentes", "dano moral presumido negativação"],
    relevancia_minima: 0,
  });
  assert.equal(varias.consultas, 3);
  assert.equal(varias.resultados[0].id, "1");
});

test("relevância mínima descarta o que só coincide numa palavra, mesmo com autoridade alta", () => {
  const a = new Acervo(":memory:");
  a.salvar([
    doc("1", "Plano de saúde. Negativa de cobertura de tratamento oncológico. Abusividade. Dano moral."),
    doc("S", "Súmula sobre honorários e dano em execução fiscal.", { tipo: "sumula", classe: "Súmula", numero: "999", autoridade: "A", tribunal: "STJ" }),
  ]);
  const r = pesquisar(a, { consulta: "plano de saúde negativa de cobertura tratamento oncológico dano" });
  assert.deepEqual(r.resultados.map((x) => x.id), ["1"]);
  assert.equal(r.descartados_por_baixa_relevancia, 1);
  assert.equal(pesquisar(a, { consulta: "plano de saúde negativa de cobertura tratamento oncológico dano", relevancia_minima: 0 }).resultados.length, 2);
});

test("duplicatas: o mesmo julgado de duas fontes aparece uma vez, com as outras fontes indicadas", () => {
  const ementa = "APELAÇÃO. INSCRIÇÃO INDEVIDA EM CADASTRO DE INADIMPLENTES. DANO MORAL CONFIGURADO.";
  const a = new Acervo(":memory:");
  a.salvar([
    doc("BNP-1", ementa, { numero: "1008794-91.2017.8.26.0100", fonte: "bnp" }),
    doc("TJSP-1", ementa.toLowerCase(), { numero: "10087949120178260100", fonte: "portal", autoridade: "D" }),
    doc("TJSP-2", "EMBARGOS DE DECLARAÇÃO. Inscrição indevida. Omissão inexistente.", { numero: "1008794-91.2017.8.26.0100", classe: "Embargos de Declaração" }),
  ]);
  const r = pesquisar(a, { consulta: "inscrição indevida" });
  assert.equal(r.resultados.length, 2, "embargos no mesmo processo são outro julgado");
  assert.equal(r.duplicatas_agrupadas, 1);
  const principal = r.resultados.find((x) => x.id === "BNP-1" || x.id === "TJSP-1")!;
  assert.equal(principal.outras_fontes?.length, 1);
  assert.equal(
    chaveDoJulgado({ tribunal: "TST", classe: "OJ", numero: "1", registro: null, titulo: "OJ 1", orgao: "SDI-1", data_julgamento: null, ementa: "X", tese: null }) ===
      chaveDoJulgado({ tribunal: "TST", classe: "OJ", numero: "1", registro: null, titulo: "OJ 1", orgao: "SDI-2", data_julgamento: null, ementa: "X", tese: null }),
    false,
    "OJs de mesmo número em órgãos diferentes não se juntam",
  );
});

async function conectar(acervo: Acervo, analista: AnalistaIA | null) {
  const server = criarServidor(acervo, { analista, fontes: [] });
  const [x, y] = InMemoryTransport.createLinkedPair();
  await server.connect(x);
  const client = new Client({ name: "teste", version: "1" });
  await client.connect(y);
  return async (args: Record<string, unknown>) =>
    JSON.parse(((await client.callTool({ name: "pesquisar_jurisprudencia", arguments: args })).content as { text: string }[])[0].text);
}

function acervoTriagem() {
  const a = new Acervo(":memory:");
  a.salvar([
    doc("A", "Negativação indevida. Dívida inexistente. Dano moral in re ipsa."),
    doc("B", "Negativação. Anotação preexistente legítima. Súmula 385. Dano moral afastado."),
    doc("C", "Negativação de crédito tributário em conta gráfica de ICMS."),
    // documentos de outros temas, para o peso das palavras (IDF) ser realista
    ...Array.from({ length: 20 }, (_, i) => doc(`X${i}`, `Locação comercial. Revisão do aluguel. Perícia ${i}.`)),
  ]);
  return a;
}

test("triagem sem IA: devolve os candidatos resumidos e a instrução para o Claude escolher", async () => {
  const call = await conectar(acervoTriagem(), null);
  const r = await call({ consulta: "negativação indevida", triagem: true, contexto: "Negativação por dívida que o cliente não contraiu" });
  assert.equal(r.triagem.feita_por, "voce");
  assert.match(r.triagem.instrucao, /Negativação por dívida/);
  assert.ok(r.resultados.length >= 3);
  assert.ok(r.resultados.every((x: { texto: string }) => typeof x.texto === "string"));
});

test("triagem com IA: reordena por pertinência e descarta os sem pertinência", async () => {
  let recebidos: string[] = [];
  const analista = {
    modelo: "modelo-de-teste",
    async triar(_q: string, cands: { id: string }[]): Promise<Triagem> {
      recebidos = cands.map((c) => c.id);
      return {
        avaliacoes: [
          { id: "C", pertinencia: "nenhuma", motivo: "Trata de ICMS." },
          { id: "B", pertinencia: "alta", motivo: "Mesma questão." },
          { id: "A", pertinencia: "media", motivo: "Conexa." },
        ],
      };
    },
  } as unknown as AnalistaIA;
  const call = await conectar(acervoTriagem(), analista);
  const r = await call({ consulta: "negativação indevida", triagem: true, limite: 5 });
  assert.deepEqual(recebidos.sort(), ["A", "B", "C"]);
  assert.deepEqual(r.resultados.map((x: { id: string }) => x.id), ["B", "A"]);
  assert.equal(r.resultados[0].pertinencia, "alta");
  assert.equal(r.triagem.descartados_sem_pertinencia, 1);
});
