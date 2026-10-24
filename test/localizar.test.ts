import { test } from "node:test";
import assert from "node:assert/strict";
import { candidatosCnj, corrigirDv, digitoVerificador, numeroIncompleto } from "../src/cnj.js";
import { localizarJulgado, julgadoCorrespondente } from "../src/localizar.js";
import { interpretarProcesso } from "../src/classes.js";
import { ementaDoDocumento } from "../src/fontes/stj-processo.js";

test("CNJ: DV corrigido e número incompleto com candidatos", () => {
  assert.equal(digitoVerificador("0001083", "20168050000"), "80");
  assert.equal(corrigirDv("0001083-81.2016.8.05.0000"), "00010838020168050000");
  assert.equal(corrigirDv("0001083-80.2016.8.05.0000"), null, "DV certo não tem correção");
  const c = candidatosCnj("249120198130303").map((x) => x.formatado);
  assert.deepEqual(c, ["0002491-43.2019.8.13.0303", "0000024-91.2019.8.13.0303"]);
  assert.equal(numeroIncompleto("TJMG 249120198130303"), "249120198130303");
  assert.equal(numeroIncompleto("AC 70057637488"), null, "numeração antiga do TJRS não tem estrutura CNJ");
  assert.deepEqual(candidatosCnj("249120198990303"), [], "segmento/tribunal impossível");
});

// --- STF simulado -----------------------------------------------------------------------------
const DETALHE_STF = `<input type="hidden" id="incidente" value="4517353">
<div class="processo-classe p-t-8 p-l-16">AÇÃO DIRETA DE INCONSTITUCIONALIDADE</div>
<div class="processo-dados p-l-16">Relator(a): MIN. NUNES MARQUES</div>
Número Único: 9990482-67.2013.1.00.0000`;
const DECISOES_STF = `<div class="andamento-item" id="1"><div class="andamento-data">04/11/2025</div><h5 class="andamento-nome">Procedente</h5>
<span class="andamento-julgador badge bg-info">TRIBUNAL PLENO</span><div class="col-md-9 p-0">Decisão: O Tribunal julgou procedente o pedido. Plenário, Sessão Virtual de 24.10.2025 a 4.11.2025.</div></div>`;
const ANDAMENTOS_STF = `<div class="andamento-item"><div class="andamento-data">19/11/2025</div><h5 class="andamento-nome">Transitado(a) em julgado</h5></div>`;
const API_STF = {
  result: {
    hits: {
      hits: [
        { _source: { base: "acordaos", titulo: "ADI 5022", processo_numero: 5022, processo_classe_processual_unificada_classe_sigla: "ADI", julgamento_data: "2025-11-05", publicacao_data: "2025-11-11", orgao_julgador: "Tribunal Pleno", relator_processo_nome: "NUNES MARQUES", ementa_texto: "Ementa: DIREITO CONSTITUCIONAL.", inteiro_teor_url: "https://portal.stf.jus.br/x" } },
        { _source: { base: "acordaos", titulo: "ADI 5022 AgR", processo_numero: 5022, processo_classe_processual_unificada_classe_sigla: "ADI", processo_classe_processual_unificada_incidente_sigla: "AgR", julgamento_data: "2014-12-18", publicacao_data: "2015-03-09", orgao_julgador: "Tribunal Pleno", relator_processo_nome: "CELSO DE MELLO", ementa_texto: "E M E N T A: AMICUS CURIAE." } },
      ],
    },
  },
};
const stfFalso = (async (url: string) => {
  if (url.includes("jurisprudencia.stf.jus.br/api")) return Response.json(API_STF);
  if (url.includes("listarProcessos")) return new Response(url.includes("numeroProcesso=5022") ? DETALHE_STF : "<html></html>");
  if (url.includes("abaDecisoes")) return new Response(DECISOES_STF);
  if (url.includes("abaAndamentos")) return new Response(ANDAMENTOS_STF);
  if (url.includes("abaInformacoes")) return new Response("Assunto: DIREITO | Controle Data de Protocolo: 05/09/2013 Origem: DF Número de Origem: 5022");
  return new Response("", { status: 404 });
}) as typeof fetch;

test("STF: julgados separados por espécie, sessão virtual e data explicável", async () => {
  const r = await localizarJulgado(null, "ADI 5.022", { relator: "Min. Nunes Marques", data: "04/11/2025", fetchImpl: stfFalso });
  assert.equal(r.status, "CONFIRMADO");
  assert.equal(r.julgado_citado?.forma, "ADI 5022");
  assert.equal(r.julgado_citado?.especie, "merito");
  assert.deepEqual(r.julgado_citado?.sessao_virtual, { inicio: "2025-10-24", fim: "2025-11-04" });
  assert.equal(r.divergencias[0]?.motivo, "data_da_sessao_virtual");
  assert.equal(r.divergencias[0]?.explicavel, true);
  assert.equal(r.processos[0].transito_em_julgado, "2025-11-19");
  assert.equal(r.processos[0].julgados.find((j) => j.forma === "ADI 5022 AgR")?.especie, "agravo");

  const ed = await localizarJulgado(null, "ADI 5.022 ED", { fetchImpl: stfFalso });
  assert.equal(ed.status, "DIVERGENCIA");
  assert.equal(ed.divergencias[0].motivo, "julgado_de_outra_especie");

  const nada = await localizarJulgado(null, "ADI 99999", { fetchImpl: stfFalso });
  assert.equal(nada.status, "NAO_ENCONTRADO");
});

test("STF: fonte fora do ar é INDISPONIVEL, nunca NAO_ENCONTRADO", async () => {
  const fora = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
  const r = await localizarJulgado(null, "ADI 5.022", { fetchImpl: fora });
  assert.equal(r.status, "INDISPONIVEL");
  assert.equal(r.fontes_consultadas[0].status, "erro");
});

// --- STJ simulado -----------------------------------------------------------------------------
const PAGINA_STJ = `
<span class="classSpanDetalhesLabel">PROCESSO:</span><span class="classSpanDetalhesTexto">RECURSO ESPECIAL</span>
<span class="classSpanDetalhesLabel">NÚMERO ÚNICO: </span><span class="classSpanDetalhesTexto">0001140-03.2002.4.01.3600</span>
<span class="classSpanDetalhesLabel">RELATOR(A):</span><span class="classSpanDetalhesTexto">Min. ELIANA CALMON - SEGUNDA TURMA</span>
<span class="classSpanDetalhesLabel">AUTUAÇÃO:</span><span class="classSpanDetalhesTexto">17/12/2007</span>
<div id="idDivFases">
<span class="classSpanFaseData">02/03/2010</span><span class="classSpanFaseHora">18:00</span><span class="classSpanFaseTexto">Proclamação Final de Julgamento: "a Turma, por maioria, deu provimento, nos termos do voto do Sr. Ministro Castro Meira que lavrará o acórdão." REsp 1015133</span>
</div>
<div id="idDivDecisoes">
<span class="clsFaseDecisaoIntTeorRevistaLinhaTodosDocumentosPetClSgProc">REsp 1015133</span><span class="clsFaseDecisaoIntTeorRevistaLinhaTodosDocumentosRegistroData">(2007/0291526-7 de 23/04/2010)</span>
<span class="clsDecisoesIntTeorRevistaMinistroNome">- Min. ELIANA CALMON</span><span class="clsDecisoesIntTeorRevistaMinistroNome">- Min. CASTRO MEIRA</span>
<span class="clsDecisoesMonocraticasLinhaPetClSgProc">RE nos EDcl no REsp  1015133</span><span class="clsDecisoesMonocraticasLinhaRegistroData">(2007/0291526-7 - 06/12/2010)</span>
<span class="clsDecisoesMonocraticasLinhaMinistroNome">- Ministro FELIX FISCHER</span>
</div>`;
const stjFalso = (async (url: string) =>
  new Response(url.includes("REsp%201015133") ? PAGINA_STJ : "Nenhum registro encontrado!")) as typeof fetch;

test("STJ: relator originário × redator do acórdão e datas de julgamento e publicação", async () => {
  const r = await localizarJulgado(null, "REsp 1.015.133/MT", { relator: "Castro Meira", data: "23/04/2010", fetchImpl: stjFalso, ementas: 0 });
  assert.equal(r.status, "CONFIRMADO");
  assert.equal(r.julgado_citado?.relator, "ELIANA CALMON");
  assert.equal(r.julgado_citado?.redator_acordao, "CASTRO MEIRA");
  assert.equal(r.julgado_citado?.data_julgamento, "2010-03-02");
  assert.deepEqual(r.divergencias.map((d) => d.motivo), ["relator_e_redator_do_acordao", "data_de_publicacao_informada"]);
  const mono = r.processos[0].julgados.find((j) => j.tipo === "decisao_monocratica");
  assert.equal(mono?.especie, "recurso_extraordinario");
  assert.equal(mono?.relator, "FELIX FISCHER");

  const outro = await localizarJulgado(null, "REsp 1.015.133", { relator: "Nancy Andrighi", fetchImpl: stjFalso, ementas: 0 });
  assert.equal(outro.status, "DIVERGENCIA");
  assert.equal(outro.divergencias[0].motivo, "relator_diferente");
});

test("julgado correspondente: AgR do STF equivale a AgRg; sem recurso, prefere o acórdão", () => {
  const c = interpretarProcesso("Inq 2.139 AgR")!;
  const base = { orgao: null, relator: null, redator_acordao: null, data_julgamento: null, sessao_virtual: null, data_publicacao: null, ementa: null, resumo: null, inteiro_teor_url: null, fonte: "x" };
  const julgados = [
    { ...base, forma: "Inq 2139", tipo: "decisao_monocratica" as const, especie: "principal" as const },
    { ...base, forma: "Inq 2139 AgR", tipo: "acordao" as const, especie: "agravo" as const },
  ];
  assert.equal(julgadoCorrespondente(c, julgados)?.forma, "Inq 2139 AgR");
  assert.equal(julgadoCorrespondente(interpretarProcesso("Inq 2139")!, julgados)?.forma, "Inq 2139");
});

test("ementa e data do julgamento a partir do documento do STJ", () => {
  const t = "Superior Tribunal de Justiça RECURSO ESPECIAL Nº 889.766 EMENTA ADMINISTRATIVO. AÇÃO POPULAR. ACÓRDÃO Vistos, relatados e discutidos... Brasília, 04 de outubro de 2007 (Data do Julgamento)";
  const e = ementaDoDocumento(t);
  assert.match(e.ementa!, /^EMENTA ADMINISTRATIVO\. AÇÃO POPULAR\.$/);
  assert.equal(e.data_julgamento, "2007-10-04");
});
