import { test } from "node:test";
import assert from "node:assert/strict";
import { lerResultadosEproc } from "../src/fontes/eproc.js";
import { lerResultadosEsaj } from "../src/fontes/esaj.js";
import { lerResultadosTjpr } from "../src/fontes/tjpr.js";
import { mapearCarf, escaparLucene } from "../src/fontes/carf.js";
import { mapearTcu } from "../src/fontes/tcu.js";
import { mapearRegistroTst } from "../src/fontes/tst.js";
import { expandirTribunais } from "../src/federado.js";
import { limparHtml } from "../src/fontes/tipos.js";

const agora = "2026-10-14T00:00:00Z";

test("eproc: extrai campos do card de resultado", () => {
  const html = `<div id="21787927918966066348604200732">
    <div class="card-body py-2 px-3"><div class="text-center"><div class="resValueTipoJurisprudencia">Acórdão</div></div>
    <div class="resLabel">PROCESSO</div><div class="resValue"><div class="row"><div class="col">
      <a href="x" class="numero-processo">5075640-80.2022.4.02.5101/TRF2</a></div><div class="col"><span>AC - Apelação Cível</span></div></div></div>
    <div class="resLabel">ÓRGÃO JULGADOR</div><div class="resValue">6ª TURMA ESPECIALIZADA</div>
    <div class="resLabel">DATA DO JULGAMENTO</div><div class="resValue">27/08/2026</div>
    <div class="resLabel"> RELATORA <a href="#">ver</a></div><div class="resValue completo">ELIZA STRAPAZZON</div>
    <div class="resLabel">EMENTA</div><div class="resValue completo">APELAÇÃO. <B><FONT STYLE="background-color:#FFFF00">DANO</FONT></B> MORAL.</div>
  </div></div>`;
  const [d] = lerResultadosEproc(html, "TRF2", "https://eproc.trf2.jus.br/eproc", agora);
  assert.equal(d.numero, "5075640-80.2022.4.02.5101");
  assert.equal(d.classe, "Apelação Cível");
  assert.equal(d.orgao, "6ª TURMA ESPECIALIZADA");
  assert.equal(d.relator, "ELIZA STRAPAZZON");
  assert.equal(d.data_julgamento, "2026-08-27");
  assert.equal(d.ementa, "APELAÇÃO. DANO MORAL.");
  assert.match(d.fonte_url!, /id_jurisprudencia=21787927918966066348604200732$/);
});

test("e-SAJ: extrai acórdão e remove a citação final da ementa", () => {
  const html = `<tr class="fundocinza1"><td>
    <a class="esajLinkLogin downloadEmenta" cdAcordao="879602" cdForo="0" > 0724125-83.2025.8.02.0001 </a>
    <tr class="ementaClass2"><td><strong> Classe/Assunto: </strong> Apelação Cível / Inclusão Indevida em Cadastro </td></tr>
    <tr class="ementaClass2"><td><strong> Relator(a): </strong> Des. Fulano </td></tr>
    <tr class="ementaClass2"><td><strong> Órgão julgador: </strong> 1ª Câmara Cível </td></tr>
    <tr class="ementaClass2"><td><strong> Data do julgamento: </strong> 23/09/2026 </td></tr>
    <div align="justify" style="display: none;"><strong>Ementa: </strong>NEGATIVA&Ccedil;&Atilde;O INDEVIDA. <em>DANO</em> MORAL.</div>`;
  const [d] = lerResultadosEsaj(html, "TJAL", "https://www2.tjal.jus.br", agora);
  assert.equal(d.classe, "Apelação Cível");
  assert.equal(d.assuntos, "Inclusão Indevida em Cadastro");
  assert.equal(d.relator, "Des. Fulano");
  assert.equal(d.data_julgamento, "2026-09-23");
  assert.equal(d.ementa, "NEGATIVAÇÃO INDEVIDA. DANO MORAL.");
});

test("TJPR: extrai processo, relator, órgão e data", () => {
  const html = `<td valign="top" class="juris-tabela-dados"><div class="juris-tabela-propriedades">
    <a target="_blank" href="/jurisprudencia/j/2100000035223801/Acórdão-0015551-54.2024.8.16.0035;jsessionid=abc" class="acordao negrito"><div>0015551-54.2024.8.16.0035</div></a>
    <font class="acordao">&nbsp;(Acórdão)</font><br /> Relator:&nbsp; Rafaela Zarpelon</br>
    Órgão Julgador: 2ª Turma Recursal <br> Data Julgamento: 09/10/2026 </div></td>
    <td class="juris-tabela-ementa"><div id="ementa2100000035223801">RECURSO INOMINADO. <span class='high'>DANO</span> MORAL...</div></td>`;
  const [d] = lerResultadosTjpr(html, agora);
  assert.equal(d.numero, "0015551-54.2024.8.16.0035");
  assert.equal(d.relator, "Rafaela Zarpelon");
  assert.equal(d.orgao, "2ª Turma Recursal");
  assert.equal(d.data_julgamento, "2026-10-09");
  assert.ok(!d.fonte_url!.includes("jsessionid"));
});

test("CARF, TCU e TST: mapeamento e autoridade", () => {
  const carf = mapearCarf({ id: "1", numero_decisao_s: "9101-000.758", secao_s: "Câmara Superior de Recursos Fiscais", ementa_s: "MULTA ISOLADA.", dt_sessao_tdt: "+191993-07-28T00:00:00Z", nome_arquivo_pdf_s: "a.pdf" }, agora)!;
  assert.equal(carf.autoridade, "C");
  assert.equal(carf.data_julgamento, null);
  assert.equal(escaparLucene("art. 135: (CTN)"), "art. 135\\: \\(CTN\\)");

  const sumula = mapearTcu("sumula", { KEY: "SUMULA-1", NUMERO: "177", CABECALHO: "A definição precisa do objeto...", VIGENTE: "true" }, agora)!;
  assert.equal(sumula.titulo, "Súmula TCU 177");
  const sel = mapearTcu("jurisprudencia-selecionada", { KEY: "J-1", NUMACORDAO: "2613", ANOACORDAO: "2026", COLEGIADO: "Plenário", ENUNCIADO: "Enunciado." }, agora)!;
  assert.match(sel.titulo, /^Acórdão 2613\/2026-TCU-Plenário/);

  const oj = mapearRegistroTst({ id: "1", tipo: { codigoTipoJurisprudencia: "SUM" }, numero: "366", titulo: "CARTÃO DE PONTO", tese: "Não serão descontadas...", situacao: { descricao: "CANCELADA" } }, agora)!;
  assert.equal(oj.id, "TST-SUM-366");
  assert.match(oj.situacao!, /CANCELADA/);
});

test("expandirTribunais entende atalhos de grupo", () => {
  const conhecidos = ["STF", "STJ", "TJSP", "TJSC", "TRF4", "TRF2", "TRT2", "TST"];
  assert.deepEqual(expandirTribunais(["estaduais"], conhecidos), ["TJSP", "TJSC"]);
  assert.deepEqual(expandirTribunais(["FEDERAIS", "stj"], conhecidos), ["TRF4", "TRF2", "STJ"]);
  assert.deepEqual(expandirTribunais(["TRF04"], conhecidos), ["TRF4"]);
  assert.equal(expandirTribunais([], conhecidos), undefined);
});

test("limparHtml decodifica entidades e remove marcação", () => {
  assert.equal(limparHtml("A&ccedil;&atilde;o <b>de</b>&nbsp;cobran&ccedil;a"), "Ação de cobrança");
});
