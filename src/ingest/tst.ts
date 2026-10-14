/** Ingestão das súmulas, orientações jurisprudenciais e precedentes normativos do TST. */
import type { Acervo, Documento } from "../db.js";
import { mapearRegistroTst } from "../fontes/tst.js";

const API = "https://jurisprudencia-backend.tst.jus.br/rest/pesquisa-textual";

export async function ingerirEnunciadosTst(acervo: Acervo, log: (m: string) => void = console.error): Promise<number> {
  let total = 0;
  for (const tipo of ["SUM", "OJ", "PN"]) {
    // OJ traz também as transitórias (OJT); 1000 cobre cada espécie inteira numa página.
    const r = await fetch(`${API}/1/1000`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipos: [tipo], orgao: "TST", ordenacao: "numero" }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!r.ok) throw new Error(`TST (${tipo}): HTTP ${r.status}`);
    const j = (await r.json()) as { registros?: { registro: Record<string, any> }[] };
    const agora = new Date().toISOString();
    const docs = (j.registros ?? []).map((x) => mapearRegistroTst(x.registro, agora)).filter((d): d is Documento => d !== null);
    acervo.salvar(docs);
    acervo.registrarIngestao("tst-enunciados", `${tipo}@${agora.slice(0, 10)}`, docs.length);
    log(`+ TST ${tipo}: ${docs.length}`);
    total += docs.length;
  }
  return total;
}
