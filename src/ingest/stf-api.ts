/**
 * Ingestão incremental do STF pela API da pesquisa de jurisprudência: acórdãos de controle
 * concentrado (ADI, ADC, ADO, ADPF) julgados nos últimos meses, com relator, redator do acórdão,
 * datas de julgamento e publicação e ementa.
 */
import type { Acervo, Documento } from "../db.js";
import { mapearAcordaoStf } from "../fontes/stf.js";
import { buscarComRetentativa } from "../fontes/tipos.js";

const API = "https://jurisprudencia.stf.jus.br/api/search/search";

export async function ingerirControleConcentradoStf(
  acervo: Acervo,
  opts: { meses?: number; log?: (m: string) => void; fetchImpl?: typeof fetch } = {},
): Promise<number> {
  const log = opts.log ?? console.error;
  const desde = new Date(Date.now() - (opts.meses ?? 6) * 31 * 86_400_000).toISOString().slice(0, 10);
  const agora = new Date().toISOString();
  let total = 0;
  for (let de = 0; de < 5000; de += 100) {
    const r = await buscarComRetentativa(API, {
      fetchImpl: opts.fetchImpl,
      signal: AbortSignal.timeout(60_000),
      tentativas: 3,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: {
          bool: {
            filter: [
              { term: { base: "acordaos" } },
              { terms: { "processo_classe_processual_unificada_classe_sigla.keyword": ["ADI", "ADC", "ADO", "ADPF"] } },
              { range: { julgamento_data: { gte: desde } } },
            ],
          },
        },
        sort: [{ julgamento_data: { order: "desc" } }],
        from: de,
        size: 100,
      }),
    });
    if (!r.ok) throw new Error(`STF: HTTP ${r.status}`);
    const j = (await r.json()) as { result?: { hits?: { hits?: { _source: Record<string, any> }[] } } };
    const hits = j.result?.hits?.hits ?? [];
    const docs = hits.map((h) => mapearAcordaoStf(h._source, agora)).filter((d): d is Documento => d !== null);
    if (docs.length) acervo.salvar(docs);
    total += docs.length;
    if (hits.length < 100) break;
  }
  acervo.registrarIngestao("stf-jurisprudencia", `controle-concentrado-desde-${desde}`, total);
  log(`STF: ${total} acórdãos de controle concentrado desde ${desde}`);
  return total;
}
