import { test } from "node:test";
import assert from "node:assert/strict";
import { extrairTrechos } from "../src/historico.js";
import { leisAlteradoras } from "../src/legislacao/indice.js";
import { normaPorNumero } from "../src/legislacao/catalogo.js";

test("leisAlteradoras lê as notas de redação, da mais recente para a mais antiga", () => {
  const texto = "Art. 54-A. Este Capítulo dispõe...\nNotas: (Artigo acrescido pela Lei nº 14.181, de 1/7/2021) (Parágrafo com redação dada pela Lei nº 15.000, de 3/2/2025)";
  assert.deepEqual(leisAlteradoras(texto), ["Lei nº 15.000/2025", "Lei nº 14.181/2021"]);
  assert.deepEqual(leisAlteradoras("Art. 1º Texto original."), []);
  // formato real da Câmara: dia com "º" e quebra de linha na nota
  assert.deepEqual(leisAlteradoras("Art. 54-A. Texto.\nNotas: (Artigo\nacrescido pela Lei nº 14.181, de 1º/7/2021)"), ["Lei nº 14.181/2021"]);
  assert.equal(normaPorNumero("Lei nº 14.181/2021")?.sigla, "LEI-14181-2021");
  assert.equal(normaPorNumero("EC 103/2019")?.sigla, "EMC-103-2019");
  assert.equal(normaPorNumero("Emenda Constitucional nº 103, de 2019")?.tipo, "EMC");
});

test("extrairTrechos: seção de justificação/análise ou menções ao dispositivo", () => {
  const projeto = "PROJETO DE LEI Art. 1º Altera o CDC. Art. 54-A. Este capítulo trata do superendividamento. JUSTIFICAÇÃO O superendividamento é fenômeno social grave.";
  assert.match(extrairTrechos(projeto, "justificacao")[0], /^JUSTIFICAÇÃO O superendividamento/);
  // menção ao artigo só conta dentro da justificação, não na redação transcrita
  assert.match(extrairTrechos(projeto, "justificacao", "art. 54-A")[0], /^JUSTIFICAÇÃO O superendividamento/);
  const comMencao = extrairTrechos(projeto + " O art. 54-A define o conceito central.", "justificacao", "art. 54-A");
  assert.match(comMencao[0], /O art\. 54-A define o conceito central/);
  // parecer sem o título "Análise": a menção em prosa é encontrada; a transcrição, não
  const ccj = "PARECER “Art. 477-A. As dispensas imotivadas...” Relatório. A inclusão do art. 477-A na CLT equipara as dispensas coletivas.";
  const r = extrairTrechos(ccj, "parecer", "art. 477-A");
  assert.equal(r.length, 1);
  assert.match(r[0], /A inclusão do art\. 477-A na CLT/);
  // "art. 54" sem letra não deve casar com "art. 54-A"
  assert.match(extrairTrechos("Texto. Art. 54-A. X.", "parecer", "art. 54")[0], /^Texto/);
  const parecer = "SENADO FEDERAL I – RELATÓRIO Trata-se do projeto. II – ANÁLISE A proposição é constitucional.";
  assert.match(extrairTrechos(parecer, "parecer")[0], /^II – ANÁLISE A proposição/);
  assert.match(extrairTrechos("EXPOSIÇÃO DE MOTIVOS Senhor Presidente, submeto...", "justificacao")[0], /^EXPOSIÇÃO DE MOTIVOS/);
});
