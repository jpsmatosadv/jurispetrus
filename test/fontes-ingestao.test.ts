import { test } from "node:test";
import assert from "node:assert/strict";
import { Acervo } from "../src/db.js";
import { mapearPrecedente, siglaTribunal } from "../src/ingest/bnp.js";
import { corrigirMojibake, lerTabelaRg } from "../src/ingest/stf.js";
import { verificarCitacao } from "../src/citation.js";

test("BNP: súmula vinculante usa o enunciado de 'questao' e vale como A", () => {
  const d = mapearPrecedente({
    id: "stf-sv-13", orgao: "STF", tipo: "SV", nr: 13, tese: "não informado", situacao: "APROVADO",
    questao: "A nomeação de cônjuge, companheiro ou parente ... viola a Constituição Federal.",
  })!;
  assert.equal(d.id, "BNP-STF-SV-13");
  assert.equal(d.titulo, "Súmula Vinculante 13/STF");
  assert.equal(d.autoridade, "A");
  assert.match(d.tese!, /nomeação de cônjuge/);
});

test("BNP: IRDR de TJ é B; sem tese vira E; STJ repetitivo é ignorado (vem do STJ)", () => {
  const base = { id: "tjsp-irdr-62", orgao: "TJSP", tipo: "IRDR", nr: 62, questao: "Habilitação de herdeiros no cumprimento de sentença." };
  assert.equal(mapearPrecedente({ ...base, tese: "<p>É cabível ...</p>" })!.autoridade, "B");
  assert.equal(mapearPrecedente({ ...base, tese: "<p>É cabível ...</p>" })!.tese, "É cabível ...");
  assert.equal(mapearPrecedente(base)!.autoridade, "E");
  assert.equal(mapearPrecedente({ id: "stj-rr-1", orgao: "STJ", tipo: "RR", nr: 1, tese: "x" }), null);
  assert.equal(mapearPrecedente({ id: "trf01-sum-1", orgao: "TRF01", tipo: "SUM", nr: 1, tese: "y" })!.tribunal, "TRF1");
  assert.equal(siglaTribunal("TRT02"), "TRT2");
});

test("STF: lê a exportação de repercussão geral e corrige mojibake", () => {
  assert.equal(corrigirMojibake("NÃ£o hÃ¡"), "Não há");
  assert.equal(corrigirMojibake("Ação"), "Ação");
  const html = `<table><tr><th>Tema</th></tr><tr>
    <td>1046</td><td>ARE 1121633</td><td>MIN. GILMAR MENDES</td><td>Validade de norma coletiva</td>
    <td>Recurso em que se discute...</td><td>Recurso em que se discute...</td><td>M</td><td>A</td><td>-</td>
    <td>HÃ¡</td><td>02/06/2022</td><td>Trânsito em Julgado</td>
    <td>São constitucionais os acordos e as convenções coletivos...</td><td>02/06/2022</td><td></td></tr></table>`;
  const [d] = lerTabelaRg(html);
  assert.equal(d.id, "BNP-STF-RG-1046");
  assert.equal(d.relator, "GILMAR MENDES");
  assert.equal(d.data_julgamento, "2022-06-02");
  assert.match(d.situacao!, /Repercussão geral: Há/);

  const a = new Acervo(":memory:");
  a.salvar([d, mapearPrecedente({ id: "stj-sum-1046", orgao: "STJ", tipo: "SUM", nr: 1046, tese: "z" })!]);
  assert.equal(verificarCitacao(a, "Tema 1046 da Repercussão Geral", "Min. Gilmar Mendes").status, "CONFIRMADO");
  assert.equal(verificarCitacao(a, "Súmula 1046/STJ").status, "CONFIRMADO");
  assert.equal(verificarCitacao(a, "Súmula 1046/STF").status, "NAO_ENCONTRADO");
});
