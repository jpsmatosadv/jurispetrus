# JurisPetrus

Servidor MCP (Model Context Protocol) que conecta o Claude à jurisprudência e à legislação brasileiras, com fonte oficial verificável em cada resultado. A ideia é a mesma do Jusratio: a IA pesquisa decisões reais em vez de "lembrar" precedentes, e qualquer citação pode ser conferida antes de entrar numa peça.

## O que o Claude ganha

| Ferramenta | O que faz |
|---|---|
| `pesquisar_jurisprudencia` | Busca no acervo indexado e, quando há filtro de tribunal, também nos portais oficiais em tempo real. Ordena por relevância (palavras + significado), autoridade (A–E) e atualidade |
| `obter_documento` | Ementa, tese, decisão e referências completas, com paginação |
| `verificar_citacao` | Confere "REsp 1.990.285/SP", "Súmula Vinculante 13", "Súmula 331 do TST", "Tema 1046 da Repercussão Geral", "ADI 5.766", "IRDR 62/TJSP" ou um número CNJ (CONFIRMADO / DIVERGENCIA / NAO_ENCONTRADO) |
| `analisar_caso` | A partir da narrativa dos fatos, indica para cada questão jurídica os dispositivos legais vigentes, os precedentes qualificados e a jurisprudência pertinente |
| `extrair_razao_decidir` | Ratio decidendi de um julgado: questão, regra decisiva, fundamentos determinantes, obiter dicta, fatos materiais, dispositivos e precedentes citados |
| `buscar_legislacao` | Texto consolidado vigente, artigo por artigo: por citação ("art. 14 do CDC", "art. 3º da Lei 13.146/2015") ou por assunto |
| `historico_legislativo` | Tramitação da norma no Congresso: projeto de origem, justificação ou exposição de motivos, pareceres das comissões e razões de veto, com trechos e links (Senado e Câmara). Para um dispositivo, procura a lei que o incluiu ou alterou |
| `consultar_processo` | Metadados e movimentações pelo número CNJ (DataJud/CNJ, ao vivo, com cache de 6 h) |
| `listar_fontes` | O que está indexado e quais tribunais respondem ao vivo |

`verificar_citacao` também diz se um dispositivo legal está VIGENTE ou REVOGADO.

Há dois prompts prontos: `analise_de_caso` (dos fatos ao parecer, com legislação e precedentes) e `pesquisa_fundamentada` (pesquisa de uma tese, priorizando precedentes qualificados).

## Legislação atualizada

O índice guarda o texto vigente de cada artigo, com o caminho (Livro > Título > Capítulo > Seção), as notas de redação ("redação dada pela Lei nº ...") e a marcação de revogados. Já vêm a Constituição, o ADCT, CC, CPC, CDC, CLT, CTN, CP, CPP, LINDB, ECA e mais 20 leis de uso frequente (cerca de 9 mil artigos). Qualquer outra lei federal citada numa consulta ("art. 3º da Lei 13.146/2015", "LC 123/2006, art. 3º") é importada na hora.

Fontes, em ordem: a "norma atualizada" da Câmara dos Deputados (HTML ou, quando o HTML falha, .docx), o normas.leg.br do Senado (texto estruturado por dispositivo) e o catálogo de legislação do Senado (para identificar normas e URNs). Para atualizar: `npm run ingest -- --fonte legislacao` (uma vez por mês) ou `npm run ingest -- --lei "Lei 14.181/2021"`.

Alterações com vacatio legis aparecem já incorporadas ao texto, com a nota "em vigor ... após a publicação"; o Claude é orientado a observar essa nota.

## Histórico legislativo

Para a interpretação histórica e teleológica, `historico_legislativo` reconstrói a tramitação de leis, leis complementares e emendas constitucionais pelas APIs de dados abertos do Senado (processos pela norma gerada, com documentos) e da Câmara (proposição originária, inteiro teor e pareceres de comissão). Os PDFs são lidos no próprio servidor e a resposta traz os trechos de justificação, análise dos pareceres e razões do veto. Quando a consulta cita um artigo ("art. 477-A da CLT"), a ferramenta usa a nota de redação do índice para achar a lei que o incluiu (Lei 13.467/2017) e destaca as passagens que o discutem. Documentos digitalizados (comuns antes de 2015) não têm texto extraível, e decretos-leis e o texto originário da Constituição não têm tramitação nessas bases. Resultados ficam em cache por 30 dias.

## Razão de decidir e análise de caso

- Nos precedentes qualificados (súmulas, temas, IRDR), a tese firmada é a ratio.
- Nas ementas no padrão da Recomendação CNJ 154/2024, as seções (caso, questão, razões de decidir, dispositivo e tese, dispositivos e jurisprudência citados) são separadas automaticamente.
- Quando o portal de origem oferece o inteiro teor em HTML (eproc, TJBA, TST), ele é baixado para a análise.
- Com `ANTHROPIC_API_KEY` configurada, o servidor usa Claude (padrão `claude-opus-5-5`, saída estruturada) para extrair a ratio e para decompor a narrativa dos fatos em questões jurídicas. As análises ficam guardadas no banco e não são refeitas. As chamadas usam a opção de reserva da API (`fallbacks: "default"`): se o classificador de segurança recusar um texto, a API repete o pedido em um modelo alternativo.
- Sem a chave, as ferramentas devolvem o material organizado e o próprio Claude da conversa faz a análise.

## Cobertura

### Acervo indexado (rápido, sempre consultado)

| Fonte | Conteúdo |
|---|---|
| Banco Nacional de Precedentes (CNJ) | Súmulas vinculantes, súmulas, repercussão geral, ADI/ADC/ADO/ADPF, IRDR, IAC, IRR, PUIL de STF, STJ, TST, TNU, 6 TRFs, 27 TJs e 24 TRTs (cerca de 15 mil) |
| STF | Planilha oficial dos temas de repercussão geral, com relator, leading case, datas e tese |
| STJ (Dados Abertos) | Espelhos de acórdãos de todos os órgãos julgadores e temas repetitivos, IAC e SIRDR |
| TST | Súmulas, orientações jurisprudenciais (SDI-1, SDI-2, SDC) e precedentes normativos |

### Pesquisa ao vivo nos portais oficiais (quando o tribunal é pedido)

| Tribunal/órgão | Portal |
|---|---|
| TJSP, TJSC, TJRJ, TRF4, TRF2 | Jurisprudência do eproc (no TJSP e no TJRJ, só processos que tramitam no eproc) |
| TJDFT | API de jurisprudência |
| TJPR | Pesquisa pública |
| TJBA | API GraphQL de jurisprudência |
| TJES | API de jurisprudência (bloqueia alguns clientes automatizados) |
| TJAL, TJAC | e-SAJ |
| TRF5 | Júlia |
| TST | Acórdãos, súmulas, OJs e PNs |
| CARF | Acórdãos (índice público) |
| TCU | Jurisprudência selecionada, súmulas e acórdãos |

O Claude pode usar atalhos em `tribunais`: `ESTADUAIS` (todos os TJs), `FEDERAIS` (TRFs), `TRABALHISTAS`, `SUPERIORES` e `TODOS`. Cada portal tem tempo-limite próprio (`JURIS_TIMEOUT_FONTES`, padrão 25 s); se algum falhar, a resposta diz qual e o Claude avisa que a pesquisa nele ficou incompleta. Todo resultado ao vivo é gravado no acervo, então a citação pode ser verificada depois.

Ficam de fora os portais que exigem captcha ou desafio anti-robô (e-SAJ do TJSP e do TJCE, TJMG, TJGO, TRF6) e os que não responderam a partir do ambiente de testes (TJRS, TJMS, TJAM, TJPE, TRF1, TRF3). Para esses tribunais, o acervo traz os precedentes qualificados vindos do BNP. Os portais inacessíveis daqui podem funcionar a partir de um servidor no Brasil.

### Níveis de autoridade

| Nível | Significado | Exemplos |
|---|---|---|
| A | Vinculante forte | Súmula Vinculante, ADI/ADC/ADPF, súmulas STF/STJ/TST |
| B | Precedente qualificado | Tema repetitivo, repercussão geral, IRDR, IAC, IRR, súmula da TNU |
| C | Observância qualificada | Pleno, Órgão/Corte Especial, Seções, CSRF do CARF, OJs do TST, súmulas de TJs/TRFs/TCU |
| D | Orientativo | Acórdãos de turmas e câmaras, jurisprudência selecionada do TCU |
| E | Consulta | Temas sem tese firmada, decisões monocráticas, acórdãos do TCU |

### Busca semântica

Além das palavras (BM25), a pesquisa pode comparar o significado da pergunta com o dos julgados: "negativação indevida" encontra "apontamento no SPC sem notificação". Para ativar, escolha um provedor de embeddings e vetorize o acervo:

```bash
# Voyage AI
export JURIS_EMBEDDINGS=voyage VOYAGE_API_KEY=... JURIS_EMBEDDINGS_MODEL=voyage-3.5 JURIS_EMBEDDINGS_DIM=1024
# ou qualquer endpoint compatível com a OpenAI (OpenAI, Ollama, LM Studio, TEI)
export JURIS_EMBEDDINGS=openai JURIS_EMBEDDINGS_URL=http://localhost:11434/v1 JURIS_EMBEDDINGS_MODEL=nomic-embed-text JURIS_EMBEDDINGS_DIM=768

npm run vetorizar               # vetoriza o que falta (incremental)
npm run vetorizar -- --recriar  # ao trocar de modelo
```

Os vetores ficam no próprio SQLite (extensão sqlite-vec). Sem provedor configurado, a busca continua funcionando só por palavras. A pontuação final é 60% relevância (45% palavras + 55% significado), 28% autoridade e 12% atualidade.

## Instalação

Requer Node.js 22.13 ou superior (usa o SQLite embutido do Node, sem dependência nativa).

```bash
npm install
npm run build
```

### Montar o acervo

```bash
npm run ingest                    # todas as fontes: stj, bnp, tst, stf e legislacao
npm run ingest -- --fonte bnp     # só o Banco Nacional de Precedentes (~15 min)
npm run ingest -- --fonte stj --meses 3 --orgao terceira-turma
npm run ingest -- --fonte bnp --tribunal TJSP --tribunal TRF4
npm run ingest -- --ajuda
```

O portal do STF costuma recusar downloads automatizados. Se isso acontecer, baixe a planilha de repercussão geral no navegador (o link aparece na mensagem de erro) e rode `npm run ingest -- --fonte stf --rg-arquivo caminho/da/planilha.xls`. O BNP já traz as teses de RG, então esse passo só acrescenta relator, leading case e datas.

A ingestão é incremental. Agende `npm run ingest && npm run vetorizar` uma vez por mês (cron, GitHub Actions ou o agendador da hospedagem).

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

### Claude Desktop no Mac, sem hospedagem (pacote .mcpb)

O jeito mais simples: tudo roda no seu computador, sem servidor nem URL pública.

1. Abra o arquivo `jurispetrus-mac.mcpb` com o Claude Desktop (duplo clique, ou arraste para Configurações → Extensões).
2. Na tela de instalação, as chaves são opcionais: a do Claude ativa a análise automática no servidor; a da Voyage ativa a busca semântica.
3. Pronto. Na primeira execução, a base inicial (STF, STJ, TST, precedentes do CNJ e legislação) é copiada para `~/Library/Application Support/JurisPetrus`.

Para atualizar a base, peça ao Claude: "atualize o acervo do JurisPetrus". A ferramenta `atualizar_acervo` roda em segundo plano (legislação, STJ, TST e BNP; com chave da Voyage, também a vetorização), e o andamento aparece em `listar_fontes`.

Requer Node.js 22.13 ou superior. O Claude Desktop traz Node embutido; se a extensão avisar que a versão é antiga, instale o Node 22 (nodejs.org) e desative "Usar Node.js embutido" nas configurações de extensões. O pacote não é assinado, então o Claude Desktop pode pedir confirmação na instalação.

Para gerar o pacote a partir do código: `npm run ingest` (monta a base) e `npm run empacotar:mac` (gera `pacotes/jurispetrus-mac.mcpb`, com binários para Apple Silicon e Intel).

### Claude Desktop (local, configuração manual)

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
docker run --rm -v jurispetrus-data:/data jurispetrus sh -c "node dist/ingest/cli.js && node dist/ingest/vetorizar-cli.js"
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
| `DATAJUD_API_KEY` | chave pública do CNJ | Chave própria do DataJud, se tiver (se a pública for recusada, a vigente é lida na wiki do CNJ) |
| `JURIS_EMBEDDINGS` | `nenhum` | `voyage` ou `openai` para ativar a busca semântica |
| `JURIS_EMBEDDINGS_MODEL` / `_DIM` / `_URL` | por provedor | Modelo, dimensão e endpoint dos embeddings |
| `VOYAGE_API_KEY` / `JURIS_EMBEDDINGS_KEY` | vazio | Chave do provedor de embeddings |
| `JURIS_TIMEOUT_FONTES` | `25000` | Tempo-limite (ms) de cada portal consultado ao vivo |
| `ANTHROPIC_API_KEY` | vazio | Ativa a análise com Claude no servidor (ratio e decomposição dos fatos) |
| `JURIS_IA_MODELO` | `claude-opus-5-5` | Modelo usado nessas análises |
| `JURIS_IA` | ligada | `desligada` desativa a análise no servidor mesmo com a chave |

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
  mcpb.ts            ponto de entrada do pacote .mcpb (pasta de dados e base inicial)
  atualizacao.ts     atualização da base em segundo plano (ferramenta atualizar_acervo)
  db.ts              esquema SQLite + índice FTS5
  search.ts          ranqueamento (BM25 + autoridade + atualidade)
  citation.ts        interpretação e verificação de citações
  embeddings.ts      provedores de embeddings (Voyage, compatível com OpenAI)
  vetorizar.ts       vetorização incremental do acervo
  federado.ts        pesquisa paralela nas fontes ao vivo, com tempo-limite
  fontes/            conectores ao vivo (eproc, e-SAJ, TJDFT, TJPR, TJBA, TJES, TRF5, TST, CARF, TCU)
  sources/datajud.ts consulta processual no DataJud/CNJ
  legislacao/        catálogo de normas, índice de dispositivos, leitores (Câmara, normas.leg.br, .docx), importação
  ratio.ts           estrutura da ementa (padrão CNJ) e download do inteiro teor
  historico.ts       histórico legislativo (APIs do Senado e da Câmara, leitura de PDF)
  ia.ts              análise com Claude no servidor (opcional)
  ingest/            ingestão: STJ, BNP/CNJ, STF (repercussão geral) e TST
```

## Limitações atuais e próximos passos

- A pesquisa ao vivo depende da disponibilidade de cada portal. Nos testes, TJRJ e TJAC oscilaram, e o TJES recusou o cliente.
- Os portais que exigem captcha ou desafio anti-robô não são contornados. Para cobri-los, só com convênio ou API oficial.
- No TJSP e no TJRJ, a pesquisa alcança só os processos do eproc; o acervo antigo do e-SAJ e do ejuris fica de fora.
- A busca semântica precisa de um provedor de embeddings (pago ou local). Neste ambiente não foi possível baixar um modelo local.
- O acervo STJ traz o espelho do acórdão (ementa, decisão e referências), não o voto.
- A cota é contada em memória e zera quando o processo reinicia. Para cobrança real, mova o contador para o banco e use OAuth para identificar usuários.
- O DataJud não devolve peças nem inteiro teor e omite processos sigilosos.
- O DataJud é lento (20 a 60 s por consulta). O prazo é de 90 s, o cliente recebe avisos de progresso a cada 10 s
  e cada processo consultado fica guardado no acervo por 6 horas; se o cliente desistir antes, a consulta termina
  em segundo plano e a próxima chamada sai do cache. Se o CNJ trocar a chave pública, a nova é lida em
  https://datajud-wiki.cnj.jus.br/api-publica/acesso/ e guardada no acervo.
- A legislação cobre normas federais. Leis estaduais e municipais e atos infralegais (resoluções, instruções normativas) ainda não estão no índice.
- Sem `ANTHROPIC_API_KEY`, a razão de decidir de ementas fora do padrão CNJ fica a cargo do Claude na conversa. A extração no servidor não foi testada contra a API real neste ambiente (sem chave); os testes usam um analista simulado.

As pesquisas apoiam o trabalho do advogado e não o substituem: a pertinência de cada precedente ao caso concreto continua sendo juízo profissional.
