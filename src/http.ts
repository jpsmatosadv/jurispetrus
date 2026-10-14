import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { Acervo } from "./db.js";
import { criarServidor } from "./server.js";
import { criarEmbedder, type Embedder } from "./embeddings.js";
import { FONTES } from "./fontes/index.js";

/** Contador de chamadas por chave e mês, em memória (reinicia junto com o processo). */
export class Cota {
  private usos = new Map<string, number>();
  constructor(private limite: number) {}

  consumir(chave: string, agora = new Date()): void {
    if (!this.limite) return;
    const k = `${chave}:${agora.toISOString().slice(0, 7)}`;
    const n = (this.usos.get(k) ?? 0) + 1;
    if (n > this.limite) {
      throw new Error(`Cota mensal de ${this.limite} chamadas esgotada. Renova no primeiro dia do próximo mês.`);
    }
    this.usos.set(k, n);
  }
}

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function extrairChave(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const q = req.query.key;
  return typeof q === "string" ? q : null;
}

export function criarApp(acervo: Acervo, opts = config, embedder: Embedder | null = criarEmbedder(opts.embeddings)) {
  const app = createMcpExpressApp({
    host: opts.host,
    allowedHosts: opts.allowedHosts.length ? opts.allowedHosts : undefined,
  });
  const cota = new Cota(opts.cotaMensal);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, documentos: acervo.estatisticas().total });
  });

  const autenticar = (req: Request, res: Response, next: NextFunction) => {
    if (!opts.apiKeys.length) {
      res.locals.chave = "anonimo";
      return next();
    }
    const chave = extrairChave(req);
    if (!chave || !opts.apiKeys.some((k) => iguais(k, chave))) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Chave de acesso inválida ou ausente." }, id: null });
      return;
    }
    res.locals.chave = chave;
    next();
  };

  // Modo stateless: um servidor/transporte por requisição, sem sessão em memória.
  app.post("/mcp", autenticar, async (req, res) => {
    const server = criarServidor(acervo, {
      datajudKey: opts.datajudKey,
      antesDeChamar: () => cota.consumir(res.locals.chave),
      embedder,
      fontes: FONTES,
      timeoutFontes: opts.timeoutFontes,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("Erro ao tratar requisição MCP:", e);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Erro interno" }, id: null });
      }
    }
  });

  const naoPermitido = (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Método não permitido." }, id: null });
  };
  app.get("/mcp", naoPermitido);
  app.delete("/mcp", naoPermitido);

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const acervo = new Acervo(config.dbPath);
  criarApp(acervo).listen(config.port, config.host, () => {
    const { total } = acervo.estatisticas();
    console.error(`JurisPetrus MCP em http://${config.host}:${config.port}/mcp — ${total} documentos indexados`);
    if (!config.apiKeys.length) console.error("Aviso: JURIS_API_KEYS vazio, servidor sem autenticação.");
  });
}
