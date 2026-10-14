import { resolve } from "node:path";

export const config = {
  /** Caminho do banco SQLite com o acervo indexado. */
  dbPath: resolve(process.env.JURIS_DB_PATH ?? "data/acervo.db"),
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  /** Hosts aceitos no cabeçalho Host (proteção contra DNS rebinding). Vazio = qualquer. */
  allowedHosts: (process.env.JURIS_ALLOWED_HOSTS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  /**
   * Chaves de acesso aceitas (separadas por vírgula). Vazio = servidor aberto.
   * O cliente envia `Authorization: Bearer <chave>` ou `?key=<chave>` na URL do conector.
   */
  apiKeys: (process.env.JURIS_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  /** Limite de chamadas de ferramenta por chave por mês (0 = ilimitado). */
  cotaMensal: Number(process.env.JURIS_COTA_MENSAL ?? 0),
  datajudKey: process.env.DATAJUD_API_KEY,
  /** Busca semântica: provedor de embeddings (voyage | openai | nenhum). */
  embeddings: {
    provedor: (process.env.JURIS_EMBEDDINGS ?? "nenhum") as "voyage" | "openai" | "nenhum",
    modelo: process.env.JURIS_EMBEDDINGS_MODEL || undefined,
    dimensoes: process.env.JURIS_EMBEDDINGS_DIM ? Number(process.env.JURIS_EMBEDDINGS_DIM) : undefined,
    url: process.env.JURIS_EMBEDDINGS_URL || undefined,
    chave: process.env.VOYAGE_API_KEY || process.env.JURIS_EMBEDDINGS_KEY || undefined,
  },
  /** Tempo máximo (ms) de espera pelas fontes consultadas ao vivo. */
  timeoutFontes: Number(process.env.JURIS_TIMEOUT_FONTES ?? 20000),
};
