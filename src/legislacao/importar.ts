/** Importa normas para o índice de dispositivos: Câmara (texto atualizado) e, na falha, normas.leg.br. */
import type { Acervo } from "../db.js";
import { buscarComRetentativa, lerTexto } from "../fontes/tipos.js";
import { CAMINHOS_CAMARA, CATALOGO, type NormaCatalogo } from "./catalogo.js";
import { baixarDaCamara, baixarDoNormasLeg, pesquisarSigen, type ResultadoDownload } from "./fontes.js";
import { salvarNorma } from "./indice.js";

const TIPO_BUSCA_CAMARA: Record<string, string> = {
  LEI: "Lei Ordinária",
  LCP: "Lei Complementar",
  DEL: "Decreto-Lei",
  DEC: "Decreto",
  MPV: "Medida Provisória",
};

/** Descobre na busca da Câmara o caminho da "norma atualizada" (tipo + número + ano). */
export async function descobrirCaminhoCamara(n: NormaCatalogo, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (CAMINHOS_CAMARA[n.sigla]) return CAMINHOS_CAMARA[n.sigla];
  const tipo = TIPO_BUSCA_CAMARA[n.tipo];
  if (!tipo) throw new Error(`Tipo de norma sem busca na Câmara: ${n.tipo}`);
  const p = new URLSearchParams({ numero: n.numero, ano: String(n.ano), tipo });
  const r = await buscarComRetentativa(`https://www.camara.leg.br/legislacao/busca?${p}`, { fetchImpl, signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`Busca da Câmara respondeu HTTP ${r.status}`);
  const html = await lerTexto(r);
  const links = [...html.matchAll(/https:\/\/www2\.camara\.leg\.br\/legin\/fed\/([^"']+?)-norma-(p[le])\.html/g)];
  const certo = links.find((l) => l[1].includes(`-${n.numero}-`) && l[1].includes(String(n.ano))) ?? links[0];
  if (!certo) throw new Error(`Norma ${n.nome} não encontrada na busca da Câmara`);
  return `${certo[1]}-normaatualizada-${certo[2]}`;
}

export async function importarNorma(
  acervo: Acervo,
  n: NormaCatalogo,
  opts: { fetchImpl?: typeof fetch; log?: (m: string) => void } = {},
): Promise<{ fonte: string; dispositivos: number; revogados: number }> {
  const erros: string[] = [];
  let r: ResultadoDownload | null = null;
  try {
    const caminho = await descobrirCaminhoCamara(n, opts.fetchImpl);
    // na página da CF vem também o ADCT, que é importado separadamente
    r = await baixarDaCamara(caminho, { fetchImpl: opts.fetchImpl, pararEm: n.sigla === "CF" ? /^ATO DAS DISPOSI[ÇC][ÕO]ES CONSTITUCIONAIS TRANSIT[ÓO]RIAS/i : undefined });
  } catch (e) {
    erros.push((e as Error).message);
  }
  let urn = n.urn;
  if (!r && !urn) {
    // norma avulsa: a URN vem do catálogo do Senado
    try {
      const tipoSigen = { LEI: "lei", LCP: "lei.complementar", DEL: "decreto.lei", DEC: "decreto", MPV: "medida.provisoria" }[n.tipo];
      const achadas = await pesquisarSigen(`numero:${n.numero} AND tipo:${tipoSigen ?? "lei"}`, { limite: 20, fetchImpl: opts.fetchImpl });
      urn = achadas.normas.find((x) => x.urn?.includes(`;${n.numero}`) && x.urn.includes(`:${n.ano}-`))?.urn ?? "";
    } catch (e) {
      erros.push((e as Error).message);
    }
  }
  if (!r && urn) {
    try {
      r = await baixarDoNormasLeg(urn, opts.fetchImpl);
    } catch (e) {
      erros.push((e as Error).message);
    }
  }
  if (!r) throw new Error(`Não foi possível importar ${n.nome}: ${erros.join(" | ")}`);
  salvarNorma(acervo, { sigla: n.sigla, nome: n.nome, urn: urn || undefined, fonte: r.fonte, fonte_url: r.fonte_url, versao: r.versao }, r.dispositivos);
  const revogados = r.dispositivos.filter((d) => d.revogado).length;
  opts.log?.(`+ ${n.sigla}: ${r.dispositivos.length} artigos (${revogados} revogados) via ${r.fonte}`);
  return { fonte: r.fonte, dispositivos: r.dispositivos.length, revogados };
}

export async function importarCatalogo(acervo: Acervo, siglas?: string[], log: (m: string) => void = console.error): Promise<number> {
  let total = 0;
  for (const n of CATALOGO.filter((c) => !siglas?.length || siglas.includes(c.sigla))) {
    try {
      total += (await importarNorma(acervo, n, { log })).dispositivos;
    } catch (e) {
      log(`! ${n.sigla}: ${(e as Error).message}`);
    }
  }
  return total;
}
