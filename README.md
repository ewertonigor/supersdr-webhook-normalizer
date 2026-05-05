# SuperSDR — Webhook Normalizer

> Sistema de recebimento e normalização de webhooks de múltiplos provedores de WhatsApp (Meta Cloud API, Evolution API, Z-API). Recebe formatos heterogêneos, normaliza para um schema único, persiste em Postgres, classifica intenção via OpenAI.
>
> **Prova técnica — Sistema de Normalização de Webhooks (SuperSDR).**

---

## Links rápidos

- 🔌 **Endpoint público (VPS):** `http://<ip-da-vps>/webhooks/<provider>` (após deploy — ver `deploy/HOSTINGER_SETUP.md`)
- 📦 **Repositório:** este
- 🎥 **Vídeo demo (≤ 10 min):** _adicionar link aqui após gravação_
- 📐 **Arquitetura detalhada:** [ARCHITECTURE.md](./ARCHITECTURE.md)
- 🧪 **Postman collection:** [postman-collection.json](./postman-collection.json)

---

## Visão geral

O serviço expõe **um único endpoint genérico** — `POST /webhooks/:provider` — capaz de receber webhooks com formatos completamente diferentes:

```
Meta:        { object, entry[0].changes[0].value.messages[0]... }
Evolution:   { event, data: { key, message: { conversation } }... }
Z-API:       { messageId, phone, type, text: { message } ... }
```

E persiste todos como o mesmo schema interno **`NormalizedMessage`**:

```ts
{ providerId, externalId, contact: { externalId, displayName?, phoneNumber? },
  direction: "inbound" | "outbound",
  messageType: "text" | "image" | "audio" | "video" | "document" | "location",
  content?, occurredAt, rawPayload }
```

Cada mensagem ganha uma **classificação de intenção** via OpenAI (`gpt-4o-mini` com structured output), com taxonomy fixa em pt-BR (`interesse_comercial`, `duvida_produto`, `suporte`, `agendamento`, `objecao_preco`, `saudacao`, `spam`, `outro`).

---

## Stack

| Camada | Tecnologia |
| --- | --- |
| Linguagem / runtime | TypeScript 5 + Node.js 20 (ESM) |
| HTTP framework | Fastify 5 |
| Validação | Zod 4 |
| ORM | Drizzle ORM (Postgres dialect) |
| Banco | PostgreSQL 16 |
| LLM | OpenAI `gpt-4o-mini` com structured output (`response_format: json_schema`) |
| Tests | Vitest |
| Deploy | Docker Compose + nginx + Hostinger VPS |

---

## Patterns

| Pattern | Por quê |
| --- | --- |
| **Adapter** | Cada provider tem seu adapter implementando `ProviderAdapter` — isola o formato externo do schema interno |
| **Registry self-registering** | Adapters se auto-registram no `import`; novo provider = 1 arquivo + 1 linha no `index.ts` |
| **Result<T, E>** | Erros previsíveis (`schema_invalid`, `unknown_event`) sem `try/catch` espalhado |
| **Acknowledge first, process async** | Endpoint persiste cru e responde 202 em <50ms; worker drena a fila e normaliza |
| **Idempotência via UNIQUE** | `messages(provider_id, external_id)` rejeita duplicatas no banco |
| **DLQ in-table** | `webhook_events.status='dead_letter'` após `WORKER_MAX_ATTEMPTS` falhas |
| **SELECT FOR UPDATE SKIP LOCKED** | Worker reivindica batches sem race condition (escalável horizontalmente sem código novo) |

Detalhes em [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Como rodar localmente

### Pré-requisitos

- Node.js 20+
- Docker + Docker Compose
- Uma chave OpenAI (`OPENAI_API_KEY`)

### Setup

```bash
# 1. Clone e instale deps
git clone <este-repo>
cd supersdr
npm install

# 2. Copie as variáveis de ambiente
cp .env.example .env
# Edite .env e coloque seu OPENAI_API_KEY

# 3. Suba o Postgres (e o app, em modo prod)
docker compose up -d postgres
# (ou suba tudo com docker compose up -d)

# 4. Aplique as migrations e seede providers
npm run db:migrate

# 5a. Modo dev (hot reload via tsx)
npm run dev

# 5b. OU modo container
docker compose up -d
docker compose logs -f app
```

A API fica em `http://localhost:3000`.

### Rodar os testes

```bash
npm test
# 22 testes em ~400ms — cobrem os 3 adapters + registry
```

### Smoke test via cURL

```bash
# Health
curl http://localhost:3000/health

# Meta
curl -X POST http://localhost:3000/webhooks/meta \
  -H 'Content-Type: application/json' \
  -d @samples/meta-message.json

# Evolution
curl -X POST http://localhost:3000/webhooks/evolution \
  -H 'Content-Type: application/json' \
  -d @samples/evolution-message.json

# Z-API
curl -X POST http://localhost:3000/webhooks/zapi \
  -H 'Content-Type: application/json' \
  -d @samples/zapi-message.json

# Métricas (contagem por status)
curl http://localhost:3000/webhooks/_metrics
```

Aguarde ~2 segundos (poll do worker) e confira:

```bash
docker compose exec postgres psql -U supersdr -d supersdr -c \
  "SELECT provider_id, content, intent, intent_confidence FROM messages ORDER BY received_at DESC LIMIT 10;"
```

A tabela `webhook_events` mantém o registro de tudo que entrou (cru), com `status` e `attempts`.

---

## Funcionalidades implementadas

### Obrigatórias (Parte 1 + 2)

- [x] Endpoint **único** `POST /webhooks/:provider` recebendo qualquer formato
- [x] **3 adapters implementados:** Meta Cloud API, Evolution API, Z-API
- [x] **Normalização** para `NormalizedMessage` com Zod validation por provider
- [x] **Pattern Adapter + Registry self-registering** — extensibilidade clara
- [x] **Tratamento de erros** estruturado:
  - Webhook malformado → `schema_invalid` → dead-letter com payload preservado
  - Provider desconhecido → 404 + nenhum side-effect
  - Falha no processamento → retry com backoff exponencial → DLQ
- [x] **Banco de dados** Postgres com 4 tabelas, FKs, UNIQUEs, índices
- [x] **Integração com LLM** — OpenAI gpt-4o-mini com structured output (Zod schema)

### Diferenciais (Seção 6 do edital)

- [x] **Fluxo visual** — diagrama Mermaid em `ARCHITECTURE.md`
- [x] **Testes unitários** — Vitest com 22 testes nos 3 adapters + registry
- [x] **Implementação completa de LLM** — não é mock, é OpenAI real classificando em 8 categorias pt-BR
- [x] **Teste com provider real** — guia Z-API trial em `deploy/HOSTINGER_SETUP.md`

---

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/health` | Lista providers registrados + timestamp |
| `GET` | `/webhooks/_metrics` | Contagem de eventos por status |
| `POST` | `/webhooks/:provider` | Recebe webhook, persiste raw, retorna 202 |

Códigos de resposta:

- `202 Accepted` — payload aceito, processamento em background
- `400` — body não é JSON object
- `404` — provider desconhecido (não registrado)

---

## Adicionando um novo provider em 3 passos

1. Crie `src/providers/twilio.ts` implementando `ProviderAdapter` (use `src/providers/zapi.ts` como template)
2. Adicione `import "./twilio.js";` em `src/providers/index.ts`
3. Adicione `INSERT INTO providers ('twilio', 'Twilio') ON CONFLICT DO NOTHING` no `src/db/migrate.ts`

Pronto. **Nenhum outro arquivo muda.** Endpoint `POST /webhooks/twilio` passa a funcionar e o adapter participa automaticamente da resolução por payload.

Detalhes completos em [ARCHITECTURE.md → Como adicionar um provider novo](./ARCHITECTURE.md#como-adicionar-um-provider-novo).

---

## Variáveis de ambiente

Veja `.env.example` para a lista canônica. Resumo:

| Var | Obrigatória | Default |
| --- | --- | --- |
| `DATABASE_URL` | sim | `postgresql://supersdr:supersdr@localhost:5432/supersdr` (em compose) |
| `OPENAI_API_KEY` | **sim** | — (servidor crasha no boot se ausente) |
| `OPENAI_MODEL` | não | `gpt-4o-mini` |
| `PORT` | não | `3000` |
| `NODE_ENV` | não | `development` |
| `LOG_LEVEL` | não | `info` |
| `WORKER_POLL_INTERVAL_MS` | não | `2000` |
| `WORKER_BATCH_SIZE` | não | `10` |
| `WORKER_MAX_ATTEMPTS` | não | `3` |

---

## Deploy em produção (Hostinger VPS)

Passo a passo completo em [`deploy/HOSTINGER_SETUP.md`](./deploy/HOSTINGER_SETUP.md). Resumo:

1. Conectar repo GitHub na integração Docker da Hostinger
2. Definir env vars no painel (incluindo `OPENAI_API_KEY`)
3. Hostinger faz `docker compose up -d --build` em cada push em `main`
4. Aplicar nginx reverse proxy com `deploy/nginx.conf`
5. Rodar migrations uma vez (`docker compose run --rm app node dist/db/migrate.js`)

URL pública: `http://<ip-da-vps>/webhooks/<provider>`

### Z-API trial (validação ponta-a-ponta)

1. Crie conta gratuita em <https://z-api.io>
2. Pareie uma instância via QR code
3. Em **Webhook → Recebimentos**, aponte para `http://<ip-da-vps>/webhooks/zapi`
4. Envie uma mensagem de WhatsApp para o número
5. Em ~2 segundos a mensagem aparece em `messages` com `intent` classificado

---

## Decisões técnicas

### Por que Fastify e não Express?

Fastify tem schema validation nativo via Ajv, raw body sem hacks, performance ~2x maior em throughput, e é TypeScript-first. Para um serviço de webhooks (pico burst quando provider retenta) a margem de performance importa.

### Por que Drizzle e não Prisma?

Drizzle gera SQL diretamente, bundle de ~7kb, type-safety sem `prisma generate` step, melhor cold-start em containers, e fica perto do SQL — alinha com perfil senior. Prisma seria fine; a escolha é estilística.

### Por que JSONB em `raw_payload`?

Audit, replay e compatibilidade com schemas futuros do mesmo provider. Custo: ~3x menor que normalizar tudo upfront. Indexação não é necessária aqui (raw é só leitura sob demanda).

### Por que worker in-process e não BullMQ + Redis?

Pragmatismo. O escopo da prova não justifica adicionar Redis. A fila in-table com `FOR UPDATE SKIP LOCKED` é escalável horizontalmente (múltiplos containers do app rodam o worker em paralelo, cada um pegando seu batch) e suporta DLQ via flag de status. Em volume alto (>1k webhooks/min) a migração para BullMQ é trivial — só substitui o `WebhookProcessor` mantendo as repositories.

### Por que structured output da OpenAI ao invés de prompt + parse?

Zero parsing de string. O `response_format: json_schema` força o modelo a retornar JSON válido contra o schema declarado. O mesmo Zod valida runtime + types em compile-time. Reduz drasticamente surface de erro.

### Por que Result<T, E> e não exceções?

Erros de adapter (`schema_invalid`, `unknown_event`) são **expected** — não são bugs, são parte do fluxo. Exceções para casos esperados poluem stack traces e forçam `try/catch` em todo call site. Result é discriminated union — TypeScript força lidar com os dois casos.

---

## Estrutura do repositório

```
.
├── README.md
├── ARCHITECTURE.md                     # diagrama + decisões detalhadas
├── postman-collection.json             # coleção de teste
├── docker-compose.yml                  # postgres + app
├── Dockerfile                          # multi-stage, ~50MB
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── .gitignore
├── samples/                            # 3 payloads de exemplo
├── deploy/                             # nginx.conf + HOSTINGER_SETUP.md
└── src/
    ├── server.ts                       # Fastify + processor lifecycle
    ├── config.ts                       # env validado com Zod
    ├── webhooks/
    │   ├── routes.ts                   # POST /webhooks/:provider
    │   ├── handler.ts                  # ack first
    │   └── processor.ts                # async normalize + LLM
    ├── providers/
    │   ├── types.ts                    # ProviderAdapter, NormalizedMessage
    │   ├── registry.ts                 # Map<id, Adapter>
    │   ├── meta.ts                     # adapter Meta + Zod schema
    │   ├── evolution.ts                # adapter Evolution + Zod schema
    │   ├── zapi.ts                     # adapter Z-API + Zod schema
    │   └── index.ts                    # side-effect imports
    ├── db/
    │   ├── client.ts                   # pool + Drizzle
    │   ├── schema.ts                   # tabelas
    │   ├── migrate.ts                  # roda migrations + seed providers
    │   └── migrations/                 # SQL gerado por drizzle-kit
    ├── repositories/
    │   ├── webhook-events.ts           # claim, mark normalized/failed
    │   ├── messages.ts                 # insert idempotent + setIntent
    │   └── contacts.ts                 # upsert por (provider, external_id)
    ├── llm/
    │   ├── intent-classifier.ts        # OpenAI structured output
    │   └── prompts.ts                  # template + taxonomy
    ├── lib/
    │   ├── result.ts                   # Result<T, E>
    │   ├── retry.ts                    # backoff exponencial com jitter
    │   └── logger.ts                   # re-export do pino do Fastify
    └── tests/
        ├── _setup.ts                   # env de teste
        ├── adapters.meta.test.ts
        ├── adapters.evolution.test.ts
        ├── adapters.zapi.test.ts
        └── registry.test.ts
```

---

## Sobre o uso de IA

Este projeto foi desenvolvido com auxílio de **Claude (Anthropic)** atuando como par-programador:

- A arquitetura (Adapter + Registry, ack-first, idempotency via UNIQUE) foi validada com pesquisa e referências (Stripe, Shopify, Refactoring Guru) antes de codar
- Zod schemas dos 3 providers foram derivados dos exemplos do edital + docs públicas
- O prompt de intent classification e a taxonomy foram desenhados manualmente para o contexto de SDR brasileiro
- Cada commit foi revisado e ajustado — fuso horário UTC nos timestamps dos testes, por exemplo, foi corrigido manualmente após primeira rodada de `vitest`

A IA acelerou tipagem, geração de boilerplate (migrations, samples), e a redação dos READMEs. As **decisões de arquitetura** e o **mapeamento entre providers e o schema canônico** vieram do raciocínio do desenvolvedor.

---

## Limitações conhecidas (escolhas de escopo)

- **Sem signature verification** — cada provider tem seu mecanismo (HMAC SHA256 no Meta, secret no body no Z-API). Implementação por adapter, não muda a arquitetura.
- **Sem multi-tenancy** — single-tenant deliberadamente; a primeira prova (CRM SDR) é multi-tenant
- **Sem rate limiting** — a fila in-table absorve picos; em produção alta-vazão, adicionaria token bucket no nginx
- **Sem unificação de identidade** — uma pessoa em Meta vs Z-API são dois `contacts` separados (problema de CRM, não de webhook normalization)
- **Worker in-process** — escala horizontalmente (basta `docker compose scale app=N`), mas para >1k req/min eu migraria para BullMQ + Redis

---

## Autor

**Ewerton Igor**
GitHub: [@ewertonigor](https://github.com/ewertonigor)
