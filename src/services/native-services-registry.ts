/**
 * @fileoverview Registo Centralizado e Auto-Aprovisionamento de Serviços Nativos do INP (NativeServicesRegistry)
 * @module Services/NativeServicesRegistry
 * @description
 * Módulo de bootstrap responsável pelo registo automático de todos os serviços nativos
 * integrados do protocolo INP no `CapabilityRegistry` durante a inicialização do gateway.
 * Os serviços nativos são implementações locais em memória (sem endpoint HTTP externo)
 * que disponibilizam capacidades de IA, webhooks, cache, transformação de dados
 * e geração de documentos diretamente na rede de orquestração do INP.
 *
 * @security Todos os serviços nativos são registados com trustScore: 100 e securityLevel: HIGH
 * pois são parte integrante e auditada do núcleo do protocolo.
 * @audit Regista o início do aprovisionamento e o número de capacidades nativas disponibilizadas.
 */

import { CapabilityRegistry } from '../core/capability-registry';
import { nativeAIHandler } from './native-ai-service';
import { nativeWebhookHandler } from './native-webhook-service';
import { nativeCacheHandler } from './native-cache-service';
import { nativeDataTransformerHandler } from './native-data-transformer-service';
import { nativeDocumentHandler } from './native-document-service';
import { nativeAdvancedVerbsHandler } from './native-advanced-verbs-service';

/**
 * @description Regista automaticamente todos os serviços nativos do INP Protocol no catálogo de capacidades.
 * Deve ser invocado uma única vez durante o arranque do gateway, após a inicialização do AppDataSource.
 *
 * @param {CapabilityRegistry} registry - Instância ativa do catálogo de capacidades.
 * @returns {Promise<void>} Promessa resolvida após o registo integral de todos os serviços nativos.
 * @security Serviços nativos recebem trustScore: 100 — reservado exclusivamente para implementações auditadas do núcleo.
 * @audit Regista o número total de capacidades nativas disponibilizadas no arranque do sistema.
 */
export async function registerNativeServices(registry: CapabilityRegistry): Promise<void> {
  console.log('[INP Native] A registar serviços nativos integrados no catálogo...');

  // 1. Serviço Nativo de IA
  await registry.register({
    id: 'inp-native-ai-service',
    name: 'INP Native AI Inference Gateway',
    description: 'Serviço nativo de inferência de IA com fallback multi-provedor (Gemini/OpenAI/Mock) e cache de respostas.',
    capabilities: [
      { verb: 'EXECUTE', target: 'AI_INFERENCE', description: 'Executa inferência generativa de texto com modelos de linguagem de grande escala.', requiredPermissions: [] },
      { verb: 'ANALYZE', target: 'TEXT', description: 'Análise semântica, classificação e extração de entidades de texto.', requiredPermissions: [] },
      { verb: 'GENERATE', target: 'SUMMARY', description: 'Sumarização de dados estruturados ou texto extenso.', requiredPermissions: [] },
    ],
    trustScore: 100,
    securityLevel: 'HIGH',
    handler: async (input: any, ctx?: any) => nativeAIHandler({ ...input, verb: input.verb || 'EXECUTE AI_INFERENCE' }, ctx),
  });

  // 2. Serviço Nativo de Webhooks
  await registry.register({
    id: 'inp-native-webhook-service',
    name: 'INP Native Universal Webhook Dispatcher',
    description: 'Despacha eventos assinados (HMAC-SHA256) para URLs de clientes com retentativas automáticas e suporte a DLQ.',
    capabilities: [
      { verb: 'DISPATCH', target: 'WEBHOOK', description: 'Despacho assíncrono garantido de webhooks HTTP assinados.', requiredPermissions: [] },
      { verb: 'PUBLISH', target: 'EVENT', description: 'Publicação de eventos nomeados para múltiplos destinos externos.', requiredPermissions: [] },
    ],
    trustScore: 100,
    securityLevel: 'HIGH',
    handler: async (input: any, ctx?: any) => nativeWebhookHandler({ ...input, verb: input.verb || 'DISPATCH WEBHOOK' }, ctx),
  });

  // 3. Serviço Nativo de Cache
  await registry.register({
    id: 'inp-native-cache-service',
    name: 'INP Native High-Speed In-Memory Cache',
    description: 'Cache de alta velocidade com TTL configurável para eliminar chamadas redundantes entre passos do fluxo.',
    capabilities: [
      { verb: 'STORE', target: 'CACHE', description: 'Armazena um valor em cache com TTL configurável.', requiredPermissions: [] },
      { verb: 'FETCH', target: 'CACHE', description: 'Recupera um valor previamente armazenado em cache por chave.', requiredPermissions: [] },
      { verb: 'CANCEL', target: 'CACHE', description: 'Invalida entradas de cache por chave ou padrão glob.', requiredPermissions: [] },
    ],
    trustScore: 100,
    securityLevel: 'HIGH',
    handler: async (input: any, ctx?: any) => nativeCacheHandler({ ...input, verb: input.verb || 'FETCH CACHE' }, ctx),
  });

  // 4. Serviço Nativo de Transformação de Dados
  await registry.register({
    id: 'inp-native-data-transformer',
    name: 'INP Native Data Mapper & Transformer Engine',
    description: 'Mapeamento, renomeação, filtragem e transformação declarativa de campos JSON sem microsserviços intermediários.',
    capabilities: [
      { verb: 'PROCESS', target: 'TRANSFORM', description: 'Aplica regras de transformação e mapeamento a um objeto JSON.', requiredPermissions: [] },
      { verb: 'ROUTE', target: 'DATA', description: 'Remapeia campos de um objeto de origem para um objeto de destino.', requiredPermissions: [] },
      { verb: 'FILTER', target: 'LIST', description: 'Filtra uma lista de objetos com base em condições declarativas seguras.', requiredPermissions: [] },
    ],
    trustScore: 100,
    securityLevel: 'HIGH',
    handler: async (input: any, ctx?: any) => nativeDataTransformerHandler({ ...input, verb: input.verb || 'PROCESS TRANSFORM' }, ctx),
  });

  // 5. Serviço Nativo de Geração de Documentos
  await registry.register({
    id: 'inp-native-document-service',
    name: 'INP Native Document & Report Generator',
    description: 'Geração de documentos estruturados (HTML/Markdown/JSON), faturas e relatórios a partir do contexto de orquestração.',
    capabilities: [
      { verb: 'GENERATE', target: 'DOCUMENT', description: 'Gera documento estruturado em HTML, Markdown ou JSON a partir de template e dados.', requiredPermissions: [] },
      { verb: 'GENERATE', target: 'REPORT', description: 'Gera relatório analítico estruturado a partir de dados do contexto de orquestração.', requiredPermissions: [] },
    ],
    trustScore: 100,
    securityLevel: 'HIGH',
    handler: async (input: any, ctx?: any) => nativeDocumentHandler({ ...input, verb: input.verb || 'GENERATE DOCUMENT' }, ctx),
  });

  // 6. Serviço Nativo de Verbos Estratégicos (Anti-Stress & Alta Produtividade)
  await registry.register({
    id: 'inp-native-advanced-verbs-service',
    name: 'INP Native Advanced Strategic Verbs Engine',
    description: 'Motor nativo dos 14 verbos estratégicos: Coalesce, Memoize, Guard, Throttle, Batch, Defer, Merge, Await, Probe, Shadow, Redact, Checkpoint, Simulate e Fanout.',
    capabilities: [
      // 14 Verbos Estratégicos Anti-Stress & Confiabilidade
      { verb: 'COALESCE', target: '*', description: 'Colapso de requisições concorrentes idênticas em voo (Single-Flight).', requiredPermissions: [] },
      { verb: 'MEMOIZE', target: '*', description: 'Cache-aside atómico transparente com expiração por TTL.', requiredPermissions: [] },
      { verb: 'GUARD', target: '*', description: 'Barreira em memória para validação imediata de invariantes de segurança.', requiredPermissions: [] },
      { verb: 'THROTTLE', target: '*', description: 'Controle de vazão e cadência para contenção de picos de tráfego.', requiredPermissions: [] },
      { verb: 'RATE_LIMIT', target: '*', description: 'Controle de taxa Token Bucket por janela temporal de segurança.', requiredPermissions: [] },
      { verb: 'CIRCUIT_BREAKER', target: '*', description: 'Disjuntor de circuito em memória contra saturação e falhas em cascata.', requiredPermissions: [] },
      { verb: 'BATCH', target: '*', description: 'Divisão em lotes (chunking) e execução agregada de coleções.', requiredPermissions: [] },
      { verb: 'DEFER', target: '*', description: 'Agendamento assíncrono via Transactional Outbox (queue_jobs).', requiredPermissions: [] },
      { verb: 'MERGE', target: '*', description: 'Fusão profunda declarativa de múltiplos payloads de dados.', requiredPermissions: [] },
      { verb: 'AWAIT', target: '*', description: 'Suspensão de Saga sem bloqueio de threads até retoma externa.', requiredPermissions: [] },
      { verb: 'PROBE', target: '*', description: 'Inspeção de saúde volátil em memória sem escrita na base de dados.', requiredPermissions: [] },
      { verb: 'SHADOW', target: '*', description: 'Espelhamento de tráfego assíncrono para validação de nós sombra.', requiredPermissions: [] },
      { verb: 'REDACT', target: '*', description: 'Ofuscação e mascaramento de campos confidenciais em conformidade LGPD.', requiredPermissions: [] },
      { verb: 'CHECKPOINT', target: '*', description: 'Ponto de salvamento intermediário para recuperação progressiva de Saga.', requiredPermissions: [] },
      { verb: 'SIMULATE', target: '*', description: 'Injeção de latência simulada, erros e payloads mockados para testes.', requiredPermissions: [] },
      { verb: 'FANOUT', target: '*', description: 'Dispersão paralela para múltiplos destinos com controle de contrapressão.', requiredPermissions: [] },
      { verb: 'SHARD', target: '*', description: 'Particionamento horizontal de carga via hash consistente.', requiredPermissions: [] },
      { verb: 'COMPRESS', target: '*', description: 'Compactação de payloads volumosos em trânsito.', requiredPermissions: [] },
      { verb: 'DEBOUNCE', target: '*', description: 'Estabilização de eventos de alta frequência com janela de silêncio.', requiredPermissions: [] },
      { verb: 'PRIORITY_QUEUE', target: '*', description: 'Escalonamento diferenciado por níveis de prioridade crítica.', requiredPermissions: [] },
      { verb: 'HEALTH_CHECK', target: '*', description: 'Sonda rápida de vivacidade e prontidão de microsserviços.', requiredPermissions: [] },
      { verb: 'SHED_LOAD', target: '*', description: 'Descarte seletivo sob estresse de hardware.', requiredPermissions: [] },
      { verb: 'RETRY_BACKOFF', target: '*', description: 'Retentativas com recuo exponencial e dispersão aleatória.', requiredPermissions: [] },
      { verb: 'FALLBACK', target: '*', description: 'Degradação graciosa para rota de contingência.', requiredPermissions: [] },

      // 5 Verbos Revolucionários / Killer Features v2.7
      { verb: 'STREAM', target: '*', description: 'Streaming progressivo nativo de eventos e chunks delta em tempo real (SSE/WebSocket).', requiredPermissions: [] },
      { verb: 'ATTEST', target: '*', description: 'Atestação criptográfica imutável com prova forense de conformidade (HMAC-SHA256).', requiredPermissions: [] },
      { verb: 'ADAPT', target: '*', description: 'Roteamento inteligente dinâmico via Multi-Armed Bandit baseado em saúde e latência.', requiredPermissions: [] },
      { verb: 'ESCALATE', target: '*', description: 'Orquestração Human-in-the-Loop com controlo de SLA e contingência automática.', requiredPermissions: [] },
      { verb: 'REASON', target: '*', description: 'Deliberação e raciocínio agêntico autônomo estruturado com justificação lógica.', requiredPermissions: [] },
      { verb: 'CONSENSUS', target: '*', description: 'Acordo distribuído de quórum bizantino entre múltiplos nós.', requiredPermissions: [] },

      // Verbos Canónicos de Segurança, Contratos, Eventos e Gestão de Recursos
      { verb: 'VALIDATE', target: '*', description: 'Validação formal de schemas com compilador AJV de alta performance.', requiredPermissions: [] },
      { verb: 'ASSERT', target: '*', description: 'Asserção lógica de invariantes críticas com fail-fast.', requiredPermissions: [] },
      { verb: 'AUTHENTICATE', target: '*', description: 'Validação de credenciais, chaves e resolução de identidade digital.', requiredPermissions: [] },
      { verb: 'AUTHORIZE', target: '*', description: 'Verificação de privilégios de acesso RBAC/ABAC.', requiredPermissions: [] },
      { verb: 'AUDIT', target: '*', description: 'Registro imutável em trilha forense criptográfica com hash SHA-256.', requiredPermissions: [] },
      { verb: 'SANITIZE', target: '*', description: 'Higienização profunda contra injeções de script e HTML malicioso.', requiredPermissions: [] },
      { verb: 'ENFORCE_SCHEMA', target: '*', description: 'Coerção ativa de schema com expurgo de propriedades não contratadas.', requiredPermissions: [] },
      { verb: 'CHECK_POLICY', target: '*', description: 'Avaliação declarativa de regras de conformidade corporativa.', requiredPermissions: [] },
      { verb: 'FETCH', target: '*', description: 'Recuperação determinística de entidades por chave primária.', requiredPermissions: [] },
      { verb: 'QUERY', target: '*', description: 'Execução de consultas filtradas e paginadas sobre coleções.', requiredPermissions: [] },
      { verb: 'READ', target: '*', description: 'Leitura rápida de buffers de memória e variáveis de configuração.', requiredPermissions: [] },
      { verb: 'RETRIEVE', target: '*', description: 'Busca em grafo de entidades com expansão estruturada.', requiredPermissions: [] },
      { verb: 'STREAM_READ', target: '*', description: 'Consumo assíncrono de arquivos e fluxos em blocos discretos.', requiredPermissions: [] },
      { verb: 'STORE', target: '*', description: 'Armazenamento direto de dados e estados de entidades.', requiredPermissions: [] },
      { verb: 'MUTATE', target: '*', description: 'Mutação transacional de estado com suporte ao padrão Saga.', requiredPermissions: [] },
      { verb: 'CREATE', target: '*', description: 'Criação e inserção persistente de novas entidades.', requiredPermissions: [] },
      { verb: 'UPDATE', target: '*', description: 'Substituição completa de entidades existentes.', requiredPermissions: [] },
      { verb: 'DELETE', target: '*', description: 'Remoção lógica ou física com preservação de auditoria.', requiredPermissions: [] },
      { verb: 'UPSERT', target: '*', description: 'Fusão atómica: atualiza se existir ou cria novo registro.', requiredPermissions: [] },
      { verb: 'PATCH', target: '*', description: 'Atualização parcial pontual de propriedades de uma entidade.', requiredPermissions: [] },
      { verb: 'EXECUTE', target: '*', description: 'Execução canónica de ações e procedimentos de negócio.', requiredPermissions: [] },
      { verb: 'PROCESS', target: '*', description: 'Processamento assíncrono ou síncrono de cargas úteis e rotinas.', requiredPermissions: [] },
      { verb: 'ANALYZE', target: '*', description: 'Análise de métricas, telemetria e scoring analítico.', requiredPermissions: [] },
      { verb: 'GENERATE', target: '*', description: 'Geração declarativa de faturas, identificadores e artefatos.', requiredPermissions: [] },
      { verb: 'ROUTE', target: '*', description: 'Roteamento declarativo de tráfego, mensagens e nós federados.', requiredPermissions: [] },
      { verb: 'CANCEL', target: '*', description: 'Cancelamento transacional de assinaturas, reservas ou ordens.', requiredPermissions: [] },
      { verb: 'DISPATCH', target: '*', description: 'Despacho de eventos, notificações e tarefas assíncronas.', requiredPermissions: [] },
      { verb: 'NOTIFY', target: '*', description: 'Emissão declarativa de avisos e comunicações aos utilizadores.', requiredPermissions: [] },
      { verb: 'TRIGGER', target: '*', description: 'Desencadeamento imediato de eventos e rotinas periféricas.', requiredPermissions: [] },
      { verb: 'SUBSCRIBE', target: '*', description: 'Assinatura reativa a tópicos de mensagens e barramentos.', requiredPermissions: [] },
      { verb: 'PUBLISH', target: '*', description: 'Publicação assíncrona de mensagens em canais de distribuição.', requiredPermissions: [] },
      { verb: 'ENCRYPT', target: '*', description: 'Cifragem criptográfica simétrica de cargas úteis sensíveis.', requiredPermissions: [] },
      { verb: 'DECRYPT', target: '*', description: 'Decifragem e recuperação de dados previamente encriptados.', requiredPermissions: [] },
      { verb: 'SIGN', target: '*', description: 'Assinatura digital de mensagens e recibos eletrónicos.', requiredPermissions: [] },
      { verb: 'VERIFY', target: '*', description: 'Verificação de integridade e validade de assinaturas digitais.', requiredPermissions: [] },
      { verb: 'LOCK', target: '*', description: 'Bloqueio exclusivo de recursos concorrentes (Distributed Mutex).', requiredPermissions: [] },
      { verb: 'UNLOCK', target: '*', description: 'Desbloqueio de recursos anteriormente adquiridos com trinco.', requiredPermissions: [] },
      { verb: 'ACQUIRE', target: '*', description: 'Aquisição de semáforos ou quotas de concorrência limitada.', requiredPermissions: [] },
      { verb: 'RELEASE', target: '*', description: 'Libertação de quotas e devolução de permissões de vazão.', requiredPermissions: [] },
      { verb: 'TRANSFORM', target: '*', description: 'Mapeamento e reestruturação pura em memória de payloads.', requiredPermissions: [] },
      { verb: 'MAP', target: '*', description: 'Projeção de campos e transformações sobre listas de itens.', requiredPermissions: [] },
      { verb: 'FILTER', target: '*', description: 'Filtragem seletiva de coleções por predicado lógico.', requiredPermissions: [] },
      { verb: 'REDUCE', target: '*', description: 'Redução e acumulação iterativa de coleções em valores atómicos.', requiredPermissions: [] },
      { verb: 'AGGREGATE', target: '*', description: 'Cálculo de métricas agrupadas sobre dimensões de coleções.', requiredPermissions: [] },
      { verb: 'ENRICH', target: '*', description: 'Enriquecimento estruturado de dados combinando fontes complementares.', requiredPermissions: [] },
      { verb: 'RESOLVE', target: '*', description: 'Resolução de nomes semânticos e identificadores universais.', requiredPermissions: [] },
      { verb: 'TRANSFER', target: '*', description: 'Movimentação atómica de saldos, recursos ou propriedades entre nós.', requiredPermissions: [] },
      { verb: 'SYNC', target: '*', description: 'Sincronização bidirecional atómica entre duas fontes de verdade.', requiredPermissions: [] },
      { verb: 'COMPOSE', target: '*', description: 'Síntese e orquestração composta de múltiplos nós subordinados.', requiredPermissions: [] },
      { verb: 'CALCULATE', target: '*', description: 'Execução de equações e operações matemáticas determinísticas.', requiredPermissions: [] },
      { verb: 'REFUND', target: '*', description: 'Estorno financeiro compensatório no livro-razão de transações.', requiredPermissions: [] },
      { verb: 'APPROVE', target: '*', description: 'Aprovação e liberação formal de ordens em filas de governança.', requiredPermissions: [] },
      { verb: 'REJECT', target: '*', description: 'Rejeição motivada de solicitações com registo de trilha de auditoria.', requiredPermissions: [] },
      { verb: 'CHECK', target: '*', description: 'Inspeção rápida de condições ou estados preliminares sem efeitos laterais.', requiredPermissions: [] },
      { verb: 'RESERVE', target: '*', description: 'Reserva temporária de recursos ou saldos com TTL de expiração automática.', requiredPermissions: [] },
      { verb: 'SEND', target: '*', description: 'Envio determinístico ponto-a-ponto de mensagens e notificações.', requiredPermissions: [] },
      { verb: 'ARCHIVE', target: '*', description: 'Movimentação imutável para armazenamento frio de longa duração.', requiredPermissions: [] },
      { verb: 'LOOP', target: '*', description: 'Repetição controlada com limite estrito de segurança contra travamentos.', requiredPermissions: [] },
      { verb: 'BRANCH', target: '*', description: 'Bifurcação multi-caminho declarativa (switch-case semântico).', requiredPermissions: [] },

      // 16 Verbos de Alta Produtividade e Resolução de Dores Críticas (Anti-Headache Engine v2.7)
      { verb: 'DEDUPLICATE', target: '*', description: 'Filtro deslizante de deduplicação idempotente com hash de conteúdo e janela temporal.', requiredPermissions: [] },
      { verb: 'REDRIVE', target: '*', description: 'Reprocessamento auditado e controlado de mensagens retidas na Dead Letter Queue.', requiredPermissions: [] },
      { verb: 'CANARY', target: '*', description: 'Roteamento percentual progressivo com monitorização ativa de taxa de erro para novos nós.', requiredPermissions: [] },
      { verb: 'DIFF', target: '*', description: 'Comparação profunda determinística entre dois estados ou payloads estruturados JSON.', requiredPermissions: [] },
      { verb: 'CORRELATE', target: '*', description: 'Injeção e propagação estrita de identificadores de correlação e rastreio W3C TraceContext.', requiredPermissions: [] },
      { verb: 'ISOLATE', target: '*', description: 'Barreira mandatória de isolamento multi-tenant prevenindo vazamento de dados entre empresas.', requiredPermissions: [] },
      { verb: 'ANONYMIZE', target: '*', description: 'Pseudo-anonimização irreversível de dados sensíveis (PII) em conformidade estrita LGPD/GDPR.', requiredPermissions: [] },
      { verb: 'DRAIN', target: '*', description: 'Encerramento gracioso que recusa novas intenções e aguarda o término de tarefas em voo.', requiredPermissions: [] },
      { verb: 'QUARANTINE', target: '*', description: 'Isolamento de payloads malformados (poison pills) em sandbox forense selada para análise.', requiredPermissions: [] },
      { verb: 'LEASE', target: '*', description: 'Trinco com renovação ativa periódica (heartbeat lease) e libertação determinística por timeout.', requiredPermissions: [] },
      { verb: 'BACKPRESSURE', target: '*', description: 'Sinalização reativa de contrapressão para contenção de sobrecarga em consumidores lentos.', requiredPermissions: [] },
      { verb: 'MIGRATE', target: '*', description: 'Evolução e coerção dinâmica de esquemas JSON entre versões legadas e modernas sem paragens.', requiredPermissions: [] },
      { verb: 'SAMPLE', target: '*', description: 'Amostragem estatística adaptativa de telemetria para redução de custos em sistemas de APM.', requiredPermissions: [] },
      { verb: 'RECONCILE', target: '*', description: 'Reconciliação e batimento automático de duas fontes heterogéneas com identificação de discrepâncias.', requiredPermissions: [] },
      { verb: 'CHALLENGE', target: '*', description: 'Disparo de desafio de segurança step-up (MFA, CAPTCHA ou prova de trabalho criptográfica).', requiredPermissions: [] },
      { verb: 'MUTEX', target: '*', description: 'Exclusão mútua local com fila FIFO ordenada e proteção estrita contra concorrência destrutiva.', requiredPermissions: [] },

      // 15 Verbos de Interconexão entre Sistemas e Desmembramento Descomplicado (Bridge & Ergonomia v2.7)
      { verb: 'BRIDGE', target: '*', description: 'Adaptador e ponte universal de protocolos e esquemas entre sistemas heterogéneos.', requiredPermissions: [] },
      { verb: 'OUTBOUND', target: '*', description: 'Chamada HTTP/REST de saída resiliente com retentativas e disjuntor embutidos.', requiredPermissions: [] },
      { verb: 'INGEST', target: '*', description: 'Ingestão e normalização segura de webhooks externos com validação de assinatura HMAC.', requiredPermissions: [] },
      { verb: 'FANIN', target: '*', description: 'Junção e recolha sincronizada de fluxos assíncronos com suporte a quórum e timeout.', requiredPermissions: [] },
      { verb: 'EMIT', target: '*', description: 'Emissão assíncrona leve de eventos de negócio sem bloqueio de threads ou infraestrutura complexa.', requiredPermissions: [] },
      { verb: 'PLUCK', target: '*', description: 'Extração cirúrgica direta de campos específicos de listas ou objetos sem necessidade de MAP.', requiredPermissions: [] },
      { verb: 'FLATTEN', target: '*', description: 'Aplainamento imediato de matrizes ou árvores de objetos aninhados em lista única.', requiredPermissions: [] },
      { verb: 'MASK', target: '*', description: 'Mascaramento visual imediato de cartões, emails e CPFs para exibição segura.', requiredPermissions: [] },
      { verb: 'CAST', target: '*', description: 'Conversão segura de tipos de dados primitivos com tolerância a falhas e valor padrão.', requiredPermissions: [] },
      { verb: 'CLAMP', target: '*', description: 'Limitação estrita de valores numéricos entre limites mínimo e máximo autorizados.', requiredPermissions: [] },
      { verb: 'COOLDOWN', target: '*', description: 'Pausa cooperativa não-bloqueante na esteira com suporte a cancelamento de sinal.', requiredPermissions: [] },
      { verb: 'UNDO', target: '*', description: 'Reversão atómica imediata do passo transacional anterior sem configuração de Saga complexa.', requiredPermissions: [] },
      { verb: 'SNAPSHOT', target: '*', description: 'Captura fotográfica do estado transacional em memória para fins periciais ou replay.', requiredPermissions: [] },
      { verb: 'DIVERGE', target: '*', description: 'Bifurcação assíncrona não-bloqueante (fire-and-forget) para execução periférica em segundo plano.', requiredPermissions: [] },
      { verb: 'HEARTBEAT', target: '*', description: 'Emissão de sinal periódico de vivacidade para prevenção de timeouts falsos em orquestradores.', requiredPermissions: [] },
      // 5 Novos Verbos Estratégicos v2.8 (Resiliência, Observabilidade e Dados)
      { verb: 'COMPENSATE', target: '*', description: 'Disparo explícito de ação compensatória de Saga no meio de um fluxo.', requiredPermissions: [] },
      { verb: 'BENCHMARK', target: '*', description: 'Cronometragem de alta resolução com telemetria inline de latência e SLA.', requiredPermissions: [] },
      { verb: 'NORMALIZE', target: '*', description: 'Higienização e padronização semântica de datas, telefones e textos.', requiredPermissions: [] },
      { verb: 'ENQUEUE', target: '*', description: 'Enfileiramento transacional na tabela outbox com prioridade e atraso.', requiredPermissions: [] },
      { verb: 'INSPECT', target: '*', description: 'Inspeção e captura de snapshot de depuração via SSE sem alterar a esteira.', requiredPermissions: [] },
      // Verbos da Máquina do Tempo v2.0 (Replay, Simulação e Auditoria Temporal)
      { verb: 'TIME_TRAVEL', target: '*', description: 'Comandos avançados de viagem no tempo: SNAPSHOT, REPLAY, DIFF ou SIMULATE.', requiredPermissions: [] },
      { verb: 'REPLAY', target: '*', description: 'Re-execução determinística de intenção a partir de marco temporal histórico.', requiredPermissions: [] },
      { verb: 'SIMULATE', target: '*', description: 'Simulação preditiva What-If em sandbox dry-run sem disparar mutações reais.', requiredPermissions: [] },
      { verb: 'TIMELINE', target: '*', description: 'Inspeção e extração de linha do tempo cronológica com snapshots e deltas.', requiredPermissions: [] },
      // 8 Verbos Estratégicos da 9ª Família (IA Vetorial, Finanças Atómicas & Confiabilidade SRE v3.0)
      { verb: 'EMBED', target: '*', description: 'Vetorização semântica densa em memória para representação de textos e documentos.', requiredPermissions: [] },
      { verb: 'VECTOR_SEARCH', target: '*', description: 'Busca vetorial por similaridade cosseno direta em coleções ou memória (RAG).', requiredPermissions: [] },
      { verb: 'SPLIT', target: '*', description: 'Rateio financeiro atômico multidirecional com reconciliação estrita de centavos.', requiredPermissions: [] },
      { verb: 'ESCROW', target: '*', description: 'Custódia e retenção financeira de segurança com liquidação condicional e selo HMAC.', requiredPermissions: [] },
      { verb: 'POLL', target: '*', description: 'Consulta periódica assíncrona com backoff exponencial e critério de parada preditivo.', requiredPermissions: [] },
      { verb: 'INVALIDATE', target: '*', description: 'Purga seletiva de caches em memória por chave exata, wildcard ou tag semântica.', requiredPermissions: [] },
      { verb: 'DRIFT_DETECT', target: '*', description: 'Deteção de deriva conceitual e discrepâncias de schema em integrações de parceiros.', requiredPermissions: [] },
      { verb: 'CHAOS', target: '*', description: 'Injeção controlada de falhas, latência e exceções para testes de resiliência e disjuntores.', requiredPermissions: [] },
    ],
    trustScore: 100,
    securityLevel: 'HIGH',
    handler: async (input: any, ctx?: any) => nativeAdvancedVerbsHandler(input, ctx),
  });

  console.log('[INP Native] ✅ 6 serviços nativos registados com sucesso: IA, Webhook, Cache, Transformador, Documentos e Verbos Estratégicos.');
}
