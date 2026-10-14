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

import { deflateRawSync } from "node:zlib";
import { lerNormaAtualizadaCamara, lerNormaEstruturada } from "../src/legislacao/fontes.js";
import { docxParaHtml } from "../src/legislacao/docx.js";
import { normaPorNumero } from "../src/legislacao/catalogo.js";

const HTML_CAMARA = `
<p>TÍTULO I</p><p>DOS DIREITOS DO CONSUMIDOR</p>
<p>CAPÍTULO IV</p><p>DA QUALIDADE DE PRODUTOS</p>
<p>Seção II</p><p>Da Responsabilidade pelo Fato</p>
<p><font>Art. 14. O fornecedor de serviços responde, independentemente da existência de culpa.</font></p>
<p><font>§ 1º O serviço é defeituoso quando não fornece a segurança esperada.</font></p>
<p><font>Art. 14-A. Texto incluído. <a href="x"><i>(Artigo acrescido pela Lei nº 99, de 2020)</i></a></font></p>
<p><font>Arts. 15 a 17. <a href="x"><i>(Revogados pela Lei nº 100, de 2021)</i></a></font></p>
<p>Art. 18. (VETADO).</p>
<p>Brasília, 11 de setembro de 1990.</p><p>Art. 99. Não é artigo, é assinatura.</p>`;

test("lerNormaAtualizadaCamara: caminho, notas, faixas revogadas e fim do texto", () => {
  const d = lerNormaAtualizadaCamara(HTML_CAMARA, "u");
  assert.deepEqual(d.map((x) => x.artigo), ["14", "14-A", "15", "16", "17", "18"]);
  assert.equal(d[0].caminho, "TÍTULO I - DOS DIREITOS DO CONSUMIDOR > CAPÍTULO IV - DA QUALIDADE DE PRODUTOS > Seção II - Da Responsabilidade pelo Fato");
  assert.match(d[0].texto, /§ 1º O serviço é defeituoso/);
  assert.equal(d[1].revogado, 0);
  assert.match(d[1].texto, /Notas: \(Artigo acrescido pela Lei nº 99, de 2020\)/);
  assert.ok(!d[1].texto.startsWith("Art. 14-A. Texto incluído. (Artigo"));
  assert.deepEqual(d.slice(2, 5).map((x) => x.revogado), [1, 1, 1]);
  assert.equal(d[5].revogado, 1);
});

test("lerNormaEstruturada: versão vigente e revogação por versão", () => {
  const no = (id: string, tipo: string, versoes: object[], filhos: object[] = []) => ({
    legislationIdentifier: id, legislationType: { "@id": `x:${tipo}` }, workExample: versoes, hasPart: filhos,
  });
  const json = no("raiz", "articulacao", [], [
    no("cap1", "capitulo", [{ name: "CAPÍTULO I", text: "DAS PESSOAS" }], [
      no("!art3", "artigo", [{ name: "Art. 3º" }], [
        no("!art3_cpt", "caput", [
          { legislationDate: "2002-01-10", legislationLegalForce: "NotInForce", text: "Texto antigo." },
          { legislationDate: "2015-07-06", text: "São absolutamente incapazes os menores de 16 anos." },
        ]),
      ]),
      no("!art4", "artigo", [{ name: "Art. 4º" }], [no("!art4_cpt", "caput", [{ legislationDate: "2020-01-01", legislationType: "Repeal_Version", text: "(Revogado)" }])]),
    ]),
  ]);
  const d = lerNormaEstruturada(json, "u");
  assert.equal(d[0].artigo, "3");
  assert.equal(d[0].caminho, "CAPÍTULO I - DAS PESSOAS");
  assert.match(d[0].texto, /menores de 16 anos/);
  assert.ok(!d[0].texto.includes("Texto antigo"));
  assert.equal(d[1].revogado, 1);
});

/** Monta um zip mínimo (um arquivo, deflate) para testar o leitor de .docx. */
function zipCom(nome: string, conteudo: string): Buffer {
  const dados = deflateRawSync(Buffer.from(conteudo));
  const n = Buffer.from(nome);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(dados.length, 18); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(dados.length, 20); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(0, 42);
  const inicioCentral = 30 + n.length + dados.length;
  const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(1, 8); fim.writeUInt16LE(1, 10); fim.writeUInt32LE(46 + n.length, 12); fim.writeUInt32LE(inicioCentral, 16);
  return Buffer.concat([local, n, dados, central, n, fim]);
}

test("docxParaHtml lê parágrafos do document.xml", () => {
  const xml = `<w:document><w:body><w:p><w:r><w:t>Art. 1º Esta Lei institui</w:t></w:r><w:r><w:t xml:space="preserve"> a inclusão &amp; acessibilidade.</w:t></w:r></w:p><w:p><w:r><w:t>Art. 2º (Revogado).</w:t></w:r></w:p></w:body></w:document>`;
  const html = docxParaHtml(zipCom("word/document.xml", xml))!;
  const d = lerNormaAtualizadaCamara(html, "u");
  assert.equal(d[0].texto, "Art. 1º Esta Lei institui a inclusão & acessibilidade.");
  assert.equal(d[1].revogado, 1);
});

test("normaPorNumero identifica leis fora do catálogo", () => {
  assert.equal(normaPorNumero("Lei nº 13.146, de 6 de julho de 2015")?.sigla, "LEI-13146-2015");
  assert.equal(normaPorNumero("LC 123/2006")?.sigla, "LCP-123-2006");
  assert.equal(normaPorNumero("Decreto-Lei 911/69")?.sigla, "DEL-911-1969");
  assert.equal(normaPorNumero("Lei 8.078/90")?.sigla, "CDC");
});
