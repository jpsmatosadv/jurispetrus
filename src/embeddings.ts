/**
 * Provedores de embeddings para a busca semântica.
 *
 *  - voyage: API da Voyage AI (https://docs.voyageai.com/reference/embeddings-api)
 *  - openai: qualquer endpoint compatível com /v1/embeddings da OpenAI
 *            (OpenAI, Ollama, LM Studio, Text Embeddings Inference, vLLM...)
 *  - local:  modelo que roda no próprio computador, sem API (ver embeddings-local.ts)
 */
import { LocalEmbedder } from "./embeddings-local.js";

export type TipoTexto = "documento" | "consulta";

export interface Embedder {
  /** Identifica modelo e dimensão; vetores de modelos diferentes não são comparáveis. */
  readonly id: string;
  readonly dimensoes: number;
  vetorizar(textos: string[], tipo: TipoTexto): Promise<Float32Array[]>;
}

export interface ConfigEmbeddings {
  provedor: "voyage" | "openai" | "local" | "nenhum";
  modelo?: string;
  dimensoes?: number;
  url?: string;
  chave?: string;
  fetchImpl?: typeof fetch;
}

/** Normaliza para norma 1 (a distância cosseno no sqlite-vec fica estável). */
export function normalizar(v: Float32Array): Float32Array {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

async function postJson(fetchImpl: typeof fetch, url: string, chave: string | undefined, corpo: unknown): Promise<any> {
  for (let tentativa = 0; ; tentativa++) {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(chave ? { Authorization: `Bearer ${chave}` } : {}) },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(60_000),
    });
    if (r.ok) return r.json();
    // 429/5xx: espera exponencial, até 5 tentativas
    if ((r.status === 429 || r.status >= 500) && tentativa < 4) {
      await new Promise((ok) => setTimeout(ok, 1000 * 2 ** tentativa));
      continue;
    }
    throw new Error(`Embeddings: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}

class VoyageEmbedder implements Embedder {
  readonly id: string;
  constructor(
    private modelo: string,
    readonly dimensoes: number,
    private chave: string,
    private fetchImpl: typeof fetch,
  ) {
    this.id = `voyage:${modelo}:${dimensoes}`;
  }

  async vetorizar(textos: string[], tipo: TipoTexto): Promise<Float32Array[]> {
    const json = await postJson(this.fetchImpl, "https://api.voyageai.com/v1/embeddings", this.chave, {
      input: textos,
      model: this.modelo,
      input_type: tipo === "consulta" ? "query" : "document",
      output_dimension: this.dimensoes,
      truncation: true,
    });
    return (json.data as { index: number; embedding: number[] }[])
      .sort((a, b) => a.index - b.index)
      .map((d) => normalizar(Float32Array.from(d.embedding)));
  }
}

class OpenAICompativelEmbedder implements Embedder {
  readonly id: string;
  constructor(
    private url: string,
    private modelo: string,
    readonly dimensoes: number,
    private chave: string | undefined,
    private fetchImpl: typeof fetch,
  ) {
    this.id = `openai:${modelo}:${dimensoes}`;
  }

  async vetorizar(textos: string[], tipo: TipoTexto): Promise<Float32Array[]> {
    // Modelos E5/BGE/Nomic esperam prefixos distintos para consulta e documento.
    const prefixo = /e5/i.test(this.modelo) ? (tipo === "consulta" ? "query: " : "passage: ") : "";
    const json = await postJson(this.fetchImpl, `${this.url.replace(/\/$/, "")}/embeddings`, this.chave, {
      input: textos.map((t) => prefixo + t),
      model: this.modelo,
      ...(/text-embedding-3/.test(this.modelo) ? { dimensions: this.dimensoes } : {}),
    });
    return (json.data as { index: number; embedding: number[] }[])
      .sort((a, b) => a.index - b.index)
      .map((d) => {
        if (d.embedding.length !== this.dimensoes) {
          throw new Error(`O modelo devolveu ${d.embedding.length} dimensões; configure JURIS_EMBEDDINGS_DIM=${d.embedding.length}.`);
        }
        return normalizar(Float32Array.from(d.embedding));
      });
  }
}

export function criarEmbedder(c: ConfigEmbeddings): Embedder | null {
  const fetchImpl = c.fetchImpl ?? fetch;
  switch (c.provedor) {
    case "voyage":
      if (!c.chave) throw new Error("Defina VOYAGE_API_KEY para usar embeddings da Voyage AI.");
      return new VoyageEmbedder(c.modelo ?? "voyage-3.5", c.dimensoes ?? 1024, c.chave, fetchImpl);
    case "local":
      return new LocalEmbedder();
    case "openai":
      return new OpenAICompativelEmbedder(
        c.url ?? "https://api.openai.com/v1",
        c.modelo ?? "text-embedding-3-small",
        c.dimensoes ?? 1536,
        c.chave,
        fetchImpl,
      );
    default:
      return null;
  }
}

/** Texto representativo do documento para vetorização (cabe folgado no limite dos modelos). */
export function textoParaVetor(d: { titulo: string; ementa: string | null; tese: string | null; assuntos?: string | null }): string {
  return [d.titulo, d.tese && `Tese: ${d.tese}`, d.ementa, d.assuntos && `Assuntos: ${d.assuntos}`]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);
}
