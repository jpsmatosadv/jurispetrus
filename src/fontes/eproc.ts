/**
 * Módulo de jurisprudência do eproc — o mesmo HTML em vários tribunais
 * (TRF4, TRF2, TJSC, TJRJ e TJSP no 2º grau eletrônico).
 */
import type { Documento } from "../db.js";
import { autoridadePorOrgao, dataBr, dataIso, dataPlausivel, idEstavel, lerTexto, limparHtml, type FonteAoVivo } from "./tipos.js";

export const PORTAIS_EPROC: Record<string, string> = {
  TRF4: "https://jurisprudencia.trf4.jus.br/eproc2trf4",
  TRF2: "https://eproc.trf2.jus.br/eproc",
  TJSC: "https://eprocwebcon.tjsc.jus.br/consulta2g",
  TJRJ: "https://eproc2g.tjrj.jus.br/eproc",
  TJSP: "https://eproc2g.tjsp.jus.br/eproc",
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

/** Extrai pares rótulo → valor de um bloco de resultado (prefere o valor "completo"). */
function campos(bloco: string): Map<string, string> {
  const m = new Map<string, string>();
  const partes = bloco.split(/<div class="resLabel">/).slice(1);
  for (const parte of partes) {
    // No TJSC o rótulo traz links e ícones depois do texto: fica só o primeiro nó de texto.
    const rotulo = semAcento(limparHtml(parte.slice(0, parte.search(/<(?!\/?(?:b|font)\b)/i))) ?? "");
    const completo = parte.match(/<div class="resValue completo"[^>]*>([\s\S]*?)<\/div>/);
    const simples = parte.match(/<div class="resValue[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const valor = limparHtml((completo ?? simples)?.[1]);
    if (rotulo && valor && !m.has(rotulo)) m.set(rotulo, valor);
  }
  return m;
}

export function lerResultadosEproc(html: string, tribunal: string, base: string, agora: string): Documento[] {
  const docs: Documento[] = [];
  const blocos = html.split(/<div id="(\d{15,})">\s*<div class="card-body/).slice(1);
  for (let i = 0; i < blocos.length; i += 2) {
    const idJuris = blocos[i];
    const bloco = blocos[i + 1];
    const c = campos(bloco);
    const ementa = c.get("EMENTA");
    if (!ementa) continue;
    const processo = limparHtml(bloco.match(/class="numero-processo">([\s\S]*?)<\/a>/)?.[1])?.replace(/\/[A-Z0-9]+$/, "") ?? null;
    const classeTxt = limparHtml(bloco.match(/class="numero-processo">[\s\S]*?<span>([\s\S]*?)<\/span>/)?.[1]);
    const classe = classeTxt?.split(" - ").slice(1).join(" - ") || classeTxt || null;
    const tipoDecisao = limparHtml(bloco.match(/resValueTipoJurisprudencia">([\s\S]*?)<\/div>/)?.[1]) ?? "Acórdão";
    const relator = [...c.entries()].find(([k]) => k.startsWith("RELATOR"))?.[1] ?? null;
    const orgao = c.get("ORGAO JULGADOR") ?? null;
    const monocratica = /monocr/i.test(tipoDecisao);
    docs.push({
      id: idEstavel(tribunal, "EPROC", idJuris),
      tribunal,
      tipo: monocratica ? "decisao_monocratica" : "acordao",
      classe,
      numero: processo,
      registro: processo?.replace(/\D/g, "") ?? null,
      orgao,
      relator,
      data_julgamento: dataPlausivel(dataIso(c.get("DATA DO JULGAMENTO") ?? c.get("DATA DA DECISAO"))),
      data_publicacao: dataPlausivel(dataIso(c.get("DATA DA PUBLICACAO"))),
      autoridade: monocratica ? "E" : autoridadePorOrgao(orgao),
      situacao: null,
      titulo: `${tipoDecisao} ${tribunal} — ${classe ?? "Processo"} ${processo ?? ""}${orgao ? ` — ${orgao}` : ""}`.trim(),
      ementa,
      tese: null,
      inteiro_teor: c.get("DECISAO") ? `Decisão: ${c.get("DECISAO")}` : null,
      referencias: null,
      assuntos: null,
      fonte: "eproc-jurisprudencia",
      fonte_url: `${base}/externo_controlador.php?acao=jurisprudencia@jurisprudencia/download_inteiro_teor&id_jurisprudencia=${idJuris}`,
      atualizado_em: agora,
    });
  }
  return docs;
}

/** Uma fonte por tribunal, para o relatório indicar exatamente qual portal falhou. */
export function fonteEproc(tribunal: string): FonteAoVivo {
  const base = PORTAIS_EPROC[tribunal];
  return {
    id: `eproc-${tribunal.toLowerCase()}`,
    nome: `${tribunal} — jurisprudência do eproc${tribunal === "TJSP" || tribunal === "TJRJ" ? " (processos eletrônicos no eproc)" : ""}`,
    tribunais: [tribunal],
    padrao: false,
    async pesquisar(f, ctx) {
      const corpo = new URLSearchParams({
        txtPesquisa: f.consulta,
        rdoCampo: "E",
        hdnPaginaAtual: "1",
        selTamanhoPagina: String(Math.min(Math.max(f.limite, 10), 50)),
      });
      if (f.data_inicio) corpo.set("dtDecisaoInicio", dataBr(f.data_inicio));
      if (f.data_fim) corpo.set("dtDecisaoFim", dataBr(f.data_fim));
      const r = await ctx.fetch(`${base}/externo_controlador.php?acao=jurisprudencia@jurisprudencia/listar_resultados`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: corpo,
        signal: ctx.signal,
      });
      if (!r.ok) throw new Error(`${tribunal} (eproc) respondeu HTTP ${r.status}`);
      return lerResultadosEproc(await lerTexto(r), tribunal, base, ctx.agora).slice(0, f.limite);
    },
  };
}
