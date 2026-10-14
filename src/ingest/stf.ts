/**
 * Temas de Repercussão Geral pela exportação oficial do STF (tabela HTML servida como .xls).
 * Complementa o BNP com relator, leading case, datas e a tese na redação do STF.
 */
import type { Acervo, Documento } from "../db.js";
import { dataIso, limparHtml } from "../fontes/tipos.js";

const EXPORT =
  "https://portal.stf.jus.br/jurisprudenciaRepercussao/exportarDados.asp?situacaoAtual=S&tipoComRG=ComRG&tipoSemRG=SemRG&tipoSemRGQC=SemRGQC";
/** O portal do STF recusa clientes sem User-Agent de navegador. */
export const UA_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

/** Corrige células com UTF-8 decodificado duas vezes ("HÃ¡" → "Há"). */
export function corrigirMojibake(s: string): string {
  if (!/Ã|Â/.test(s)) return s;
  const r = Buffer.from(s, "latin1").toString("utf8");
  return r.includes("�") ? s : r;
}

export function lerTabelaRg(html: string, agora = new Date().toISOString()): Documento[] {
  const linhas = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const docs: Documento[] = [];
  for (const linha of linhas) {
    const celulas = [...linha.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (celulas.length < 14) continue;
    const txt = (i: number) => {
      const t = limparHtml(celulas[i]);
      return t && t !== "-" ? corrigirMojibake(t) : null;
    };
    const numero = String(Number(txt(0)));
    if (numero === "NaN") continue;
    const [, linkTema] = celulas.join(" ").match(/href="(https:\/\/portal\.stf\.jus\.br\/jurisprudenciaRepercussao\/detalharProcesso\.asp\?numeroTema=\d+)"/) ?? [];
    const haRepercussao = txt(9);
    const tese = txt(12);
    const situacao = txt(11);

    docs.push({
      // mesmo id do BNP: a versão do STF substitui a do BNP, mais pobre
      id: `BNP-STF-RG-${numero}`,
      tribunal: "STF",
      tipo: "precedente_qualificado",
      classe: "Tema",
      numero,
      registro: txt(1),
      orgao: "PLENÁRIO",
      relator: txt(2)?.replace(/^MIN(\.|ISTRO|ISTRA)\s*/i, "") ?? null,
      data_julgamento: dataIso(txt(10)),
      data_publicacao: dataIso(txt(13)),
      autoridade: tese ? "B" : "E",
      situacao: [situacao, haRepercussao && `Repercussão geral: ${haRepercussao}`].filter(Boolean).join(" — ") || null,
      titulo: `Tema ${numero} da Repercussão Geral/STF — ${txt(3) ?? ""}`.trim(),
      ementa: txt(4),
      tese,
      inteiro_teor: [txt(1) && `Leading case: ${txt(1)}`, txt(14) && `Observação: ${txt(14)}`].filter(Boolean).join("\n") || null,
      referencias: null,
      assuntos: txt(5) !== txt(4) ? txt(5) : null,
      fonte: "stf-repercussao-geral",
      fonte_url: linkTema ?? `https://portal.stf.jus.br/jurisprudenciaRepercussao/detalharProcesso.asp?numeroTema=${numero}`,
      atualizado_em: agora,
    });
  }
  return docs;
}

export async function ingerirRepercussaoGeral(acervo: Acervo, log: (m: string) => void = console.error): Promise<number> {
  const r = await fetch(EXPORT, { headers: { "User-Agent": UA_NAVEGADOR }, signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`STF exportação de RG: HTTP ${r.status}`);
  const docs = lerTabelaRg(await r.text());
  acervo.salvar(docs);
  acervo.registrarIngestao("stf-repercussao-geral", `export@${new Date().toISOString().slice(0, 10)}`, docs.length);
  log(`+ STF repercussão geral: ${docs.length} temas`);
  return docs.length;
}
