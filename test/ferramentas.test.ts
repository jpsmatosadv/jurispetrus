import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Acervo } from "../src/db.js";
import { criarServidor } from "../src/server.js";
import type { AnalistaIA, Questoes, Ratio } from "../src/ia.js";
import { salvarNorma } from "../src/legislacao/indice.js";
import { mapearTema } from "../src/ingest/stj.js";

const ratioFalsa: Ratio = {
  questao_juridica: "Se a negativação por dívida inexistente gera dano moral",
  ratio_decidendi: "A inscrição indevida em cadastro de inadimplentes gera dano moral presumido.",
  fundamentos_determinantes: ["Dívida inexistente"], obiter_dicta: [], fatos_relevantes: ["Ausência de contrato"],
  dispositivos_legais: ["CDC, art. 14"], precedentes_citados: [], resultado: "desprovido", suficiencia_do_texto: "parcial",
};

function analistaFalso() {
  const chamadas = { ratio: 0, questoes: 0 };
  const analista = {
    modelo: "modelo-de-teste",
    async extrairRatio() { chamadas.ratio++; return ratioFalsa; },
    async identificarQuestoes(): Promise<Questoes> {
      chamadas.questoes++;
      return {
        resumo_dos_fatos: "Negativação sem contrato.", ramos_do_direito: ["Consumidor"],
        questoes: [{ questao: "Responsabilidade por inscrição indevida", termos_jurisprudencia: "inscrição indevida cadastro inadimplentes dano moral", termos_legislacao: "responsabilidade do fornecedor defeito do serviço", normas_provaveis: ["CDC, art. 14"] }],
        fatos_a_esclarecer: ["Se havia anotação preexistente"], tribunais_sugeridos: [],
      };
    },
  } as unknown as AnalistaIA;
  return { analista, chamadas };
}

async function conectar(acervo: Acervo, analista: AnalistaIA | null) {
  const server = criarServidor(acervo, { analista, fontes: [] });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "teste", version: "1" });
  await client.connect(b);
  return async (name: string, args: Record<string, unknown>) =>
    JSON.parse(((await client.callTool({ name, arguments: args })).content as { text: string }[])[0].text);
}

function acervoBase() {
  const a = new Acervo(":memory:");
  a.salvar([
    mapearTema({ tipoPrecedente: "Tema", numeroPrecedente: "922", situacao: "Trânsito em Julgado", orgaoJulgador: "S2",
      questaoSubmetidaAJulgamento: "Inscrição indevida em cadastro de inadimplentes e dano moral.",
      teseFirmada: "A inscrição indevida comandada pelo credor em cadastro de inadimplentes, quando preexistente legítima anotação, não enseja indenização por dano moral." })!,
    { id: "TJXX-1", tribunal: "TJSP", tipo: "acordao", classe: "Apelação", numero: "1", registro: null, orgao: "1ª Câmara", relator: "Fulano",
      data_julgamento: "2026-01-01", data_publicacao: null, autoridade: "D", situacao: null, titulo: "Apelação 1",
      ementa: "APELAÇÃO. INSCRIÇÃO INDEVIDA EM CADASTRO DE INADIMPLENTES. DANO MORAL CONFIGURADO.", tese: null, inteiro_teor: null,
      referencias: null, assuntos: null, fonte: "teste", fonte_url: null, atualizado_em: "2026-01-01" },
  ]);
  salvarNorma(a, { sigla: "CDC", nome: "Código de Defesa do Consumidor", fonte: "teste" }, [
    { artigo: "14", ordem: 0, rotulo: "Art. 14", caminho: null, texto: "Art. 14. O fornecedor de serviços responde, independentemente da existência de culpa, pela reparação dos danos causados por defeitos relativos à prestação dos serviços.", revogado: 0, fonte_url: null },
  ]);
  return a;
}

test("extrair_razao_decidir usa a IA uma vez e guarda o resultado", async () => {
  const a = acervoBase();
  const { analista, chamadas } = analistaFalso();
  const call = await conectar(a, analista);
  const r1 = await call("extrair_razao_decidir", { id: "TJXX-1" });
  assert.equal(r1.analise_ia.ratio_decidendi, ratioFalsa.ratio_decidendi);
  assert.equal(r1.analise_ia.modelo, "modelo-de-teste");
  const r2 = await call("extrair_razao_decidir", { id: "TJXX-1" });
  assert.equal(r2.analise_ia.ratio_decidendi, ratioFalsa.ratio_decidendi);
  assert.equal(chamadas.ratio, 1, "a segunda chamada vem do cache");
  const tema = await call("extrair_razao_decidir", { id: "STJ-Tema-922" });
  assert.equal(tema.estrutura_da_ementa.metodo, "tese_firmada");
  assert.equal(chamadas.ratio, 1, "tese firmada dispensa a IA");
});

test("extrair_razao_decidir sem IA devolve o texto para o Claude do usuário", async () => {
  const call = await conectar(acervoBase(), null);
  const r = await call("extrair_razao_decidir", { id: "TJXX-1" });
  assert.equal(r.analise_ia, undefined);
  assert.match(r.texto.ementa, /DANO MORAL/);
  assert.match(r.orientacao, /Identifique a ratio/);
});

test("analisar_caso: questões da IA, legislação citada e precedentes", async () => {
  const { analista, chamadas } = analistaFalso();
  const call = await conectar(acervoBase(), analista);
  const r = await call("analisar_caso", { narrativa: "Meu cliente foi negativado por um cartão que nunca contratou e teve crédito negado." });
  assert.equal(chamadas.questoes, 1);
  assert.match(r.questoes_identificadas_por, /^ia/);
  const q = r.analise[0];
  assert.equal(q.legislacao[0].id, "CDC-art-14");
  assert.equal(q.legislacao[0].origem, "citada");
  assert.equal(q.precedentes_qualificados[0].identificacao, "Tema 922/STJ");
  assert.ok(q.jurisprudencia.some((x: { id: string }) => x.id === "TJXX-1"));
  assert.deepEqual(r.fatos_a_esclarecer, ["Se havia anotação preexistente"]);
});

test("verificar_citacao informa vigência de dispositivo legal", async () => {
  const call = await conectar(acervoBase(), null);
  const r = await call("verificar_citacao", { citacao: "art. 14 do CDC" });
  assert.equal(r.status, "VIGENTE");
});
