import { test } from "node:test";
import assert from "node:assert/strict";
import { Acervo } from "../src/db.js";
import { resolverNorma } from "../src/legislacao/catalogo.js";
import {
  interpretarCitacaoLegal,
  normalizarArtigo,
  obterDispositivo,
  pesquisarDispositivos,
  salvarNorma,
} from "../src/legislacao/indice.js";

test("resolverNorma entende siglas, apelidos e números", () => {
  assert.equal(resolverNorma("CDC")?.sigla, "CDC");
  assert.equal(resolverNorma("Código Civil")?.sigla, "CC");
  assert.equal(resolverNorma("Lei 8.078/90")?.sigla, "CDC");
  assert.equal(resolverNorma("Constituição Federal")?.sigla, "CF");
  assert.equal(resolverNorma("lei 14.133")?.sigla, "LLC");
  assert.equal(resolverNorma("xyz"), undefined);
});

test("interpretarCitacaoLegal reconhece as formas usuais", () => {
  assert.deepEqual(interpretarCitacaoLegal("art. 186 do CC"), { norma: "CC", artigo: "186" });
  assert.deepEqual(interpretarCitacaoLegal("CDC, art. 14"), { norma: "CDC", artigo: "14" });
  assert.deepEqual(interpretarCitacaoLegal("artigo 5º, X, da Constituição Federal"), { norma: "CF", artigo: "5" });
  assert.deepEqual(interpretarCitacaoLegal("art. 1.022 do Código de Processo Civil"), { norma: "CPC", artigo: "1022" });
  assert.deepEqual(interpretarCitacaoLegal("art. 121-A do CP"), { norma: "CP", artigo: "121-A" });
  assert.equal(interpretarCitacaoLegal("dano moral"), null);
  assert.equal(normalizarArtigo("1.022"), "1022");
});

test("índice de dispositivos: grava, busca e marca revogados", () => {
  const a = new Acervo(":memory:");
  salvarNorma(a, { sigla: "CDC", nome: "Código de Defesa do Consumidor", fonte: "teste" }, [
    { artigo: "14", ordem: 1, rotulo: "Art. 14", caminho: "Seção II - Da Responsabilidade pelo Fato do Produto e do Serviço",
      texto: "Art. 14. O fornecedor de serviços responde, independentemente da existência de culpa, pela reparação dos danos causados aos consumidores por defeitos relativos à prestação dos serviços.", revogado: 0, fonte_url: null },
    { artigo: "43", ordem: 2, rotulo: "Art. 43", caminho: "Seção VI - Dos Bancos de Dados e Cadastros de Consumidores",
      texto: "Art. 43. O consumidor terá acesso às informações existentes em cadastros. § 2º A abertura de cadastro deverá ser comunicada por escrito ao consumidor.", revogado: 0, fonte_url: null },
    { artigo: "99", ordem: 3, rotulo: "Art. 99", caminho: null, texto: "Art. 99. (Revogado).", revogado: 1, fonte_url: null },
  ]);
  assert.equal(obterDispositivo(a, "CDC", "14")?.rotulo, "Art. 14");
  const r = pesquisarDispositivos(a, "comunicação ao consumidor da abertura de cadastro");
  assert.equal(r[0].id, "CDC-art-43");
  assert.equal(pesquisarDispositivos(a, "revogado").length, 0);
  assert.equal(pesquisarDispositivos(a, "revogado", { incluirRevogados: true })[0].revogado, true);
  // reimportar a norma substitui a versão anterior
  salvarNorma(a, { sigla: "CDC", nome: "Código de Defesa do Consumidor", fonte: "teste" }, [
    { artigo: "14", ordem: 1, rotulo: "Art. 14", caminho: null, texto: "Art. 14. Nova redação.", revogado: 0, fonte_url: null },
  ]);
  assert.equal(obterDispositivo(a, "CDC", "43"), undefined);
});
