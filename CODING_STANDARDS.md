# Manual de Normas de Programação Profissional e Auditoria (INP Protocol)

Este documento estabelece os padrões e requisitos mandatórios para qualquer desenvolvimento, refatoração ou adição de código no projeto **INP Protocol**.

Todo o código submetido é sujeito a verificação automatizada via ferramentas de linting, scripts de integridade (`scripts/enforce-standards.js`), ganchos de pré-submissão (*git pre-commit hooks*) e pipelines de Integração Contínua (CI).

---

## 1. Princípios de Engenharia de Software

1. **SOLID e Arquitetura Limpa**:
   - Cada classe ou módulo deve possuir uma única responsabilidade (*Single Responsibility Principle*).
   - O protocolo separa estritamente a análise sintática (*IntentParser*), resolução (*MatchingEngine*), orquestração (*ExecutionEngine*), persistência (*TypeORM Repositories*) e transporte (*Express API*).
2. **Programação Defensiva e Zero-Trust**:
   - Nunca confiar em entradas de utilizador ou respostas de serviços externos.
   - Todas as cargas úteis (*payloads*) devem ser validadas e sanitizadas contra injeções SQL, XSS, SSRF e corrupção de protótipo (*Prototype Pollution*).
3. **Idempotência e Tolerância a Falhas**:
   - As operações transacionais distribuídas devem suportar o padrão Saga com ações compensatórias explícitas.
   - Bloqueios distribuídos (*TransactionLock*) devem ser utilizados em operações concorrentes para prevenir condições de corrida (*race conditions*).
4. **Tipagem Estrita (TypeScript Strict Mode)**:
   - É expressamente proibido o uso descuidado do tipo `any`.
   - Todas as funções devem declarar explicitamente tipos de argumentos e tipos de retorno.

---

## 2. Padrões Obrigatórios de Documentação (TSDoc / JSDoc)

Cada ficheiro de código criado ou modificado deve cumprir os seguintes critérios de documentação em **Português de Portugal**:

### 2.1 Cabeçalho de Ficheiro
Todo o ficheiro deve iniciar com um bloco descritivo:
```typescript
/**
 * @fileoverview [Nome do Módulo] - [Descrição sumária da responsabilidade do ficheiro]
 * @module [NomeDoModulo]
 * @description
 * [Explicação detalhada da arquitetura, fluxo e papel deste componente no ecossistema INP]
 *
 * @security [Requisitos de segurança abordados: cifragem, sanitização, permissões, etc.]
 * @audit [Aspetos relevantes para auditoria: rastreabilidade, persistência de eventos, integridade]
 */
```

### 2.2 Classes, Interfaces e Tipos
Toda a definição de tipo ou classe deve documentar:
- O propósito do objeto.
- Regras de negócio ou contratos que implementa.
- Etiquetas `@security` e `@audit` quando aplicável.

### 2.3 Métodos e Funções
Cada função (pública, protegida ou privada de lógica complexa) deve conter:
- `@description`: O que a função faz e por que razão existe.
- `@param {tipo} nome`: Descrição do papel do argumento e restrições de validação.
- `@returns {tipo}`: Descrição do resultado devolvido e casos especiais (nulo, indefinido, vazio).
- `@throws {Erro}`: Condições exatas sob as quais a função despoleta exceções.
- `@security`: Validações de segurança executadas na rotina.
- `@audit`: Impacto em auditoria técnica e financeira/transacional.

---

## 3. Verificação Automatizada e Governança

Para assegurar o cumprimento estrito:
- O comando `npm run check:standards` inspeciona os ficheiros e valida a presença e conformidade dos blocos TSDoc.
- O gancho `.git/hooks/pre-commit` bloqueia qualquer `git commit` caso existam ficheiros em falta de comentários ou que desrespeitem as normas.
- A compilação (`npm run build`) falhará se existirem erros de tipo estrito ou regras violadas.
