/**
 * Índice leve dos acórdãos das Turmas do STJ desde 2022 (espelhos dos Dados Abertos), baixado
 * sob demanda no computador do usuário. Serve para conferir citações pelo número quando o portal
 * do STJ recusa o acesso; não entra na pesquisa por tema nem na busca semântica.
 */
import type { Acervo } from "../db.js";
import { baixar, mapearEspelho, PACOTES_ESPELHOS, recursos } from "./stj.js";

const FONTE = "stj-indice-turmas";

export async function ingerirIndiceTurmasStj(
  acervo: Acervo,
  opts: { paralelo?: number; log?: (m: string) => void; pacotes?: string[] } = {},
): Promise<number> {
  const log = opts.log ?? console.error;
  const pacotes = opts.pacotes ?? PACOTES_ESPELHOS.filter((p) => /turma/.test(p));
  const pendentes: { chave: string; url: string }[] = [];
  for (const pacote of pacotes) {
    for (const rec of (await recursos(pacote)).filter((r) => /^\d{8}\.json$/i.test(r.name))) {
      const chave = `${pacote}/${rec.name}`;
      if (!acervo.jaIngerido(FONTE, chave)) pendentes.push({ chave, url: rec.url });
    }
  }
  log(`Índice das Turmas do STJ: ${pendentes.length} arquivos mensais a baixar`);
  let total = 0;
  let feitos = 0;
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < pendentes.length) {
      const { chave, url } = pendentes[proximo++];
      try {
        const dados = JSON.parse(await baixar(url)) as Record<string, any>[];
        const linhas = dados
          .map((e) => mapearEspelho(e))
          .filter((d): d is NonNullable<typeof d> => d !== null && !!d.numero)
          .map((d) => ({
            id: d.id,
            classe: d.classe,
            numero: d.numero!.replace(/\D/g, ""),
            orgao: d.orgao,
            relator: d.relator,
            data_julgamento: d.data_julgamento,
            data_publicacao: d.data_publicacao,
            // o início da ementa basta para reconhecer o assunto; o texto completo fica no portal
            ementa: d.ementa ? d.ementa.replace(/\s+/g, " ").slice(0, 700) : null,
            fonte_url: d.fonte_url,
          }));
        acervo.salvarIndiceStj(linhas);
        acervo.registrarIngestao(FONTE, chave, linhas.length);
        total += linhas.length;
        if (++feitos % 10 === 0 || feitos === pendentes.length) log(`Índice das Turmas do STJ: ${feitos}/${pendentes.length} arquivos, ${total} acórdãos`);
      } catch (e) {
        log(`! ${chave}: ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.paralelo ?? 4) }, trabalhador));
  return total;
}
