/**
 * Atualização da base em segundo plano, disparada pela ferramenta atualizar_acervo
 * (útil na instalação local, em que o usuário não usa o terminal).
 */
import type { Acervo } from "./db.js";
import type { Embedder } from "./embeddings.js";
import { importarCatalogo } from "./legislacao/importar.js";
import { ingerirEspelhos, ingerirTemas } from "./ingest/stj.js";
import { ingerirEnunciadosTst } from "./ingest/tst.js";
import { ingerirBnp } from "./ingest/bnp.js";
import { vetorizarPendentes } from "./vetorizar.js";

export const ETAPAS = ["legislacao", "stj", "tst", "bnp", "vetorizar"] as const;
export type Etapa = (typeof ETAPAS)[number];

export interface EstadoAtualizacao {
  em_andamento: boolean;
  etapa_atual: string | null;
  iniciada_em: string | null;
  concluida_em: string | null;
  registro: string[];
  erros: string[];
}

const estado: EstadoAtualizacao = { em_andamento: false, etapa_atual: null, iniciada_em: null, concluida_em: null, registro: [], erros: [] };

export const estadoAtualizacao = (): EstadoAtualizacao => ({ ...estado, registro: estado.registro.slice(-15) });

/** Inicia a atualização (se não houver outra em curso) e retorna sem esperar o fim. */
export function iniciarAtualizacao(acervo: Acervo, etapas: Etapa[], embedder?: Embedder | null): EstadoAtualizacao {
  if (estado.em_andamento) return estadoAtualizacao();
  Object.assign(estado, { em_andamento: true, etapa_atual: null, iniciada_em: new Date().toISOString(), concluida_em: null, registro: [], erros: [] });
  const log = (m: string) => {
    estado.registro.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
    console.error(m);
  };
  void (async () => {
    for (const etapa of ETAPAS.filter((e) => etapas.includes(e))) {
      estado.etapa_atual = etapa;
      try {
        if (etapa === "legislacao") await importarCatalogo(acervo, undefined, log);
        if (etapa === "stj") {
          await ingerirTemas(acervo, { log });
          await ingerirEspelhos(acervo, { meses: 2, log });
        }
        if (etapa === "tst") await ingerirEnunciadosTst(acervo, log);
        if (etapa === "bnp") await ingerirBnp(acervo, { log });
        if (etapa === "vetorizar" && embedder) {
          acervo.prepararVetores(embedder.id, embedder.dimensoes);
          await vetorizarPendentes(acervo, embedder, { log: (m) => (estado.registro.length % 20 === 0 ? log(m) : undefined) });
        }
        log(`etapa ${etapa} concluída`);
      } catch (e) {
        estado.erros.push(`${etapa}: ${(e as Error).message}`);
        log(`etapa ${etapa} falhou: ${(e as Error).message}`);
      }
    }
    Object.assign(estado, { em_andamento: false, etapa_atual: null, concluida_em: new Date().toISOString() });
  })();
  return estadoAtualizacao();
}
