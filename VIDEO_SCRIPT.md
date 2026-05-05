# 🎬 Roteiro do Vídeo — SuperSDR Webhook Normalizer

**Duração alvo:** 8–10 minutos
**Formato:** screencast (compartilhamento de tela) + voz
**Upload:** YouTube **Não Listado** (preferível) ou Google Drive

---

## 🛠️ Antes de gravar — checklist (5 min)

- [ ] App rodando localmente em `http://localhost:3000` (`docker compose up -d` ou `npm run dev`)
- [ ] Postgres saudável e migrations aplicadas (`npm run db:migrate`)
- [ ] `.env` com `OPENAI_API_KEY` válido
- [ ] Postman aberto com a coleção (`postman-collection.json`)
- [ ] Editor (VS Code) aberto com o repo
- [ ] Notificações do sistema desligadas
- [ ] Aba do GitHub do repo aberta
- [ ] **Janela com `psql` ou TablePlus conectado** ao Postgres pra mostrar dados em tempo real
- [ ] Microfone testado, volume ok
- [ ] Browser zoom em 100–110%

---

## 🎯 Estrutura

| Bloco | Tempo | Conteúdo |
| --- | --- | --- |
| 1. Intro | 0:00–0:30 | Quem você é + o que construiu |
| 2. O problema | 0:30–1:30 | 3 payloads diferentes pra mesma "mensagem recebida" |
| 3. Arquitetura em 1 minuto | 1:30–2:30 | Diagrama + patterns escolhidos |
| 4. Demo do código (rápida) | 2:30–4:00 | Adapter, Registry, NormalizedMessage |
| 5. Demo ao vivo no Postman | 4:00–6:30 | 3 webhooks → mostrar no banco |
| 6. ⚡ LLM em ação | 6:30–7:30 | Mensagens com `intent` populado pelo OpenAI |
| 7. Resiliência + extensibilidade | 7:30–9:00 | Idempotência, DLQ, "como adicionar Twilio em 3 passos" |
| 8. Fechamento | 9:00–10:00 | Trade-offs + o que faria com mais tempo |

---

# 📝 ROTEIRO COMPLETO COM FALAS

## 🎬 BLOCO 1 — INTRO (0:00–0:30)

**[Tela: README aberto OU terminal limpo]**

> "Olá, sou Ewerton. Esse vídeo apresenta minha solução para a prova técnica de **Sistema de Normalização de Webhooks** do SuperSDR. Construí um serviço em Node.js + TypeScript que recebe webhooks de três provedores diferentes de WhatsApp — Meta Cloud API, Evolution API e Z-API — normaliza tudo para um schema único, persiste em Postgres com idempotência, e classifica intenção via OpenAI usando structured output. Vamos passar pelo problema, pelas decisões técnicas e por uma demo ao vivo. Em torno de 10 minutos."

---

## 🎬 BLOCO 2 — O PROBLEMA (0:30–1:30)

**[Tela: abre `samples/meta-message.json`, depois `evolution-message.json`, depois `zapi-message.json` lado a lado se possível]**

> "O problema é simples: cada provedor envia o **mesmo evento conceitual** — uma mensagem recebida — em um formato completamente diferente."

**[Aponta cada um]**

> "O Meta encapsula a mensagem em `entry[0].changes[0].value.messages[0]`. A Evolution coloca em `data.message.conversation`. O Z-API coloca em `text.message`. O timestamp do Meta vem em segundos, o do Z-API em milissegundos. O nome do contato fica em lugares diferentes. E assim por diante."

> "Sem normalização, todo consumer downstream — CRM, classificador IA, dashboards — teria que falar com três formatos. Solução: um adapter por provedor, um schema único de saída."

---

## 🎬 BLOCO 3 — ARQUITETURA EM 1 MINUTO (1:30–2:30)

**[Tela: ARCHITECTURE.md aberto, scroll até o diagrama Mermaid]**

> "A arquitetura segue três patterns clássicos:"

> "**Adapter + Registry self-registering** — cada provider é um arquivo independente que implementa uma interface comum, e se registra automaticamente no carregamento. Adicionar um provedor novo = um arquivo + uma linha no `index.ts`. Princípio Open/Closed cumprido."

> "**Acknowledge first, process async** — padrão Stripe e Shopify. O endpoint persiste o payload cru em uma tabela `webhook_events` e responde 202 em menos de 50 milissegundos. Um worker em background drena a fila, valida o schema, normaliza e classifica."

> "**Idempotência via UNIQUE constraint** em `(provider_id, external_id)` — webhook duplicado simplesmente falha o INSERT silenciosamente. Provedores retentam agressivamente; sem isso teríamos duplicatas."

**[Aponta as setas DLQ no diagrama]**

> "Resiliência: erros permanentes — schema inválido, evento desconhecido — viram dead-letter na primeira tentativa. Erros transientes — DB ou LLM indisponíveis — retentam até três vezes com backoff exponencial. Tudo cru fica preservado em `webhook_events.raw_payload` para replay."

---

## 🎬 BLOCO 4 — DEMO DO CÓDIGO (2:30–4:00)

**[Tela: VS Code, abre `src/providers/types.ts`]**

> "Aqui está o contrato. `NormalizedMessage` é o schema canônico — todo adapter produz isto. `ProviderAdapter` define `canHandle` e `normalize`. Note que `normalize` retorna `Result<T, E>` em vez de jogar exceção — erros esperados são parte do tipo."

**[Abre `src/providers/registry.ts`]**

> "O registry é um Map simples com um método extra: `detect`, que tenta cada adapter via `canHandle` quando o slug da URL é desconhecido. Defesa em profundidade."

**[Abre `src/providers/meta.ts`, scroll até o `MetaWebhook` Zod schema]**

> "O adapter do Meta valida o payload com Zod, cobre text + media (image, audio, video, document) + location, e mapeia tudo para `NormalizedMessage`. Note a última linha do arquivo:"

**[Aponta para `registry.register(new MetaAdapter())`]**

> "Self-registration. Importou esse arquivo, está registrado. O `index.ts` apenas faz três imports e tudo funciona."

**[Abre `src/providers/index.ts`]**

> "Três linhas. Para adicionar Twilio amanhã: crio `twilio.ts` com a mesma estrutura, adiciono `import './twilio.js'` aqui. Pronto."

---

## 🎬 BLOCO 5 — DEMO AO VIVO NO POSTMAN (4:00–6:30)

**[Tela: Postman aberto + janela com psql ao lado]**

> "Vamos ver isso rodando. Tenho o app rodando em localhost 3000."

**[Click em "Health" no Postman → Send]**

> "Health endpoint mostra os três providers registrados."

**[Click em "POST Meta webhook" → Send]**

> "Mando um webhook do formato Meta. Resposta `202 Accepted` com event_id — endpoint reconheceu, persistiu cru, vai processar."

**[Click em "POST Evolution webhook" → Send]**

> "Mando do formato Evolution. Mesmo retorno."

**[Click em "POST Z-API webhook" → Send]**

> "E do Z-API."

**[Vai para a janela do psql e roda]**

```sql
SELECT provider_id, content, intent, intent_confidence FROM messages ORDER BY received_at DESC LIMIT 5;
```

> "Olha — três mensagens, três providers, **mesmo schema**. Conteúdo extraído corretamente: a do Meta sobre o plano Pro, a da Evolution sobre agendar demo, a do Z-API sobre suporte. E todas já vieram com intent classificado em pt-BR."

**[Roda]**

```sql
SELECT status, COUNT(*) FROM webhook_events GROUP BY status;
```

> "Webhook events: três normalized, tudo OK."

---

## 🎬 BLOCO 6 — ⚡ LLM EM AÇÃO (6:30–7:30)

**[Tela: VS Code, abre `src/llm/intent-classifier.ts`]**

> "A classificação usa **structured output** da OpenAI — não é prompt + parse de string. O modelo é forçado a retornar JSON contra um schema declarado."

**[Aponta o `response_format: { type: "json_schema", ... }`]**

> "Categorias: interesse_comercial, dúvida de produto, suporte, agendamento, objeção de preço, saudação, spam, outro. Tudo em pt-BR — taxonomy fechada e versionada em `prompts.ts`."

**[Volta no psql]**

```sql
SELECT content, intent, intent_confidence FROM messages ORDER BY received_at DESC LIMIT 3;
```

> "Olha o resultado: a mensagem 'queria saber o preço' virou `interesse_comercial` com 0.95 de confidence. A 'queria agendar uma demo' virou `agendamento`. A do cliente com problema virou `suporte`. Sem regex, sem parsing — confiável e tipado."

---

## 🎬 BLOCO 7 — RESILIÊNCIA + EXTENSIBILIDADE (7:30–9:00)

**[Tela: Postman]**

> "Vou testar dois cenários de erro."

**[Click em "POST Unknown provider (404)" → Send]**

> "Provider desconhecido — retorna 404, nada é persistido, audit limpo."

**[Tela: terminal — manda payload malformado]**

```bash
curl -X POST http://localhost:3000/webhooks/meta \
  -H 'Content-Type: application/json' \
  -d '{"object":"whatsapp_business_account","entry":[]}'
```

> "Payload malformado para o Meta. Retorna 202 — o app aceita, persiste cru, mas no processamento o Zod rejeita."

**[Volta no psql]**

```sql
SELECT status, attempts, error FROM webhook_events ORDER BY received_at DESC LIMIT 3;
```

> "Status `dead_letter`, attempts 1, error explícito. Replay possível: bastaria um UPDATE para `status='received'` e o worker tenta de novo."

> "Idempotência: se eu mandar o mesmo webhook duas vezes — mesmo `external_id` — a UNIQUE constraint no banco rejeita o segundo. Sem duplicatas."

**[Volta no VS Code, ARCHITECTURE.md, seção 'Como adicionar um provider novo']**

> "E sobre extensibilidade: três passos para adicionar um provedor. Crio o adapter com Zod schema e a interface `ProviderAdapter`. Adiciono o import no `index.ts`. Insiro a row no seed. Nenhum outro arquivo muda. O endpoint nasce funcionando."

---

## 🎬 BLOCO 8 — FECHAMENTO (9:00–10:00)

**[Tela: README aberto na seção de decisões técnicas, ou ARCHITECTURE]**

> "Para fechar, três trade-offs que vale comentar."

> "**Primeiro**: usei worker in-process com fila in-table em vez de BullMQ + Redis. Para o volume da prova é mais que suficiente, e escalável horizontalmente — basta dar `docker compose scale app=N` e o `FOR UPDATE SKIP LOCKED` garante que ninguém pega o mesmo evento. Documentei o caminho de migração para Redis se a vazão crescer."

> "**Segundo**: classificação LLM é best-effort. Se a OpenAI estiver fora ou rate-limited, a mensagem persiste sem `intent`. Não bloqueia o pipeline. Um job futuro pode varrer mensagens com `intent_classified_at IS NULL` e reclassificar."

> "**Terceiro**: signature verification (HMAC) ficou de fora. É essencial em produção, mas adicionar três implementações distintas — uma por provider — não muda a arquitetura. É código por adapter."

> "O que faria com mais tempo: signature verification, identidade unificada de contato entre providers, e métricas Prometheus. Mas para a prova, o foco foi clareza, extensibilidade e pragmatismo."

> "Repositório, README detalhado, ARCHITECTURE.md com diagrama, Postman collection e guia de deploy estão tudo no GitHub. Obrigado!"

---

# 🎯 VERSÃO BULLET POINTS (improvisação)

## 0:00–0:30 — Intro
- Sou X, prova técnica SuperSDR Webhook Normalizer
- Stack: Node.js + TS, Fastify, Drizzle, Postgres, OpenAI

## 0:30–1:30 — O problema
- 3 formatos diferentes pra mesma "mensagem recebida"
- Mostrar samples lado a lado

## 1:30–2:30 — Arquitetura
- Adapter + Registry self-register (Open/Closed)
- Ack first, process async (Stripe pattern)
- Idempotência via UNIQUE
- DLQ in-table + retry com backoff

## 2:30–4:00 — Demo do código
- types.ts (NormalizedMessage + Result)
- registry.ts (Map<id, Adapter>)
- meta.ts (Zod + register no fim)
- index.ts (3 imports → tudo funciona)

## 4:00–6:30 — Demo Postman
- Health endpoint
- POST Meta → 202
- POST Evolution → 202
- POST Z-API → 202
- psql: 3 mensagens, mesmo schema, intent classificado

## 6:30–7:30 — LLM
- Structured output (não é parse de string)
- Schema Zod = TypeScript + runtime
- 8 categorias pt-BR
- Mostrar `intent` + `confidence` no banco

## 7:30–9:00 — Resiliência + extensibilidade
- 404 em provider desconhecido
- Payload malformado → dead_letter com error preservado
- Idempotência: webhook 2x = só 1 row
- Adicionar Twilio em 3 passos (mostrar arquitetura)

## 9:00–10:00 — Fechamento
- Trade-offs: in-process worker, LLM best-effort, sem HMAC
- O que faria com mais tempo: HMAC, identidade unificada, métricas
- Link do repo, README, vídeo

---

# 📌 DICAS DE GRAVAÇÃO

## Antes
- ✅ Faça **1 ensaio completo sem gravar** (calibrar tempo)
- ✅ Tenha o `.env` carregado e o app rodando
- ✅ Postman + psql + VS Code em janelas distintas (Cmd+Tab fluido)
- ✅ **Crie 1 mensagem com intent classificado ANTES** — o vídeo fica mais limpo se já houver dados ricos para mostrar

## Durante
- 🎙️ Fala devagar, em ritmo de "explicar"
- 🎙️ Pausa de 2 segundos entre blocos
- 🎙️ Se errar, fica em silêncio 3s e refaz a frase
- 🖱️ Mouse devagar, espectador acompanha
- ⌨️ Cole comandos prontos em vez de digitar — mais limpo

## Depois
- ✂️ Edição mínima: corta cabeça/cauda + erros óbvios
- 📤 YouTube → **Não listado** (link compartilhável)
- 📄 Cole link no README e na entrega final

## Tempo realista
- Setup: 5 min
- Ensaio: 10 min
- Gravação: 12–15 min (com retakes)
- Edição: 10 min
- Upload: 5 min
- **Total: ~45 min**

---

**Boa sorte! O sistema está sólido — agora é só apresentar com confiança. 🚀**
