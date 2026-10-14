import { test } from "node:test";
import assert from "node:assert/strict";
import { extrairEstrutura, temInteiroTeorBaixavel } from "../src/ratio.js";

const EMENTA_CNJ = `DIREITO DO CONSUMIDOR. APELAÇÃO CÍVEL. NEGATIVAÇÃO INDEVIDA. I. CASO EM EXAME 1. Apelação contra sentença que declarou inexistente o débito. II. QUESTÃO EM DISCUSSÃO 2. A questão em discussão consiste em saber se a instituição comprovou a contratação. III. RAZÕES DE DECIDIR 3. Cabe ao fornecedor provar a contratação (CPC, art. 373, II). 4. A negativação por dívida inexistente gera dano moral in re ipsa. IV. DISPOSITIVO E TESE 5. Recurso desprovido. Tese de julgamento: 1. Telas sistêmicas unilaterais não provam a contratação. 2. A inscrição indevida em cadastro de inadimplentes gera dano moral presumido. Dispositivos relevantes citados: CPC, art. 373, II; CDC, art. 14. Jurisprudência relevante citada: STJ, Súmula 385.`;

test("extrai as seções da ementa padrão do CNJ", () => {
  const e = extrairEstrutura({ ementa: EMENTA_CNJ, tese: null, tipo: "acordao" });
  assert.equal(e.metodo, "ementa_padrao_cnj");
  assert.match(e.caso_em_exame!, /^1\. Apelação/);
  assert.match(e.questoes_em_discussao!, /comprovou a contratação/);
  assert.match(e.razoes_de_decidir!, /dano moral in re ipsa/);
  assert.match(e.dispositivo!, /Recurso desprovido/);
  assert.equal(e.teses.length, 2);
  assert.match(e.teses[1], /^A inscrição indevida/);
  assert.equal(e.dispositivos_citados, "CPC, art. 373, II; CDC, art. 14.");
  assert.equal(e.jurisprudencia_citada, "STJ, Súmula 385.");
});

test("precedente qualificado usa a tese firmada; ementa comum fica sem estrutura", () => {
  const t = extrairEstrutura({ ementa: "Questão submetida", tese: "A inscrição indevida...", tipo: "precedente_qualificado" });
  assert.equal(t.metodo, "tese_firmada");
  assert.deepEqual(t.teses, ["A inscrição indevida..."]);
  assert.equal(extrairEstrutura({ ementa: "APELAÇÃO. DANO MORAL. RECURSO PROVIDO.", tese: null, tipo: "acordao" }).metodo, "sem_estrutura");
});

test("reconhece portais com inteiro teor em HTML", () => {
  assert.ok(temInteiroTeorBaixavel("https://eproc2g.tjsp.jus.br/eproc/externo_controlador.php?acao=jurisprudencia@jurisprudencia/download_inteiro_teor&id_jurisprudencia=1"));
  assert.ok(temInteiroTeorBaixavel("https://jurisprudenciaws.tjba.jus.br/inteiroTeor/abc"));
  assert.ok(!temInteiroTeorBaixavel("https://esaj.tjac.jus.br/cjsg/getArquivo.do?cdAcordao=1"));
});
