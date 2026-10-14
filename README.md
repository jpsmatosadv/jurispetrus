# JurisPetrus

Servidor MCP (Model Context Protocol) que conecta o Claude à jurisprudência e à legislação brasileiras, com fonte oficial verificável em cada resultado. A ideia é a mesma do Jusratio: a IA pesquisa decisões reais em vez de "lembrar" precedentes, e qualquer citação pode ser conferida antes de entrar numa peça.

## O que o Claude ganha

| Ferramenta | O que faz | Fonte |
|---|---|---|
| `pesquisar_jurisprudencia` | Busca acórdãos e precedentes qualificados, ordenados por relevância, autoridade (A–E) e atualidade | Acervo local (STJ Dados Abertos) |
| `obter_documento` | Ementa, tese, decisão e referências legislativas completas, com paginação | Acervo local |
| `verificar_citacao` | Confere se "REsp 1.990.285/SP", "Tema 988/STJ" ou um número CNJ existem (CONFIRMADO / DIVERGENCIA / NAO_ENCONTRADO) | Acervo local + DataJud |
| `consultar_processo` | Metadados e movimentações pelo número CNJ, em qualquer tribunal integrado ao DataJud | API Pública DataJud/CNJ (ao vivo) |
| `buscar_legislacao` | Leis, decretos e normas federais, estaduais e municipais | LexML Brasil (ao vivo) |
| `listar_fontes` | Cobertura do acervo: tribunais, tipos e períodos indexados | Acervo local |

Há também o prompt `pesquisa_fundamentada`, um roteiro que leva o Claude a pesquisar precedentes qualificados primeiro, ler os mais pertinentes, verificar citações e responder em forma de parecer.

### Níveis de autoridade

| Nível | Significado | Exemplos |
|---|---|---|
| A | Vinculante forte | Súmula Vinculante, ADI/ADC/ADPF, súmulas STF/STJ/TST |
| B | Precedente qualificado | Tema repetitivo, repercussão geral, IRDR, IAC |
| C | Observância qualificada | Corte Especial, Plenário, Órgão Especial |
| D | Orientativo | Acórdãos de turmas e câmaras |
| E | Consulta | Temas afetados sem tese firmada, material de apoio |

A pontuação final combina BM25 (60%), autoridade (28%) e atualidade (12%). Temas cancelados ou revisados ficam fora dos resultados, salvo com `incluir_cancelados`.

## Instalação

Requer Node.js 22.13 ou superior (usa o SQLite embutido do Node, sem dependência nativa).

```bash
npm install
npm run build
```

### Montar o acervo

O comando abaixo baixa os temas repetitivos/IAC/IRDR do STJ e os espelhos de acórdãos dos últimos 12 meses de cada órgão julgador:

```bash
npm run ingest
```

Opções úteis:

```bash
npm run ingest -- --meses 3                         # só os 3 últimos meses
npm run ingest -- --orgao terceira-turma --orgao segunda-secao
npm run ingest -- --so-temas                        # só precedentes qualificados (rápido)
npm run ingest -- --forcar                          # reimporta arquivos já importados
```

A ingestão é incremental: cada arquivo mensal fica registrado e não é baixado de novo. Agende `npm run ingest` uma vez por mês (cron, GitHub Actions ou o agendador da sua hospedagem) para manter o acervo atualizado.

## Conectar ao Claude

### Claude.ai (web, desktop e celular) — conector personalizado

1. Publique o servidor HTTP com HTTPS (veja "Implantação").
2. No Claude, abra **Configurações → Conectores → Adicionar conector personalizado**.
3. Informe a URL `https://seu-dominio/mcp?key=SUA_CHAVE`.
4. Numa conversa, ative o conector no menu de ferramentas e pergunte, por exemplo: "Qual o entendimento do STJ sobre reajuste de plano de saúde por faixa etária?"

### Claude Code

```bash
claude mcp add --transport http jurispetrus https://seu-dominio/mcp --header "Authorization: Bearer SUA_CHAVE"
```

### Claude Desktop (local, sem servidor)

Em `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jurispetrus": {
      "command": "node",
      "args": ["/caminho/para/jurispetrus/dist/stdio.js"],
      "env": { "JURIS_DB_PATH": "/caminho/para/jurispetrus/data/acervo.db", "NODE_NO_WARNINGS": "1" }
    }
  }
}
```

## Implantação

```bash
docker build -t jurispetrus .
docker run -d -p 3000:3000 -v jurispetrus-data:/data \
  -e JURIS_API_KEYS=chave1,chave2 -e JURIS_ALLOWED_HOSTS=juris.seudominio.com.br \
  jurispetrus
docker run --rm -v jurispetrus-data:/data jurispetrus node dist/ingest/cli.js
```

Coloque um proxy com HTTPS na frente (Caddy, Nginx, Cloudflare) ou use uma plataforma que já entregue HTTPS (Fly.io, Railway, Render). O servidor roda em modo stateless, então pode ter várias réplicas lendo o mesmo arquivo SQLite.

Variáveis de ambiente (veja `.env.example`):

| Variável | Padrão | Uso |
|---|---|---|
| `JURIS_DB_PATH` | `data/acervo.db` | Arquivo do acervo |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Endereço do servidor HTTP |
| `JURIS_API_KEYS` | vazio | Chaves aceitas (`Authorization: Bearer` ou `?key=`). Vazio deixa o servidor aberto |
| `JURIS_ALLOWED_HOSTS` | vazio | Proteção contra DNS rebinding |
| `JURIS_COTA_MENSAL` | `0` | Limite de chamadas por chave por mês (0 = ilimitado) |
| `DATAJUD_API_KEY` | chave pública do CNJ | Chave própria do DataJud, se tiver |

## Desenvolvimento

```bash
npm run dev        # servidor HTTP com recarga automática
npm test           # testes unitários (offline)
npm run typecheck
```

Estrutura:

```
src/
  server.ts          ferramentas MCP e instruções ao modelo
  http.ts            transporte Streamable HTTP, autenticação e cota
  stdio.ts           transporte stdio (Claude Desktop local)
  db.ts              esquema SQLite + índice FTS5
  search.ts          ranqueamento (BM25 + autoridade + atualidade)
  citation.ts        interpretação e verificação de citações
  sources/datajud.ts consulta processual no DataJud/CNJ
  sources/lexml.ts   busca de legislação no LexML
  ingest/stj.ts      ingestão do Portal de Dados Abertos do STJ
```

## Limitações atuais e próximos passos

- O acervo cobre só o STJ (acórdãos via espelhos e precedentes qualificados). STF, TST, TNU e tribunais estaduais e federais ainda não têm fonte aberta integrada. Os próximos candidatos são as súmulas e os temas de repercussão geral do STF e os temas do TST.
- Os espelhos trazem ementa, decisão e referências, não o inteiro teor do voto. O STJ publica as íntegras no conjunto "integras-de-decisoes-terminativas-e-acordaos-do-diario-da-justica", que pode ser integrado depois.
- A busca é lexical (BM25 com radicais). Para ganhar busca semântica, dá para acrescentar embeddings (ex.: sqlite-vec) e combinar as duas pontuações.
- O portal LexML às vezes exige verificação anti-robô. Nesse caso a ferramenta responde `INDISPONIVEL` e orienta a conferir no Planalto, sem inventar dispositivos.
- A cota é contada em memória e zera quando o processo reinicia. Para cobrança real, mova o contador para o banco e use OAuth para identificar usuários.
- O DataJud não devolve peças nem inteiro teor e omite processos sigilosos.

As pesquisas apoiam o trabalho do advogado e não o substituem: a pertinência de cada precedente ao caso concreto continua sendo juízo profissional.
