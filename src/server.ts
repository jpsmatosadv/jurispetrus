import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Acervo } from "./db.js";
import { pesquisar, identificacao, type FiltrosPesquisa } from "./search.js";
import { verificarCitacao, interpretarCitacao } from "./citation.js";
import { consultarProcesso, cnjValido, formatarCnj } from "./sources/datajud.js";
import { pesquisarSigen } from "./legislacao/fontes.js";
import type { Embedder } from "./embeddings.js";
import type { FonteAoVivo } from "./fontes/tipos.js";
import { expandirTribunais, pesquisarAoVivo, type RelatorioFonte } from "./federado.js";
import { baixarInteiroTeor, extrairEstrutura, temInteiroTeorBaixavel } from "./ratio.js";
import type { AnalistaIA, Questoes, Ratio } from "./ia.js";
import {
  interpretarCitacaoLegal,
  obterDispositivo,
  pesquisarDispositivos,
  vizinhos,
  normasIndexadas,
  normaIndexada,
  type CitacaoLegal,
} from "./legislacao/indice.js";
import { CATALOGO, resolverNorma } from "./legislacao/catalogo.js";
import { importarNorma } from "./legislacao/importar.js";
import { ETAPAS, estadoAtualizacao, iniciarAtualizacao, type Etapa } from "./atualizacao.js";

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

Fluxo recomendado para um caso concreto: decomponha a narrativa em questões jurídicas e chame analisar_caso com elas;
depois leia os julgados centrais com extrair_razao_decidir e confira os dispositivos com buscar_legislacao.
Para legislação, use buscar_legislacao (texto consolidado vigente, artigo por artigo) e nunca cite artigo de memória.

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
  /** Claude no servidor para análises estruturadas (opcional). */
  analista?: AnalistaIA | null;
  /** Expõe a ferramenta atualizar_acervo (instalação local). */
  permitirAtualizacao?: boolean;
}

/** Importações de normas em andamento (compartilhadas entre requisições do mesmo processo). */
const importacoes = new Map<string, Promise<undefined>>();

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

  /** Pesquisa no acervo e, se pedido, nos portais ao vivo dos tribunais filtrados. */
  const buscarJurisprudencia = async (entrada: FiltrosPesquisa, aoVivo: boolean) => {
    const args = { ...entrada, tribunais: expandirTribunais(entrada.tribunais, tribunaisConhecidos()) };
    const [fontes, vetorConsulta] = await Promise.all([
      aoVivo && opts.fontes?.length && (args.pagina ?? 1) === 1
        ? pesquisarAoVivo(acervo, opts.fontes, args, {
            timeoutMs: opts.timeoutFontes ?? 25_000,
            fetchImpl: opts.fetchImpl,
            embedder: opts.embedder,
          })
        : Promise.resolve([] as RelatorioFonte[]),
      vetorDaConsulta(args.consulta),
    ]);
    return { r: pesquisar(acervo, args, { vetorConsulta }), fontes };
  };

  const avisoFalhas = (fontes: RelatorioFonte[]) => {
    const falhas = fontes.filter((f) => f.status !== "ok");
    return falhas.length
      ? `Fontes indisponíveis agora: ${falhas.map((f) => f.tribunais.join("/")).join(", ")}. A pesquisa nelas pode estar incompleta.`
      : undefined;
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
      const { r, fontes } = await buscarJurisprudencia(entrada, ao_vivo);
      if (!r.resultados.length) {
        return ok({
          estado: "SEM_RESULTADO",
          mensagem: "Nenhum julgado encontrado para esses termos e filtros. Não cite julgados que não tenham sido retornados.",
          fontes_consultadas: fontes,
        });
      }
      return ok({ estado: "ENCONTRADO", ...r, fontes_consultadas: fontes.length ? fontes : undefined, aviso: avisoFalhas(fontes) });
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
    "extrair_razao_decidir",
    {
      title: "Extrair razão de decidir",
      description:
        "Identifica a ratio decidendi de um julgado (id retornado na pesquisa): questão jurídica, regra decisiva, fundamentos " +
        "determinantes, obiter dicta, fatos materiais, dispositivos e precedentes citados. Usa a tese firmada nos precedentes " +
        "qualificados e a estrutura da ementa padrão do CNJ (Recomendação 154/2024) quando existe; quando possível, baixa o " +
        "inteiro teor do portal de origem. Se a análise automática não estiver ativa, devolve o texto para você identificar a ratio.",
      inputSchema: {
        id: z.string().describe("Identificador retornado por pesquisar_jurisprudencia"),
        usar_ia: z.boolean().optional().describe("Usa a análise automática no servidor, se configurada (padrão: sim)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    protegido("extrair_razao_decidir", async ({ id, usar_ia = true }) => {
      let d = acervo.obter(id);
      if (!d) return erro(`Documento '${id}' não encontrado no acervo.`);

      // Ementa sozinha raramente basta: tenta o inteiro teor no portal de origem.
      let inteiroTeorBaixado = false;
      if ((d.inteiro_teor?.length ?? 0) < 3000 && temInteiroTeorBaixavel(d.fonte_url)) {
        try {
          const texto = await baixarInteiroTeor(d.fonte_url!, opts.fetchImpl);
          if (texto) {
            acervo.gravarInteiroTeor(d.id, texto);
            d = { ...d, inteiro_teor: texto };
            inteiroTeorBaixado = true;
          }
        } catch {
          // segue com a ementa
        }
      }

      const estrutura = extrairEstrutura(d);
      const cabecalho = {
        id: d.id,
        identificacao: identificacao(d),
        tribunal: d.tribunal,
        orgao: d.orgao,
        relator: d.relator,
        data_julgamento: d.data_julgamento,
        autoridade: d.autoridade,
        situacao: d.situacao,
        fonte_url: d.fonte_url,
        texto_analisado: d.inteiro_teor && d.inteiro_teor.length > 3000 ? "inteiro_teor" : "ementa",
        inteiro_teor_baixado_agora: inteiroTeorBaixado || undefined,
      };

      let analise: (Ratio & { modelo: string }) | null = null;
      let avisoIa: string | undefined;
      if (usar_ia && opts.analista && estrutura.metodo !== "tese_firmada") {
        const guardada = acervo.lerAnalise<Ratio>(d.id, "ratio");
        if (guardada && !inteiroTeorBaixado) {
          analise = { ...guardada.conteudo, modelo: guardada.modelo };
        } else {
          try {
            const texto = [d.titulo, d.ementa && `EMENTA: ${d.ementa}`, d.tese && `TESE: ${d.tese}`, d.inteiro_teor && `TEXTO: ${d.inteiro_teor}`]
              .filter(Boolean)
              .join("\n\n")
              .slice(0, 400_000);
            const r = await opts.analista.extrairRatio(texto);
            acervo.gravarAnalise(d.id, "ratio", opts.analista.modelo, r);
            analise = { ...r, modelo: opts.analista.modelo };
          } catch (e) {
            avisoIa = `Análise automática indisponível: ${(e as Error).message}`;
          }
        }
      }

      const precisaLeitura = !analise && estrutura.metodo === "sem_estrutura";
      return ok({
        documento: cabecalho,
        estrutura_da_ementa: estrutura.metodo === "sem_estrutura" ? undefined : estrutura,
        analise_ia: analise ?? undefined,
        aviso: avisoIa,
        texto: precisaLeitura || (!analise && estrutura.metodo === "ementa_padrao_cnj")
          ? { ementa: d.ementa, inteiro_teor: d.inteiro_teor?.slice(0, 15_000), continua: (d.inteiro_teor?.length ?? 0) > 15_000 }
          : undefined,
        orientacao: analise
          ? "A ratio acima foi extraída automaticamente do texto indicado em texto_analisado; confira com o inteiro teor antes de citar."
          : estrutura.metodo === "tese_firmada"
            ? "Precedente qualificado: a tese firmada é a ratio decidendi."
            : "Identifique a ratio a partir do texto: a regra necessária e suficiente para o resultado, os fundamentos determinantes " +
              "(art. 489, § 1º, V, CPC), os obiter dicta e os fatos materiais. Se só houver ementa, diga que a análise é preliminar.",
      });
    }),
  );

  server.registerTool(
    "verificar_citacao",
    {
      title: "Verificar citação",
      description:
        "Confirma se um precedente citado existe (ex.: 'REsp 1.990.285/SP', 'Tema 988/STJ', ou número CNJ) ou se um " +
          "dispositivo legal está vigente (ex.: 'art. 1.022 do CPC': VIGENTE / REVOGADO). " +
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
      const r = verificarCitacao(acervo, citacao, relator);
      const legal = r.status === "NAO_RECONHECIDA" ? interpretarCitacaoLegal(citacao) : null;
      if (legal) {
        await garantirNorma(legal);
        const d = dispositivoCitado(legal);
        return ok(
          d
            ? { status: d.revogado ? "REVOGADO" : "VIGENTE", dispositivo: d }
            : { status: "NAO_INDEXADO", citacao: legal, observacao: "A norma ou o artigo não está no índice de legislação consolidada." },
        );
      }
      return ok(r);
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

  /** Importa sob demanda a norma citada que ainda não está no índice (texto atualizado da Câmara). */
  const garantirNorma = async (c: CitacaoLegal, prazoMs = 45_000): Promise<string | undefined> => {
    if (normaIndexada(acervo, c.norma)) return undefined;
    const n = c.avulsa ?? CATALOGO.find((x) => x.sigla === c.norma);
    if (!n) return undefined;
    let tarefa = importacoes.get(n.sigla);
    if (!tarefa) {
      tarefa = importarNorma(acervo, n, { fetchImpl: opts.fetchImpl }).then(() => undefined);
      importacoes.set(n.sigla, tarefa);
      tarefa.finally(() => importacoes.delete(n.sigla)).catch(() => {});
    }
    // A importação continua em segundo plano se passar do prazo; a próxima consulta já a encontra.
    let timer: NodeJS.Timeout | undefined;
    const prazo = new Promise<"prazo">((ok) => (timer = setTimeout(() => ok("prazo"), prazoMs)));
    try {
      const r = await Promise.race([tarefa.then(() => "ok" as const), prazo]);
      return r === "ok"
        ? `${n.nome} importada agora do texto consolidado.`
        : `${n.nome} está sendo importada; repita a consulta em instantes.`;
    } catch (e) {
      return `Não foi possível importar ${n.nome}: ${(e as Error).message}`;
    } finally {
      clearTimeout(timer);
    }
  };

  /** Dispositivo exato + vizinhos, para citações como "art. 14 do CDC". */
  const dispositivoCitado = (c: CitacaoLegal) => {
    const d = obterDispositivo(acervo, c.norma, c.artigo);
    if (!d) return null;
    return {
      id: d.id,
      norma: d.norma,
      norma_nome: d.norma_nome,
      rotulo: `${d.rotulo} (${d.norma})`,
      caminho: d.caminho,
      texto: d.texto,
      revogado: !!d.revogado,
      fonte_url: d.fonte_url,
      atualizado_em: d.atualizado_em,
    };
  };

  const vetorLegislacao = async (consulta: string) => (acervo.temVetoresLegislacao ? vetorDaConsulta(consulta) : null);

  server.registerTool(
    "buscar_legislacao",
    {
      title: "Buscar legislação atualizada",
      description:
        "Pesquisa a legislação federal consolidada (texto vigente, artigo por artigo): Constituição, códigos e as principais leis. " +
        "Aceita uma citação exata ('art. 14 do CDC', 'CC, art. 186', 'art. 5º, X, da CF') ou um assunto ('responsabilidade do " +
        "fornecedor por defeito do serviço'). Dispositivos revogados vêm marcados. Normas fora do índice são buscadas no LexML.",
      inputSchema: {
        consulta: z.string().min(2).describe("Citação de dispositivo ou assunto"),
        normas: z.array(z.string()).optional().describe("Restringe a normas, ex.: ['CDC','CC'] ou ['Código Civil']"),
        limite: z.number().int().min(1).max(30).optional(),
        incluir_revogados: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    protegido("buscar_legislacao", async ({ consulta, normas, limite, incluir_revogados }) => {
      const citacao = interpretarCitacaoLegal(consulta);
      const importacao = citacao ? await garantirNorma(citacao) : undefined;
      if (citacao) {
        const d = dispositivoCitado(citacao);
        if (d) {
          const doc = obterDispositivo(acervo, citacao.norma, citacao.artigo)!;
          return ok({
            estado: "ENCONTRADO",
            dispositivo: d,
            contexto: vizinhos(acervo, doc).map((v) => ({ rotulo: v.rotulo, texto: v.texto.slice(0, 600), revogado: !!v.revogado })),
            aviso: d.revogado ? "Dispositivo revogado: não o cite como direito vigente." : undefined,
            importacao,
          });
        }
      }
      const resultados = pesquisarDispositivos(acervo, consulta, {
        normas,
        limite,
        incluirRevogados: incluir_revogados,
        vetor: await vetorLegislacao(consulta),
      });
      if (resultados.length) {
        return ok({ estado: "ENCONTRADO", fonte: "texto consolidado indexado", resultados, normas_indexadas: undefined });
      }
      try {
        const sigen = await pesquisarSigen(consulta, { limite, fetchImpl: opts.fetchImpl });
        return ok({
          estado: sigen.normas.length ? "NORMAS_ENCONTRADAS" : "SEM_RESULTADO",
          fonte: "Catálogo de legislação do Senado (identificação da norma)",
          ...sigen,
          importacao,
          orientacao:
            "O texto destas normas ainda não está no índice. Para ler um artigo, chame buscar_legislacao com a citação " +
            "completa (ex.: 'art. 3º da Lei 13.146/2015'): a norma é importada do texto consolidado.",
        });
      } catch (e) {
        return ok({
          estado: citacao ? "NAO_INDEXADO" : "SEM_RESULTADO",
          mensagem:
            `Nada encontrado no índice de legislação consolidada${citacao ? ` para ${citacao.norma}, art. ${citacao.artigo}` : ""}. ` +
            "Não invente o texto do dispositivo; oriente o usuário a conferir no Planalto (https://www.planalto.gov.br/legislacao).",
        });
      }
    }),
  );

  server.registerTool(
    "analisar_caso",
    {
      title: "Analisar caso (legislação e jurisprudência aplicáveis)",
      description:
        "Recebe a narrativa dos fatos e devolve, para cada questão jurídica, os dispositivos legais vigentes, os precedentes " +
        "qualificados (súmulas, temas, IRDR) e a jurisprudência pertinente, com links oficiais. Antes de chamar, decomponha a " +
        "narrativa em 'questoes' (questão neutra + termos de busca + normas prováveis); sem 'questoes', o servidor tenta " +
        "identificá-las sozinho. Informe 'tribunais' (ex.: ['STJ','TJSP']) para incluir a jurisprudência local ao vivo.",
      inputSchema: {
        narrativa: z.string().min(30).describe("Narrativa dos fatos, como contada pelo cliente"),
        questoes: z
          .array(
            z.object({
              questao: z.string().describe("Questão jurídica controvertida, formulada de modo neutro"),
              termos_jurisprudencia: z.string().optional().describe("Consulta curta em linguagem de ementa"),
              termos_legislacao: z.string().optional().describe("Consulta curta para os dispositivos aplicáveis"),
              normas_provaveis: z.array(z.string()).optional().describe("Ex.: ['CDC, art. 14', 'CC, art. 186']"),
            }),
          )
          .max(8)
          .optional(),
        tribunais: z.array(z.string()).optional().describe("Tribunais de interesse; aceita ESTADUAIS, FEDERAIS etc."),
        limite_por_questao: z.number().int().min(1).max(10).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    protegido("analisar_caso", async ({ narrativa, questoes, tribunais, limite_por_questao = 5 }) => {
      let identificadas: Questoes | null = null;
      let avisoIa: string | undefined;
      if (!questoes?.length && opts.analista) {
        try {
          identificadas = await opts.analista.identificarQuestoes(narrativa);
        } catch (e) {
          avisoIa = `Identificação automática das questões indisponível: ${(e as Error).message}`;
        }
      }
      const lista =
        questoes?.length
          ? questoes
          : identificadas?.questoes ?? [{ questao: "Questões não decompostas: pesquisa feita sobre a narrativa inteira", termos_jurisprudencia: narrativa.slice(0, 500), termos_legislacao: narrativa.slice(0, 500) }];
      const alvo = tribunais?.length ? tribunais : identificadas?.tribunais_sugeridos;

      const todasFontes: RelatorioFonte[] = [];
      const analises = await Promise.all(
        lista.map(async (q) => {
          const termosJ = q.termos_jurisprudencia || q.questao;
          const termosL = q.termos_legislacao || q.questao;
          const citacoes = (q.normas_provaveis ?? []).map((n) => interpretarCitacaoLegal(n)).filter((c): c is CitacaoLegal => c !== null);
          await Promise.all(citacoes.map((c) => garantirNorma(c, 8_000)));
          const citadas = citacoes
            .map(dispositivoCitado)
            .filter((d): d is NonNullable<ReturnType<typeof dispositivoCitado>> => d !== null);
          const normasFiltro = [...new Set((q.normas_provaveis ?? []).map((n) => resolverNorma(n.split(",")[0])?.sigla).filter(Boolean))] as string[];
          const [porAssunto, qualificados, local] = await Promise.all([
            vetorLegislacao(termosL).then((vetor) =>
              pesquisarDispositivos(acervo, termosL, { normas: normasFiltro.length ? normasFiltro : undefined, limite: limite_por_questao, vetor }),
            ),
            buscarJurisprudencia({ consulta: termosJ, autoridade_minima: "B", limite: limite_por_questao }, false),
            buscarJurisprudencia({ consulta: termosJ, tribunais: alvo, limite: limite_por_questao }, !!alvo?.length),
          ]);
          todasFontes.push(...local.fontes);
          const legislacao = [...citadas.map((d) => ({ ...d, origem: "citada" })), ...porAssunto.map((d) => ({ ...d, origem: "pesquisa" }))].filter(
            (d, i, arr) => arr.findIndex((x) => x.id === d.id) === i,
          );
          const resumo = (x: (typeof local.r.resultados)[number]) => ({
            id: x.id,
            identificacao: x.identificacao,
            autoridade: x.autoridade,
            orgao: x.orgao,
            relator: x.relator,
            data_julgamento: x.data_julgamento,
            situacao: x.situacao,
            tese_ou_trecho: (x.tese ?? x.trecho).slice(0, 500),
            fonte_url: x.fonte_url,
          });
          const idsQualificados = new Set(qualificados.r.resultados.map((x) => x.id));
          return {
            questao: q.questao,
            legislacao: legislacao.slice(0, limite_por_questao + citadas.length),
            precedentes_qualificados: qualificados.r.resultados.map(resumo),
            jurisprudencia: local.r.resultados.filter((x) => !idsQualificados.has(x.id)).map(resumo),
          };
        }),
      );

      return ok({
        resumo_dos_fatos: identificadas?.resumo_dos_fatos,
        ramos_do_direito: identificadas?.ramos_do_direito,
        questoes_identificadas_por: questoes?.length ? "usuario" : identificadas ? `ia (${opts.analista!.modelo})` : "nenhum (narrativa inteira)",
        analise: analises,
        fatos_a_esclarecer: identificadas?.fatos_a_esclarecer,
        fontes_consultadas: todasFontes.length ? todasFontes : undefined,
        aviso: [avisoIa, avisoFalhas(todasFontes)].filter(Boolean).join(" ") || undefined,
        orientacao:
          "Para cada questão, confirme a pertinência lendo os dispositivos e as teses (use obter_documento e extrair_razao_decidir " +
          "nos julgados centrais). Fundamente com A e B antes de D, aponte divergências e o que depende de fatos a esclarecer. " +
          "Não cite dispositivo ou julgado que não esteja nesta resposta ou em outra ferramenta.",
      });
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
        legislacao_consolidada: normasIndexadas(acervo),
        pesquisa_ao_vivo: (opts.fontes ?? []).map((f) => ({ fonte: f.nome, tribunais: f.tribunais, consultada_por_padrao: f.padrao })),
        outras_consultas: ["DataJud/CNJ (metadados e movimentações processuais)", "Catálogo de legislação do Senado"],
        atualizacao: opts.permitirAtualizacao ? estadoAtualizacao() : undefined,
      }),
    ),
  );

  if (opts.permitirAtualizacao) {
    server.registerTool(
      "atualizar_acervo",
      {
        title: "Atualizar a base local",
        description:
          "Atualiza em segundo plano a base instalada neste computador: legislação consolidada, STJ (temas e acórdãos dos " +
          "últimos meses), enunciados do TST e Banco Nacional de Precedentes do CNJ; com chave da Voyage, também a busca " +
          "semântica. Use quando o usuário pedir para atualizar a base. A resposta volta na hora; o andamento aparece em listar_fontes.",
        inputSchema: {
          etapas: z
            .array(z.enum(ETAPAS))
            .optional()
            .describe("Padrão: todas. 'bnp' é a mais demorada (cerca de 15 min)."),
        },
        annotations: { readOnlyHint: false, openWorldHint: true },
      },
      protegido("atualizar_acervo", ({ etapas }) =>
        ok({
          ...iniciarAtualizacao(acervo, (etapas?.length ? etapas : [...ETAPAS]) as Etapa[], opts.embedder),
          orientacao: "A atualização roda em segundo plano; a base continua disponível. Consulte o andamento com listar_fontes.",
        }),
      ),
    );
  }

  server.registerPrompt(
    "analise_de_caso",
    {
      title: "Análise de caso a partir dos fatos",
      description: "Roteiro para indicar a legislação e a jurisprudência aplicáveis a uma narrativa de fatos.",
      argsSchema: { fatos: z.string().describe("Narrativa dos fatos") },
    },
    ({ fatos }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Fatos:\n${fatos}\n\n` +
              "1. Decomponha os fatos em questões jurídicas controvertidas (neutras), com termos de busca e normas prováveis.\n" +
              "2. Chame analisar_caso com essas questões e os tribunais pertinentes.\n" +
              "3. Para cada julgado central, use extrair_razao_decidir e verifique se os fatos materiais se aplicam ao caso (distinguishing).\n" +
              "4. Confira cada dispositivo com buscar_legislacao (texto vigente).\n" +
              "5. Responda como parecer, em prosa: enquadramento jurídico de cada questão, legislação aplicável (transcrevendo o " +
              "essencial do dispositivo), precedentes por ordem de autoridade (com tribunal, número, órgão, relator, data e link), " +
              "pontos controvertidos, fatos a esclarecer e próximos passos. Indique ao final as limitações da pesquisa.",
          },
        },
      ],
    }),
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
