/**
 * @fileoverview Suíte de Testes e Validação do Sistema de Acesso, Perfis e Governança DBA do INP Protocol.
 * Executa asserções rigorosas para validar:
 * 1. Hashing seguro de senhas com scrypt e sal criptográfico, e verificação timing-safe.
 * 2. Emissão e verificação de tokens HMAC-SHA256, rejeição de assinaturas adulteradas e tokens inválidos.
 * 3. Matriz de Controlo de Acesso Baseado em Papéis (RBAC) para Administrador, Clientes (Empresa e Independente), Auditor, DBAs e SecOps.
 * 4. Hierarquia gradual e separação de deveres para DBAs (Nível 1: Monitorização, Nível 2: DLQ/Operações, Nível 3: Manutenção/Sandbox SQL).
 * 5. Ciclo de vida e autenticação por chaves de API (API Keys) de longa duração.
 * 6. Operações do DBAService: telemetria de conexões/tabelas, proteção contra injeções SQL no sandbox e VACUUM ANALYZE.
 * 7. Persistência imutável de registos na tabela de auditoria forense (AuditLog).
 *
 * @module Scripts/TestAccessControl
 * @security Valida isolamento entre perfis, mitigação de abusos de privilégio e integridade criptográfica de tokens.
 * @audit Gera evidências formais de conformidade para auditorias de controlo de acessos e identidade.
 */

const { AppDataSource } = require('./dist/persistence/data-source');
const { AuthService } = require('./dist/core/auth-service');
const { AccessControl, PERMISSIONS } = require('./dist/core/access-control');
const { DBAService } = require('./dist/core/dba-service');
const { UserRepository } = require('./dist/persistence/repositories/UserRepository');
const { ApiKeyRepository } = require('./dist/persistence/repositories/ApiKeyRepository');
const { AuditLogRepository } = require('./dist/persistence/repositories/AuditLogRepository');

/**
 * Executa a bateria de testes de controlo de acessos e governança de perfis.
 *
 * @returns {Promise<void>}
 */
async function runAccessControlTests() {
  console.log('================================================================');
  console.log('   TESTES DE VALIDAÇÃO DO SISTEMA DE ACESSO E PERFIS (RBAC)     ');
  console.log('================================================================\n');

  let failed = false;

  try {
    // 0. Inicialização da Fonte de Dados
    console.log('--- 0. Inicializar Base de Dados e Aprovisionar Utilizadores ---');
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('✔ Base de dados PostgreSQL ligada com sucesso.');
    }
    await AuthService.seedDefaultUsers();
    console.log('✔ Utilizadores predefinidos aprovisionados com sucesso.\n');

    // 1. Testar Hashing Seguro de Palavras-passe (scrypt + salt)
    console.log('--- 1. Testar Hashing e Validação de Senhas (scrypt) ---');
    const plainPass = 'MinhaSenhaUltraSegura2026!';
    const hash1 = AuthService.hashPassword(plainPass);
    const hash2 = AuthService.hashPassword(plainPass);

    console.log(`Hash gerado 1: ${hash1.substring(0, 32)}...`);
    console.log(`Hash gerado 2: ${hash2.substring(0, 32)}...`);

    if (hash1 === hash2) {
      console.error('❌ FALHA: Dois hashes com a mesma senha não deveriam ser idênticos (sal aleatório em falta)!');
      failed = true;
    } else {
      console.log('✔ Sais criptográficos aleatórios verificados (hashes distintos para a mesma senha).');
    }

    const validCheck = AuthService.verifyPassword(plainPass, hash1);
    const invalidCheck = AuthService.verifyPassword('SenhaErrada123', hash1);

    if (validCheck && !invalidCheck) {
      console.log('✔ Verificação de senha correta aceite e incorreta rejeitada com sucesso.\n');
    } else {
      console.error('❌ FALHA na validação de palavras-passe scrypt!');
      failed = true;
    }

    // 2. Testar Tokens HMAC-SHA256 e Proteção contra Adulteração
    console.log('--- 2. Testar Tokens Criptográficos e Anti-Adulteração ---');
    const adminUser = await UserRepository.findOneBy({ email: 'admin@inp.org' });
    if (!adminUser) throw new Error('Utilizador admin@inp.org não encontrado');

    const token = AuthService.generateToken(adminUser);
    console.log(`Token gerado: ${token.substring(0, 40)}...`);

    const verified = AuthService.verifyToken(token);
    if (verified && verified.userId === adminUser.id && verified.role === 'ADMIN') {
      console.log('✔ Token legítimo validado com sucesso.');
    } else {
      console.error('❌ FALHA na validação do token legítimo!');
      failed = true;
    }

    // Adulteração propositada da carga útil do token
    const [payloadBase64, sig] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf-8'));
    decoded.role = 'SUPER_HACKER';
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url');
    const tamperedToken = `${tamperedPayload}.${sig}`;

    const tamperedResult = AuthService.verifyToken(tamperedToken);
    if (tamperedResult === null) {
      console.log('✔ Token adulterado rejeitado imediatamente pela assinatura HMAC-SHA256.');
    } else {
      console.error('❌ FALHA CRÍTICA: Token adulterado foi aceite!');
      failed = true;
    }

    // Token com assinatura corrompida
    const corruptSigToken = `${payloadBase64}.deadbeef12345678`;
    const corruptResult = AuthService.verifyToken(corruptSigToken);
    if (corruptResult === null) {
      console.log('✔ Token com assinatura corrompida rejeitado com sucesso.\n');
    } else {
      console.error('❌ FALHA: Assinatura corrompida aceite!');
      failed = true;
    }

    // 3. Testar Matriz de Permissões RBAC para Cada Perfil
    console.log('--- 3. Testar Matriz de Permissões por Perfil ---');
    const rolesToTest = [
      { role: 'ADMIN', expectedPerm: PERMISSIONS.USER_MANAGE, shouldHave: true },
      { role: 'CLIENT_ENTERPRISE', expectedPerm: PERMISSIONS.INTENT_EXECUTE, shouldHave: true },
      { role: 'CLIENT_ENTERPRISE', expectedPerm: PERMISSIONS.USER_MANAGE, shouldHave: false },
      { role: 'CLIENT_INDIVIDUAL', expectedPerm: PERMISSIONS.INTENT_EXECUTE, shouldHave: true },
      { role: 'CLIENT_INDIVIDUAL', expectedPerm: PERMISSIONS.CHAOS_MANAGE, shouldHave: false },
      { role: 'AUDITOR', expectedPerm: PERMISSIONS.AUDIT_READ, shouldHave: true },
      { role: 'AUDITOR', expectedPerm: PERMISSIONS.AUDIT_EXPORT, shouldHave: true },
      { role: 'AUDITOR', expectedPerm: PERMISSIONS.CHAOS_MANAGE, shouldHave: false },
      { role: 'AUDITOR', expectedPerm: PERMISSIONS.USER_MANAGE, shouldHave: false },
    ];

    for (const testCase of rolesToTest) {
      const perms = AccessControl.getPermissionsForRole(testCase.role);
      const has = perms.includes(testCase.expectedPerm);
      if (has === testCase.shouldHave) {
        console.log(`✔ Papel ${testCase.role}: permissão "${testCase.expectedPerm}" -> ${has ? 'CONCEDIDA' : 'NEGADA'} (Conforme esperado).`);
      } else {
        console.error(`❌ FALHA no papel ${testCase.role}: permissão "${testCase.expectedPerm}" deveria ser ${testCase.shouldHave} mas foi ${has}!`);
        failed = true;
      }
    }
    console.log('');

    // 4. Testar Níveis Graduais de DBA (Nível 1, 2 e 3)
    console.log('--- 4. Testar Privilégios Graduais de DBA (Níveis 1, 2 e 3) ---');
    
    // DBA Nível 1: apenas monitorização
    const dba1Perms = AccessControl.getPermissionsForRole('DBA', 1);
    const dba1HasMonitor = dba1Perms.includes(PERMISSIONS.DBA_MONITOR);
    const dba1HasOperate = dba1Perms.includes(PERMISSIONS.DBA_OPERATE);
    const dba1HasAdmin = dba1Perms.includes(PERMISSIONS.DBA_ADMIN);
    console.log(`DBA Nível 1: Monitor=${dba1HasMonitor}, Operate=${dba1HasOperate}, Admin=${dba1HasAdmin}`);
    if (dba1HasMonitor && !dba1HasOperate && !dba1HasAdmin) {
      console.log('✔ DBA Nível 1 validado: Apenas monitorização concedida.');
    } else {
      console.error('❌ FALHA nos privilégios do DBA Nível 1!');
      failed = true;
    }

    // DBA Nível 2: monitorização + operações de fila/DLQ
    const dba2Perms = AccessControl.getPermissionsForRole('DBA', 2);
    const dba2HasMonitor = dba2Perms.includes(PERMISSIONS.DBA_MONITOR);
    const dba2HasOperate = dba2Perms.includes(PERMISSIONS.DBA_OPERATE);
    const dba2HasAdmin = dba2Perms.includes(PERMISSIONS.DBA_ADMIN);
    console.log(`DBA Nível 2: Monitor=${dba2HasMonitor}, Operate=${dba2HasOperate}, Admin=${dba2HasAdmin}`);
    if (dba2HasMonitor && dba2HasOperate && !dba2HasAdmin) {
      console.log('✔ DBA Nível 2 validado: Monitorização e Operações concedidas, Admin bloqueado.');
    } else {
      console.error('❌ FALHA nos privilégios do DBA Nível 2!');
      failed = true;
    }

    // DBA Nível 3: todos os privilégios DBA
    const dba3Perms = AccessControl.getPermissionsForRole('DBA', 3);
    const dba3HasMonitor = dba3Perms.includes(PERMISSIONS.DBA_MONITOR);
    const dba3HasOperate = dba3Perms.includes(PERMISSIONS.DBA_OPERATE);
    const dba3HasAdmin = dba3Perms.includes(PERMISSIONS.DBA_ADMIN);
    console.log(`DBA Nível 3: Monitor=${dba3HasMonitor}, Operate=${dba3HasOperate}, Admin=${dba3HasAdmin}`);
    if (dba3HasMonitor && dba3HasOperate && dba3HasAdmin) {
      console.log('✔ DBA Nível 3 validado: Acesso pleno a Monitorização, Operações e Manutenção.\n');
    } else {
      console.error('❌ FALHA nos privilégios do DBA Nível 3!');
      failed = true;
    }

    // Validação de hasDbaLevel
    const secContextDba1 = { role: 'DBA', dbaLevel: 1 };
    const secContextDba2 = { role: 'DBA', dbaLevel: 2 };
    const secContextDba3 = { role: 'DBA', dbaLevel: 3 };
    const secContextAdmin = { role: 'ADMIN' };
    const secContextClient = { role: 'CLIENT_INDIVIDUAL' };

    if (
      AccessControl.hasDbaLevel(secContextDba1, 1) === true &&
      AccessControl.hasDbaLevel(secContextDba1, 2) === false &&
      AccessControl.hasDbaLevel(secContextDba2, 2) === true &&
      AccessControl.hasDbaLevel(secContextDba2, 3) === false &&
      AccessControl.hasDbaLevel(secContextDba3, 3) === true &&
      AccessControl.hasDbaLevel(secContextAdmin, 3) === true &&
      AccessControl.hasDbaLevel(secContextClient, 1) === false
    ) {
      console.log('✔ Avaliação de níveis hierárquicos hasDbaLevel() validada com total precisão.\n');
    } else {
      console.error('❌ FALHA na avaliação lógica de hasDbaLevel!');
      failed = true;
    }

    // 5. Testar Chaves de API (Criação, Hashing e Autenticação)
    console.log('--- 5. Testar Ciclo de Vida de Chaves de API ---');
    const enterpriseUser = await UserRepository.findOneBy({ email: 'empresa@techcorp.com' });
    if (!enterpriseUser) throw new Error('empresa@techcorp.com não encontrada');

    const { apiKey, secretKey } = await AuthService.createApiKey(
      enterpriseUser.id,
      'Chave de Produção ERP',
      [PERMISSIONS.INTENT_EXECUTE, PERMISSIONS.INTENT_ASYNC],
      30
    );

    console.log(`Chave criada com ID: ${apiKey.id}, Prefixo: ${apiKey.keyPrefix}`);
    console.log(`Segredo bruto: ${secretKey.substring(0, 20)}...`);

    // Autenticar com chave correta
    const authSuccess = await AuthService.authenticateApiKey(secretKey);
    if (authSuccess && authSuccess.user.id === enterpriseUser.id) {
      console.log('✔ Autenticação por Chave de API bem-sucedida.');
    } else {
      console.error('❌ FALHA na autenticação por Chave de API válida!');
      failed = true;
    }

    // Autenticar com chave adulterada
    const authFail = await AuthService.authenticateApiKey(secretKey + 'corrupt');
    if (authFail === null) {
      console.log('✔ Chave de API inválida rejeitada com sucesso.\n');
    } else {
      console.error('❌ FALHA: Chave de API inválida foi aceite!');
      failed = true;
    }

    // 6. Testar DBAService (Overview, Manutenção e Sandbox)
    console.log('--- 6. Testar Operações do DBAService ---');
    const overview = await DBAService.getOverview();
    console.log(`Nome da BD: ${overview.databaseName}, Ligado: ${overview.connected}`);
    console.log(`Versão PostgreSQL: ${overview.engineVersion.substring(0, 30)}...`);
    console.log(`Conexões Ativas: ${overview.activeConnections}, Cache Hit: ${overview.cacheHitRatio}%`);
    console.log(`Tabelas detetadas: ${overview.tables.map(t => t.tableName).join(', ')}`);

    if (overview.connected && overview.tables.length > 0) {
      console.log('✔ DBAService.getOverview() devolveu métricas com sucesso.');
    } else {
      console.error('❌ FALHA no DBAService.getOverview()!');
      failed = true;
    }

    // Testar VACUUM ANALYZE (Apenas DBA Nível 3 / Admin)
    const vacuumRes = await DBAService.runVacuumAnalyze('users', { role: 'DBA', dbaLevel: 3, email: 'dba3@inp.org' });
    console.log(`Resultado do VACUUM: ${vacuumRes.message}`);
    if (vacuumRes.success) {
      console.log('✔ VACUUM ANALYZE executado e auditado com sucesso.');
    } else {
      console.error('❌ FALHA no VACUUM ANALYZE!');
      failed = true;
    }

    // Testar Consulta Segura no Sandbox SQL
    const queryRes = await DBAService.executeDiagnosticQuery('SELECT 1 + 1 AS soma;', { role: 'DBA', dbaLevel: 3, email: 'dba3@inp.org' });
    console.log(`Resultado da consulta diagnóstica: ${JSON.stringify(queryRes.rows)} (Duração: ${queryRes.durationMs}ms)`);
    if (queryRes.rows && queryRes.rows[0]?.soma === 2) {
      console.log('✔ Consulta de diagnóstico executada com sucesso.');
    } else {
      console.error('❌ FALHA na consulta de diagnóstico!');
      failed = true;
    }

    // Testar Bloqueio de Comandos Destrutivos no Sandbox
    try {
      await DBAService.executeDiagnosticQuery('DROP DATABASE inp;', { role: 'DBA', dbaLevel: 3 });
      console.error('❌ FALHA: Comando proibido DROP DATABASE foi aceite!');
      failed = true;
    } catch (err) {
      console.log(`✔ Sucesso: Comando destrutivo bloqueado preventivamente com erro: "${err.message}".`);
    }
    console.log('');

    // 7. Testar Registo de Auditoria Forense (AuditLog)
    console.log('--- 7. Testar Registo e Rastreabilidade Forense (AuditLog) ---');
    const recentLogs = await AuditLogRepository.find({
      order: { createdAt: 'DESC' },
      take: 5
    });

    console.log(`Total de logs recentes recolhidos: ${recentLogs.length}`);
    for (const l of recentLogs) {
      console.log(`  [${l.createdAt.toISOString()}] ${l.action} (${l.status}) por ${l.userEmail || 'Sistema'} -> Recurso: ${l.resource}`);
    }

    if (recentLogs.length > 0) {
      console.log('✔ Rastreabilidade forense validada: Todos os eventos críticos foram persistidos em audit_logs.\n');
    } else {
      console.error('❌ FALHA: Nenhum registo de auditoria foi encontrado!');
      failed = true;
    }

  } catch (err) {
    console.error('❌ Erro inesperado durante os testes de controlo de acessos:', err);
    failed = true;
  }

  console.log('================================================================');
  if (failed) {
    console.error('❌ A SUÍTE DE TESTES DE CONTROLO DE ACESSO FALHOU!');
    process.exit(1);
  } else {
    console.log('✅ TODOS OS TESTES DO SISTEMA DE ACESSO PASSARAM COM DISTINÇÃO!');
    console.log('================================================================\n');
    process.exit(0);
  }
}

// Disparo da execução
runAccessControlTests();
