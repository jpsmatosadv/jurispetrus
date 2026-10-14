import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Acervo } from "./db.js";
import { pesquisar, identificacao } from "./search.js";
import { verificarCitacao, interpretarCitacao } from "./citation.js";
import { consultarProcesso, cnjValido, formatarCnj } from "./sources/datajud.js";
import { buscarLegislacao } from "./sources/lexml.js";
import type { Embedder } from "./embeddings.js";
import type { FonteAoVivo } from "./fontes/tipos.js";
import { expandirTribunais, pesquisarAoVivo, type RelatorioFonte } from "./federado.js";

export const INSTRUCOES = `JurisPetrus: pesquisa de jurisprudência e legislação brasileiras com fonte oficial verificável.

Cada documento tem um nível de autoridade:
  A = vinculante forte (Súmula Vinculante, controle concentrado, súmulas STF/STJ/TST)
  B = precedente qualificado (tema repetitivo, repercussão geral, IRDR/IAC)
  C = observância qualificada (Corte Especial, Plenário, Órgão Especial)
  D = orientativo (acórdãos de turmas/câmaras)
  E = consulta (temas sem tese firmada, material de apoio)
Priorize A e B ao fundamentar; trate D como persuasivo.

Cobertura: o acervo indexado traz STF (súmulas, súmulas vinculantes, repercussão geral, controle concentrado),
STJ (acórdãos, súmulas e repetitivos) e os precedentes qualificados de TST, TNU, TRFs, TJs e TRTs.
Para jurisprudência comum de um tribunal (TJs, TRFs, TST, CARF, TCU), informe o tribunal em 'tribunais':
a pesquisa consulta o portal oficial dele em tempo real. Se o usuário pedir "tribunais estaduais", use 'ESTADUAIS'.
Quando um portal estiver indisponível, diga isso ao usuário em vez de concluir que não há julgados.

Regras de uso:
- Cite apenas julgados retornados pelas ferramentas, com tribunal, classe/número, órgão, relator, data e link da fonte.
- Antes de usar uma citação trazida pelo usuário ou lembrada de memória, confirme-a com verificar_citacao.
- NAO_ENCONTRADO significa que o julgado não está no acervo indexado, não que ele não exista; diga isso ao usuário e nunca invente número de processo, relator ou tese.
- Se a situação de um tema for cancelado/revisado/afetado, alerte que o entendimento não está consolidado.
- Escreva a resposta como parecer jurídico em prosa, indicando ao final as limitações da pesquisa e as fontes.`;

const autoridade = z.enum(["A", "B", "C", "D", "E"]);

function ok(dados: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(dados, null, 2) }] };
}

function erro(msg: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: msg }] };
}

export interface OpcoesServidor {
  datajudKey?: string;
  /** Chamado antes de cada ferramenta; deve lançar erro para bloquear (ex.: cota esgotada). */
  antesDeChamar?: (ferramenta: string) => void;
  fetchImpl?: typeof fetch;
  /** Provedor de embeddings para a busca semântica (opcional). */
  embedder?: Embedder | null;
  /** Conectores consultados ao vivo (tribunais estaduais, TRFs, CARF, TCU...). */
  fontes?: FonteAoVivo[];
  timeoutFontes?: number;
}

export function criarServidor(acervo: Acervo, opts: OpcoesServidor = {}): McpServer {
  const server = new McpServer(
    { name: "jurispetrus", title: "JurisPetrus — Jurisprudência Brasileira", version: "0.1.0" },
    { instructions: INSTRUCOES },
  );

  /** Siglas presentes no acervo local ou cobertas por fonte ao vivo. */
  const tribunaisConhecidos = () => [
    ...new Set([
      ...(acervo.db.prepare("SELECT DISTINCT tribunal FROM documentos").all() as { tribunal: string }[]).map((r) => r.tribunal),
      ...(opts.fontes ?? []).flatMap((f) => f.tribunais),
    ]),
  ];

  /** Vetor da consulta para a busca semântica; falha silenciosa cai na busca lexical. */
  const vetorDaConsulta = async (consulta: string): Promise<Float32Array | null> => {
    if (!opts.embedder || !acervo.temVetores) return null;
    try {
      return (await opts.embedder.vetorizar([consulta], "consulta"))[0];
    } catch (e) {
      console.error("Falha ao vetorizar consulta:", (e as Error).message);
      return null;
    }
  };

  /** Envolve o handler com o controle de cota e tratamento de erros. */
  const protegido =
    <A,>(nome: string, fn: (args: A) => Promise<CallToolResult> | CallToolResult) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        opts.antesDeChamar?.(nome);
        return await fn(args);
      } catch (e) {
        return erro(e instanceof Error ? e.message : String(e));
      }
    };

  server.registerTool(
    "pesquisar_jurisprudencia",
    {
      title: "Pesquisar jurisprudência",
      description:
        "Pesquisa acórdãos e precedentes qualificados (temas repetitivos, IAC, IRDR) no acervo indexado. " +
        "Os resultados são ordenados por relevância, nível de autoridade (A a E) e atualidade. " +
        "Use termos jurídicos do caso (ex.: 'dano moral negativação indevida') e frases entre aspas para expressões exatas.",
      inputSchema: {
        consulta: z.string().min(2).describe("Termos de pesquisa em linguagem jurídica"),
        tribunais: z
          .array(z.string())
          .optional()
          .describe(
            "Siglas dos tribunais/órgãos, ex.: ['STJ'], ['TJSP','TJSC'], ['TRF4'], ['CARF'], ['TCU'], ['TST']. " +
              "Atalhos: 'ESTADUAIS' (todos os TJs), 'FEDERAIS' (TRFs), 'TRABALHISTAS', 'SUPERIORES', 'TODOS'. " +
              "Sem filtro, a pesquisa usa o acervo indexado (STF, STJ e precedentes qualificados de todos os tribunais); " +
              "com filtro, consulta também os portais oficiais desses tribunais em tempo real. Veja listar_fontes.",
          ),
        autoridade_minima: autoridade.optional().describe("Retorna só documentos com autoridade igual ou superior (A é a mais forte)"),
        orgao: z.string().optional().describe("Órgão julgador, ex.: 'TERCEIRA TURMA', 'SEGUNDA SEÇÃO'"),
        relator: z.string().optional().describe("Nome (ou parte) do relator"),
        data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Julgados a partir de (AAAA-MM-DD)"),
        data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Julgados até (AAAA-MM-DD)"),
        incluir_cancelados: z.boolean().optional().describe("Inclui temas cancelados/revisados (padrão: não)"),
        limite: z.number().int().min(1).max(30).optional().describe("Resultados por página (padrão 10)"),
        pagina: z.number().int().min(1).optional(),
        ao_vivo: z
          .boolean()
          .optional()
          .describe("Consulta também os portais oficiais dos tribunais pedidos em tempo real (padrão: sim)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    protegido("pesquisar_jurisprudencia", async ({ ao_vivo = true, ...entrada }) => {
      const args = { ...entrada, tribunais: expandirTribunais(entrada.tribunais, tribunaisConhecidos()) };
      const [fontes, vetorConsulta] = await Promise.all([
        ao_vivo && opts.fontes?.length && (args.pagina ?? 1) === 1
          ? pesquisarAoVivo(acervo, opts.fontes, args, {
              timeoutMs: opts.timeoutFontes ?? 20_000,
              fetchImpl: opts.fetchImpl,
              embedder: opts.embedder,
            })
          : Promise.resolve([] as RelatorioFonte[]),
        vetorDaConsulta(args.consulta),
      ]);
      const r = pesquisar(acervo, args, { vetorConsulta });
      const falhas = fontes.filter((f) => f.status !== "ok");
      if (!r.resultados.length) {
        return ok({
          estado: "SEM_RESULTADO",
          mensagem: "Nenhum julgado encontrado para esses termos e filtros. Não cite julgados que não tenham sido retornados.",
          fontes_consultadas: fontes,
        });
      }
      return ok({
        estado: "ENCONTRADO",
        ...r,
        fontes_consultadas: fontes.length ? fontes : undefined,
        aviso: falhas.length
          ? `Fontes indisponíveis agora: ${falhas.map((f) => f.tribunais.join("/")).join(", ")}. A pesquisa nelas pode estar incompleta.`
          : undefined,
      });
    }),
  );

  server.registerTool(
    "obter_documento",
    {
      title: "Obter documento",
      description:
        "Retorna o conteúdo completo de um documento (ementa, tese, decisão, referências legislativas) pelo id retornado na pesquisa. " +
        "Textos longos vêm paginados: use 'inicio' para continuar a leitura.",
      inputSchema: {
        id: z.string().describe("Identificador retornado por pesquisar_jurisprudencia"),
        inicio: z.number().int().min(0).optional().describe("Posição (em caracteres) para continuar a leitura do texto"),
        tamanho: z.number().int().min(1000).max(40000).optional().describe("Máximo de caracteres do texto (padrão 12000)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    protegido("obter_documento", ({ id, inicio = 0, tamanho = 12000 }) => {
      const d = acervo.obter(id);
      if (!d) return erro(`Documento '${id}' não encontrado no acervo.`);
      const texto = d.inteiro_teor ?? "";
      const fim = Math.min(texto.length, inicio + tamanho);
      return ok({
        id: d.id,
        identificacao: identificacao(d),
        tribunal: d.tribunal,
        tipo: d.tipo,
        orgao: d.orgao,
        relator: d.relator,
        data_julgamento: d.data_julgamento,
        data_publicacao: d.data_publicacao,
        autoridade: d.autoridade,
        situacao: d.situacao,
        ementa: inicio === 0 ? d.ementa : undefined,
        tese: inicio === 0 ? d.tese : undefined,
        referencias_legislativas: inicio === 0 ? d.referencias : undefined,
        assuntos: inicio === 0 ? d.assuntos : undefined,
        texto: texto.slice(inicio, fim),
        texto_paginacao: { inicio, fim, total: texto.length, proximo_inicio: fim < texto.length ? fim : null },
        fonte_url: d.fonte_url,
      });
    }),
  );

  server.registerTool(
    "verificar_citacao",
    {
      title: "Verificar citação",
      description:
        "Confirma se um precedente citado existe (ex.: 'REsp 1.990.285/SP', 'Tema 988/STJ', ou número CNJ). " +
        "Retorna CONFIRMADO, DIVERGENCIA (existe, mas com dado diferente), NAO_ENCONTRADO ou NAO_RECONHECIDA. " +
        "Use antes de incluir em uma peça qualquer julgado que não tenha vindo da pesquisa.",
      inputSchema: {
        citacao: z.string().min(3).describe("Citação como aparece no texto"),
        relator: z.string().optional().describe("Relator atribuído na citação, para conferência"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    protegido("verificar_citacao", async ({ citacao, relator }) => {
      const c = interpretarCitacao(citacao);
      if (c?.tipo === "cnj") {
        if (!cnjValido(c.numero)) {
          return ok({ status: "DIVERGENCIA", citacao: formatarCnj(c.numero), observacao: "Os dígitos verificadores do número CNJ não conferem." });
        }
        try {
          const r = await consultarProcesso(c.numero, { chave: opts.datajudKey, maxMovimentos: 5, fetchImpl: opts.fetchImpl });
          return ok(
            r.processos.length
              ? { status: "CONFIRMADO", fonte: "DataJud/CNJ", processos: r.processos.map(({ movimentos, ...p }) => p) }
              : { status: "NAO_ENCONTRADO", observacao: `Processo não localizado no DataJud (${r.alias}).` },
          );
        } catch (e) {
          return ok({ status: "INDISPONIVEL", observacao: `Não foi possível consultar o DataJud agora: ${(e as Error).message}. Não afirme que o processo não existe.` });
        }
      }
      return ok(verificarCitacao(acervo, citacao, relator));
    }),
  );

  server.registerTool(
    "consultar_processo",
    {
      title: "Consultar processo (DataJud/CNJ)",
      description:
        "Consulta metadados e movimentações de um processo pelo número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO) na API pública do DataJud. " +
        "Não retorna peças nem inteiro teor; processos sigilosos podem não aparecer.",
      inputSchema: {
        numero_cnj: z.string().describe("Número único do processo (com ou sem pontuação)"),
        max_movimentos: z.number().int().min(0).max(200).optional().describe("Movimentações mais recentes a retornar (padrão 30)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    protegido("consultar_processo", async ({ numero_cnj, max_movimentos }) => {
      if (!cnjValido(numero_cnj)) return erro("Número CNJ inválido (20 dígitos com dígito verificador correto).");
      const r = await consultarProcesso(numero_cnj, { chave: opts.datajudKey, maxMovimentos: max_movimentos, fetchImpl: opts.fetchImpl });
      if (!r.processos.length) return ok({ estado: "NAO_ENCONTRADO", indice: r.alias });
      return ok({ estado: "ENCONTRADO", fonte: "DataJud/CNJ", processos: r.processos });
    }),
  );

  server.registerTool(
    "buscar_legislacao",
    {
      title: "Buscar legislação (LexML)",
      description:
        "Pesquisa leis, decretos e demais normas federais, estaduais e municipais no LexML Brasil. Retorna título, ementa, data e link (URN).",
      inputSchema: {
        consulta: z.string().min(2).describe("Assunto ou nome da norma, ex.: 'proteção de dados pessoais'"),
        tipo: z.string().optional().describe("Tipo de documento, ex.: 'Lei', 'Decreto', 'Lei Complementar'"),
        ano: z.number().int().min(1800).max(2100).optional(),
        limite: z.number().int().min(1).max(30).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    protegido("buscar_legislacao", async ({ consulta, tipo, ano, limite }) => {
      try {
        return ok({ fonte: "LexML Brasil", ...(await buscarLegislacao(consulta, { tipo, ano, limite, fetchImpl: opts.fetchImpl })) });
      } catch (e) {
        return ok({
          estado: "INDISPONIVEL",
          mensagem: `${(e as Error).message} Não invente dispositivos legais; oriente o usuário a conferir no Planalto (https://www.planalto.gov.br/legislacao).`,
        });
      }
    }),
  );

  server.registerTool(
    "listar_fontes",
    {
      title: "Cobertura do acervo",
      description: "Informa quais tribunais, tipos de documento e períodos estão indexados, para delimitar o alcance da pesquisa.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    protegido("listar_fontes", () =>
      ok({
        acervo_local: acervo.estatisticas(),
        pesquisa_ao_vivo: (opts.fontes ?? []).map((f) => ({ fonte: f.nome, tribunais: f.tribunais, consultada_por_padrao: f.padrao })),
        outras_consultas: ["DataJud/CNJ (metadados e movimentações processuais)", "LexML Brasil (legislação)"],
      }),
    ),
  );

  server.registerPrompt(
    "pesquisa_fundamentada",
    {
      title: "Pesquisa jurisprudencial fundamentada",
      description: "Roteiro para responder uma questão jurídica com precedentes verificados.",
      argsSchema: { questao: z.string().describe("Questão jurídica a pesquisar") },
    },
    ({ questao }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Questão: ${questao}\n\n` +
              "1. Use pesquisar_jurisprudencia com autoridade_minima 'B' para achar precedentes qualificados; depois repita sem o filtro.\n" +
              "2. Leia com obter_documento os 3 a 5 mais pertinentes.\n" +
              "3. Confirme com verificar_citacao qualquer julgado que não tenha vindo da pesquisa.\n" +
              "4. Responda como parecer, em prosa, com tese, precedentes (tribunal, classe/número, órgão, relator, data, link), " +
              "limitações da pesquisa e próximo passo recomendado.",
          },
        },
      ],
    }),
  );

  return server;
}
