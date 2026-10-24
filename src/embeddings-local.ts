/**
 * Busca semântica sem API externa: o modelo granite-embedding-107m-multilingual (IBM,
 * licença Apache 2.0), em ONNX quantizado (int8), roda no próprio computador pelo
 * onnxruntime-node. Numa comparação com o multilingual-e5-small em ementas, separou melhor
 * o julgado pertinente dos demais.
 *
 * Os arquivos do modelo ficam em modelos/granite-embedding-107m-multilingual (baixados e
 * quantizados por scripts/baixar-modelo.sh) ou na pasta indicada em JURIS_MODELO_LOCAL.
 * O onnxruntime-node é carregado só quando o modelo é usado: se faltar o binário da
 * plataforma (ex.: Mac Intel), a busca continua só por palavras.
 */
import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizar, type Embedder, type TipoTexto } from "./embeddings.js";

export const MODELO_LOCAL = "granite-embedding-107m-multilingual";
export const ID_EMBEDDER_LOCAL = `local:${MODELO_LOCAL}:384`;
const MAX_TOKENS = 512;
const LOTE = 16;

/** Pasta do modelo: JURIS_MODELO_LOCAL ou modelos/ ao lado de dist/ (ou de server/, no pacote). */
export function pastaModeloLocal(): string {
  const env = process.env.JURIS_MODELO_LOCAL?.trim();
  if (env) return env;
  return fileURLToPath(new URL(`../modelos/${MODELO_LOCAL}`, import.meta.url));
}

export function modeloLocalPresente(pasta = pastaModeloLocal()): boolean {
  return ["model_quantized.onnx", "tokenizer.json", "tokenizer_config.json"].every((f) => existsSync(join(pasta, f)));
}

type Sessao = import("onnxruntime-node").InferenceSession;
type Ort = typeof import("onnxruntime-node");
type Tokenizador = import("@huggingface/tokenizers").Tokenizer;

export class LocalEmbedder implements Embedder {
  readonly id = ID_EMBEDDER_LOCAL;
  readonly dimensoes = 384;
  private carregando: Promise<{ ort: Ort; sessao: Sessao; tok: Tokenizador }> | null = null;
  /** Uma inferência por vez: o modelo já usa todos os núcleos. */
  private fila: Promise<unknown> = Promise.resolve();

  constructor(private pasta = pastaModeloLocal()) {}

  private carregar() {
    // Uma falha aqui é permanente (ex.: Mac Intel, sem binário do onnxruntime): fica guardada,
    // e a busca segue só por palavras sem tentar de novo a cada consulta.
    this.carregando ??= (async () => {
      const mod = await import("onnxruntime-node");
      const ort = ((mod as { default?: Ort }).default ?? mod) as Ort;
      const { Tokenizer } = await import("@huggingface/tokenizers");
      const ler = (f: string) => JSON.parse(readFileSync(join(this.pasta, f), "utf8"));
      const tok = new Tokenizer(ler("tokenizer.json"), ler("tokenizer_config.json"));
      const sessao = await ort.InferenceSession.create(join(this.pasta, "model_quantized.onnx"), {
        graphOptimizationLevel: "all",
        // deixa núcleos livres para o Claude e o sistema enquanto vetoriza em segundo plano
        intraOpNumThreads: Math.max(1, Math.floor(availableParallelism() / 2)),
      });
      return { ort, sessao, tok };
    })();
    this.carregando.catch((e) => console.error(`Modelo local indisponível; busca só por palavras: ${(e as Error).message}`));
    return this.carregando;
  }

  /** Carrega o modelo e informa se ele roda neste computador. */
  async disponivel(): Promise<boolean> {
    if (!modeloLocalPresente(this.pasta)) return false;
    return this.carregar().then(
      () => true,
      () => false,
    );
  }

  vetorizar(textos: string[], _tipo: TipoTexto): Promise<Float32Array[]> {
    const tarefa = this.fila.then(() => this.executar(textos));
    this.fila = tarefa.catch(() => {});
    return tarefa;
  }

  private async executar(textos: string[]): Promise<Float32Array[]> {
    const { ort, sessao, tok } = await this.carregar();
    const pad = BigInt(tok.token_to_id("<pad>") ?? 1);
    const codificados: number[][] = textos.map((t) => {
      const ids = tok.encode(t.replace(/\s+/g, " ").trim()).ids;
      // trunca mantendo o token final </s>
      return ids.length > MAX_TOKENS ? [...ids.slice(0, MAX_TOKENS - 1), ids[ids.length - 1]] : ids;
    });
    // agrupa textos de tamanho parecido para reduzir o preenchimento
    const ordem = codificados.map((_, i) => i).sort((a, b) => codificados[a].length - codificados[b].length);
    const saida: Float32Array[] = new Array(textos.length);
    const dim = this.dimensoes;
    for (let ini = 0; ini < ordem.length; ini += LOTE) {
      const idx = ordem.slice(ini, ini + LOTE);
      const comp = Math.max(...idx.map((i) => codificados[i].length));
      const n = idx.length;
      const ids = new BigInt64Array(n * comp).fill(pad);
      const mascara = new BigInt64Array(n * comp);
      idx.forEach((i, linha) => {
        codificados[i].forEach((id, j) => {
          ids[linha * comp + j] = BigInt(id);
          mascara[linha * comp + j] = 1n;
        });
      });
      const r = await sessao.run({
        input_ids: new ort.Tensor("int64", ids, [n, comp]),
        attention_mask: new ort.Tensor("int64", mascara, [n, comp]),
      });
      // o granite usa o estado do primeiro token (<s>, "CLS") como vetor do texto
      const h = r[sessao.outputNames[0]].data as Float32Array;
      idx.forEach((i, linha) => {
        saida[i] = normalizar(Float32Array.from(h.subarray(linha * comp * dim, linha * comp * dim + dim)));
      });
    }
    return saida;
  }
}
