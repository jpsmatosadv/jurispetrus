import { Acervo } from "./src/db.ts"; import { LocalEmbedder } from "./src/embeddings-local.ts"; import { vetorizarEmSegundoPlano } from "./src/vetorizar-fundo.ts";
const P = "/tmp/claude-0/-home-user-jurispetrus/ab6319e0-e051-5ce9-806f-da87fc32d52b/scratchpad/v.db";
const a = new Acervo(P); const e = new LocalEmbedder(); const t = Date.now();
const n = await vetorizarEmSegundoPlano(a, e, { trava: P + ".vetorizando", lote: 64, log: (m) => console.log(m, `${Math.round((Date.now() - t) / 1000)}s`) });
console.log("total", n, a.estatisticas().busca_semantica);
