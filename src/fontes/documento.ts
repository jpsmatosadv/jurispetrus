/** Texto de um documento oficial em HTML ou PDF (leitura de PDF serializada). */
import { extractText, getDocumentProxy } from "unpdf";
import { buscarComRetentativa, lerTexto, limparHtml } from "./tipos.js";

/** A leitura de PDF não é segura em paralelo: serializa as extrações (os downloads seguem em paralelo). */
let filaPdf: Promise<unknown> = Promise.resolve();
function emFila<T>(tarefa: () => Promise<T>): Promise<T> {
  const r = filaPdf.then(tarefa, tarefa);
  filaPdf = r.catch(() => undefined);
  return r;
}

export async function textoDoDocumento(url: string, fetchImpl?: typeof fetch, prazoMs = 45_000, headers?: Record<string, string>): Promise<string> {
  const r = await buscarComRetentativa(url, { fetchImpl, signal: AbortSignal.timeout(prazoMs), tentativas: 2, headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const tipo = r.headers.get("content-type") ?? "";
  if (/html|text\//.test(tipo)) return limparHtml(await lerTexto(r)) ?? "";
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > 25_000_000) throw new Error("documento grande demais");
  return emFila(async () => {
    // verbosity 0: sem os avisos de fonte do pdf.js no log
    const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
    const { text } = await extractText(pdf, { mergePages: true });
    return text as string;
  });
}

