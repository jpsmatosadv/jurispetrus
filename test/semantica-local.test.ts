import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Acervo, type Documento } from "../src/db.js";
import { normalizar, type Embedder } from "../src/embeddings.js";
import { LocalEmbedder, modeloLocalPresente } from "../src/embeddings-local.js";
import { vetorizarEmSegundoPlano } from "../src/vetorizar-fundo.js";
import { pesquisar } from "../src/search.js";

function doc(id: string, ementa: string): Documento {
  return {
    id, tribunal: "TJSP", tipo: "acordao", classe: "Apelação", numero: id, registro: null, orgao: null, relator: null,
    data_julgamento: "2025-01-01", data_publicacao: null, autoridade: "D", situacao: null, titulo: `Apelação ${id}`,
    ementa, tese: null, inteiro_teor: null, referencias: null, assuntos: null, fonte: "teste", fonte_url: null, atualizado_em: "2026-01-01",
  };
}

const falso = (id = "local:falso:3"): Embedder => ({
  id,
  dimensoes: 3,
  async vetorizar(textos) {
    return textos.map((t) => normalizar(Float32Array.from([t.length % 7, 1, 2])));
  },
});

test("vetorização em segundo plano: cria o índice, completa o que falta e respeita a trava", async () => {
  const pasta = mkdtempSync(join(tmpdir(), "juris-"));
  const a = new Acervo(join(pasta, "a.db"));
  a.salvar([doc("1", "Inscrição indevida."), doc("2", "Pregão eletrônico."), doc("3", "Usucapião.")]);
  if (!a.vetoresDisponiveis) return; // Node sem sqlite-vec: nada a testar
  const trava = join(pasta, "a.db.vetorizando");

  writeFileSync(trava, String(process.pid)); // outra cópia (viva) vetorizando
  assert.equal(await vetorizarEmSegundoPlano(a, falso(), { trava, log: () => {} }), 0);

  writeFileSync(trava, "999999999"); // trava de processo que já terminou
  assert.equal(await vetorizarEmSegundoPlano(a, falso(), { trava, log: () => {} }), 3);
  assert.equal(existsSync(trava), false, "libera a trava ao terminar");
  assert.equal(a.modeloVetorial, "local:falso:3");
  assert.equal(a.estatisticas().busca_semantica?.documentos_sem_vetor, 0);

  a.salvar([doc("4", "Plano de saúde.")]);
  assert.equal(await vetorizarEmSegundoPlano(a, falso(), { trava, log: () => {} }), 1, "só o documento novo");

  // índice de outro modelo (ex.: Voyage) é recriado para o modelo local
  assert.equal(await vetorizarEmSegundoPlano(a, falso("local:outro:3"), { trava, log: () => {} }), 4);
  assert.equal(a.modeloVetorial, "local:outro:3");
});

test("modelo local real: aproxima ementas pelo significado", { skip: !modeloLocalPresente() && "modelo não baixado (npm run modelo)" }, async () => {
  const e = new LocalEmbedder();
  const docs = [
    "Inscrição do nome do consumidor em cadastro de inadimplentes por dívida inexistente. Dano moral presumido.",
    "Pregão eletrônico. Desclassificação de proposta.",
    "Os bens dominicais, como os demais bens públicos, não podem ser adquiridos por usucapião.",
  ];
  const [q1, q2] = await e.vetorizar(["negativação indevida do nome do consumidor", "usucapião de terreno da prefeitura"], "consulta");
  const dv = await e.vetorizar(docs, "documento");
  const melhor = (q: Float32Array) => dv.map((v) => v.reduce((s, x, k) => s + x * q[k], 0)).reduce((m, x, i, arr) => (x > arr[m] ? i : m), 0);
  assert.equal(melhor(q1), 0);
  assert.equal(melhor(q2), 2);

  const a = new Acervo(":memory:");
  if (!a.vetoresDisponiveis) return;
  a.salvar(docs.map((t, i) => doc(String(i), t)));
  a.prepararVetores(e.id, e.dimensoes);
  a.salvarVetores([...a.rowids(["0", "1", "2"]).entries()].map(([id, rowid]) => ({ rowid, vetor: dv[Number(id)] })));
  const r = pesquisar(a, { consulta: "terreno da prefeitura", usar_sinonimos: false }, { vetorConsulta: (await e.vetorizar(["terreno da prefeitura"], "consulta"))[0] });
  assert.equal(r.modo, "hibrido");
  assert.equal(r.resultados[0].id, "2", "acha sem palavra em comum");
});
