/**
 * Vetorização em segundo plano para a busca semântica local: na primeira execução (e depois,
 * para os julgados novos trazidos dos portais), gera os vetores que faltam no acervo sem
 * bloquear as pesquisas. Um arquivo de trava evita que várias cópias do servidor abertas pelo
 * Claude Desktop façam o mesmo trabalho ao mesmo tempo.
 */
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Acervo } from "./db.js";
import type { Embedder } from "./embeddings.js";
import { vetorizarPendentes } from "./vetorizar.js";

function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Tenta obter a trava; libera uma trava de processo que já terminou. */
export function travar(caminho: string): (() => void) | null {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const fd = openSync(caminho, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      const liberar = () => rmSync(caminho, { force: true });
      process.once("exit", liberar);
      return liberar;
    } catch {
      const dono = Number(readFileSync(caminho, "utf8").trim());
      if (dono && processoVivo(dono)) return null;
      rmSync(caminho, { force: true });
    }
  }
  return null;
}

export async function vetorizarEmSegundoPlano(
  acervo: Acervo,
  embedder: Embedder & { disponivel?: () => Promise<boolean> },
  opts: { trava: string; log?: (m: string) => void; lote?: number },
): Promise<number> {
  const log = opts.log ?? ((m: string) => console.error(m));
  if (!acervo.vetoresDisponiveis) return 0;
  if (embedder.disponivel && !(await embedder.disponivel())) return 0;
  const liberar = travar(opts.trava);
  if (!liberar) return 0; // outra cópia do servidor já está vetorizando
  try {
    if (acervo.modeloVetorial !== embedder.id) {
      // índice ausente ou de outro modelo: (re)cria para o modelo local
      acervo.prepararVetores(embedder.id, embedder.dimensoes, acervo.modeloVetorial !== null);
    }
    const inicio = Date.now();
    let feitos = 0;
    // lotes pequenos, com pausa entre eles: as consultas do usuário passam na frente
    for (;;) {
      const n = await vetorizarPendentes(acervo, embedder, { lote: opts.lote ?? 32, maximo: opts.lote ?? 32 });
      if (!n) break;
      feitos += n;
      if (feitos % 1024 < n) log(`Busca semântica local: ${feitos} textos vetorizados`);
      await new Promise((ok) => setTimeout(ok, 50));
    }
    if (feitos) log(`Busca semântica local: ${feitos} textos vetorizados em ${Math.round((Date.now() - inicio) / 1000)} s`);
    return feitos;
  } finally {
    liberar();
  }
}
