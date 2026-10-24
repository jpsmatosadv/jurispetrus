/**
 * Análise jurídica com Claude no servidor (opcional, ativada por ANTHROPIC_API_KEY).
 * Sem a chave, as ferramentas devolvem o material estruturado e o próprio Claude do
 * usuário faz a análise na conversa.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

export const RatioSchema = z.object({
  questao_juridica: z.string().describe("A questão de direito efetivamente decidida, em uma frase"),
  ratio_decidendi: z
    .string()
    .describe("A regra jurídica necessária e suficiente para o resultado, formulada de modo aplicável a casos futuros"),
  fundamentos_determinantes: z.array(z.string()).describe("Fundamentos sem os quais o resultado seria outro (art. 489, § 1º, V, do CPC)"),
  obiter_dicta: z.array(z.string()).describe("Considerações laterais, não necessárias ao resultado"),
  fatos_relevantes: z.array(z.string()).describe("Fatos materiais que delimitam o alcance da ratio (para distinguishing)"),
  dispositivos_legais: z.array(z.string()).describe("Dispositivos legais aplicados, ex.: 'CDC, art. 14'"),
  precedentes_citados: z.array(z.string()),
  resultado: z.string().describe("Desfecho: provido, desprovido, parcialmente provido etc."),
  suficiencia_do_texto: z
    .enum(["completa", "parcial", "insuficiente"])
    .describe("Se o texto disponível (ementa/espelho) basta para identificar a ratio com segurança"),
});
export type Ratio = z.infer<typeof RatioSchema>;

export const QuestoesSchema = z.object({
  resumo_dos_fatos: z.string(),
  ramos_do_direito: z.array(z.string()),
  questoes: z
    .array(
      z.object({
        questao: z.string().describe("Questão jurídica controvertida, formulada de modo neutro"),
        termos_jurisprudencia: z.string().describe("Consulta curta em linguagem de ementa para buscar julgados"),
        consultas_alternativas: z
          .array(z.string())
          .describe("De 2 a 4 outras formulações da mesma busca, com os sinônimos e expressões que os tribunais usam nas ementas"),
        termos_legislacao: z.string().describe("Consulta curta para buscar os dispositivos legais aplicáveis"),
        normas_provaveis: z.array(z.string()).describe("Normas possivelmente aplicáveis, ex.: 'CDC, art. 14', 'CC, art. 186'"),
      }),
    )
    .describe("De 1 a 6 questões, da mais à menos decisiva"),
  fatos_a_esclarecer: z.array(z.string()).describe("Informações ausentes que podem mudar o enquadramento"),
  tribunais_sugeridos: z.array(z.string()).describe("Siglas pertinentes (ex.: STJ, TJSP, TRF4, TST)"),
});
export type Questoes = z.infer<typeof QuestoesSchema>;

const SISTEMA_RATIO = `Você é um assistente de pesquisa jurídica brasileira. Recebe o texto de um julgado (ementa, espelho, tese ou inteiro teor) e identifica a ratio decidendi segundo a teoria dos precedentes adotada no CPC/2015 (arts. 489, § 1º, V e VI, 926 e 927): a regra jurídica necessária e suficiente para o resultado, separada dos obiter dicta e dos fatos materiais que delimitam seu alcance.
Use apenas o texto fornecido; não acrescente fatos, dispositivos ou precedentes que não estejam nele. Se o texto for só uma ementa, marque a suficiência como "parcial" ou "insuficiente" quando a fundamentação não estiver visível. Escreva em português jurídico claro e direto.`;

const SISTEMA_QUESTOES = `Você é um assistente de pesquisa jurídica brasileira. A partir de uma narrativa de fatos, identifique as questões jurídicas controvertidas e prepare consultas de pesquisa em linguagem de ementa e de legislação.
Não decida o caso nem invente fatos. Formule cada questão de modo neutro (sem tomar partido), indique as normas provavelmente aplicáveis pelo nome usual e artigo quando houver segurança, e liste os fatos ausentes que podem mudar o enquadramento.`;

export const TriagemSchema = z.object({
  avaliacoes: z.array(
    z.object({
      id: z.string().describe("Id do candidato, exatamente como recebido"),
      pertinencia: z.enum(["alta", "media", "baixa", "nenhuma"]),
      motivo: z.string().describe("Uma frase: por que o julgado serve (ou não) à questão"),
    }),
  ),
});
export type Triagem = z.infer<typeof TriagemSchema>;

const SISTEMA_TRIAGEM = `Você é um assistente de pesquisa jurídica brasileira. Recebe uma questão (e, às vezes, os fatos do caso) e uma lista de julgados candidatos, cada um com id, identificação e trecho da ementa ou tese. Avalie a pertinência de cada candidato à questão:
- alta: decide a mesma questão jurídica, em situação de fato semelhante;
- media: trata da mesma questão, mas em contexto diferente, ou de questão conexa útil;
- baixa: só tangencia o tema;
- nenhuma: não trata do tema (coincidência de palavras).
Julgue apenas pelo texto fornecido, sem acrescentar informação. Avalie todos os candidatos, usando os ids exatamente como vieram.`;

export class AnalistaIA {
  private client: Anthropic;
  constructor(
    readonly modelo = "claude-opus-5-5",
    chave?: string,
  ) {
    this.client = new Anthropic(chave ? { apiKey: chave } : {});
  }

  private async estruturado<T>(sistema: string, conteudo: string, schema: z.ZodType<T>, effort: "low" | "medium" | "high"): Promise<T> {
    const r = await this.client.beta.messages.parse({
      model: this.modelo,
      max_tokens: 16000,
      // Recusa por classificador de segurança: a API repete o pedido em um modelo alternativo.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: conteudo }],
      output_config: { effort, format: betaZodOutputFormat(schema) },
    });
    if (r.stop_reason === "refusal") throw new Error("A análise automática foi recusada pelo modelo.");
    if (r.stop_reason === "max_tokens") throw new Error("A análise automática foi interrompida por limite de tamanho.");
    if (!r.parsed_output) throw new Error("A análise automática não retornou o formato esperado.");
    return r.parsed_output as T;
  }

  extrairRatio(texto: string): Promise<Ratio> {
    return this.estruturado(SISTEMA_RATIO, `<julgado>\n${texto}\n</julgado>`, RatioSchema, "medium");
  }

  /** Avalia a pertinência de cada candidato à questão (reordenação dos resultados da pesquisa). */
  triar(questao: string, candidatos: { id: string; identificacao: string; texto: string }[]): Promise<Triagem> {
    const lista = candidatos.map((c) => `<candidato id="${c.id}">\n${c.identificacao}\n${c.texto}\n</candidato>`).join("\n");
    return this.estruturado(SISTEMA_TRIAGEM, `<questao>\n${questao}\n</questao>\n<candidatos>\n${lista}\n</candidatos>`, TriagemSchema, "low");
  }

  identificarQuestoes(narrativa: string): Promise<Questoes> {
    return this.estruturado(SISTEMA_QUESTOES, `<narrativa>\n${narrativa}\n</narrativa>`, QuestoesSchema, "medium");
  }
}

export function criarAnalista(): AnalistaIA | null {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave || process.env.JURIS_IA === "desligada") return null;
  return new AnalistaIA(process.env.JURIS_IA_MODELO || "claude-opus-5-5", chave);
}
