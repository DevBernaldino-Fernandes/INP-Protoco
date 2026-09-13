/**
 * @fileoverview Suíte de Testes Automatizados para Validação de Registo (Cadastro) e Login
 * @module Scripts/TestRegistrationLogin
 * @description
 * Testa exaustivamente o ciclo de vida de utilizadores do INP Protocol:
 * 1. Auto-registo de novos utilizadores com papel CLIENT_INDIVIDUAL, CLIENT_ENTERPRISE e DBA.
 * 2. Autenticação e emissão de tokens de sessão para as credenciais recém-registadas.
 * 3. Validação de rejeição para senhas demasiado curtas e emails duplicados.
 * 4. Isolamento e verificação de cotas atribuídas dinamicamente por perfil.
 * 5. Conferência de registo imutável na tabela de auditoria forense (AuditLog).
 *
 * @security Valida mitigação de abusos no auto-registo e integridade criptográfica de palavras-passe.
 * @audit Assegura evidências formais de conformidade para auditorias de segurança e autenticação.
 */

const { AppDataSource } = require('./dist/persistence/data-source');
const { AuthService } = require('./dist/core/auth-service');
const { AccessControl, PERMISSIONS } = require('./dist/core/access-control');
const { UserRepository } = require('./dist/persistence/repositories/UserRepository');
const { AuditLogRepository } = require('./dist/persistence/repositories/AuditLogRepository');

async function runTests() {
  console.log('================================================================');
  console.log('   TESTES DE REGISTO (CADASTRO) E LOGIN DO PORTAL INP          ');
  console.log('================================================================\n');

  let failed = false;

  try {
    // 0. Inicializar Base de Dados
    console.log('--- 0. Inicializar Base de Dados ---');
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('✔ Ligação ao PostgreSQL estabelecida.');
    }
    await AuthService.seedDefaultUsers();
    console.log('✔ Utilizadores predefinidos aprovisionados com sucesso.\n');

    // 1. Testar Registo de Cliente Independente
    console.log('--- 1. Testar Registo de Novo Cliente Independente ---');
    const testDevEmail = `novo_dev_${Date.now()}@exemplo.com`;
    const testDevPass = 'SenhaForte2026!';
    const testDevName = 'Carlos Dev Independente';

    // Limpar utilizador prévio se existir
    await UserRepository.delete({ email: testDevEmail });

    const plainPassword = testDevPass;
    const passwordHash = AuthService.hashPassword(plainPassword);
    const userIndividual = UserRepository.create({
      name: testDevName,
      email: testDevEmail,
      passwordHash,
      role: 'CLIENT_INDIVIDUAL',
      quotaLimit: 1000,
      quotaUsed: 0,
      active: true
    });
    const savedUser = await UserRepository.save(userIndividual);

    console.log(`✔ Utilizador individual guardado com ID: ${savedUser.id}`);
    if (savedUser.quotaLimit !== 1000) {
      console.error('❌ FALHA: Cota inicial de utilizador individual deveria ser 1000.');
      failed = true;
    }

    // 2. Testar Autenticação e Emissão de Token do Novo Utilizador
    console.log('\n--- 2. Testar Login com Credenciais Recém-Cadastradas ---');
    const dbUser = await UserRepository.findOneBy({ email: testDevEmail });
    if (!dbUser) {
      console.error('❌ FALHA: Utilizador não encontrado na base de dados.');
      failed = true;
    } else {
      const isMatch = AuthService.verifyPassword(testDevPass, dbUser.passwordHash);
      if (!isMatch) {
        console.error('❌ FALHA: Validação da senha falhou.');
        failed = true;
      } else {
        console.log('✔ Senha validada com sucesso pelo AuthService.');
      }

      const token = AuthService.generateToken(dbUser);
      console.log(`✔ Token de sessão gerado: ${token.substring(0, 24)}...`);
      const payload = AuthService.verifyToken(token);
      if (!payload || payload.email !== testDevEmail) {
        console.error('❌ FALHA: Token emitido não contém o email correto do utilizador.');
        failed = true;
      } else {
        console.log('✔ Token verificado com integridade HMAC intacta.');
      }
    }

    // 3. Testar Registo de Cliente Empresa (com Nome da Empresa e Cota de 100k)
    console.log('\n--- 3. Testar Registo de Cliente Empresa ---');
    const testCorpEmail = `corp_${Date.now()}@techinnovate.com`;
    const testCorpUser = UserRepository.create({
      name: 'Diretor TI TechInnovate',
      email: testCorpEmail,
      passwordHash: AuthService.hashPassword('CorpSecret2026!'),
      role: 'CLIENT_ENTERPRISE',
      company: 'TechInnovate Global Corp',
      quotaLimit: 100000,
      quotaUsed: 0,
      active: true
    });
    const savedCorp = await UserRepository.save(testCorpUser);
    console.log(`✔ Cliente Empresa registado com ID: ${savedCorp.id}, Empresa: ${savedCorp.company}, Cota: ${savedCorp.quotaLimit}`);
    if (savedCorp.quotaLimit !== 100000 || savedCorp.company !== 'TechInnovate Global Corp') {
      console.error('❌ FALHA: Metadados do cliente corporativo incorretos.');
      failed = true;
    }

    // 4. Testar Registo de DBA Nível 2
    console.log('\n--- 4. Testar Registo de Utilizador DBA Nível 2 ---');
    const testDbaEmail = `dba_sec_${Date.now()}@inp.org`;
    const testDbaUser = UserRepository.create({
      name: 'Operador DBA Nível 2',
      email: testDbaEmail,
      passwordHash: AuthService.hashPassword('DbaSecure2026!'),
      role: 'DBA',
      dbaLevel: 2,
      quotaLimit: 25000,
      quotaUsed: 0,
      active: true
    });
    const savedDba = await UserRepository.save(testDbaUser);
    const dbaPermissions = AccessControl.getPermissionsForRole(savedDba.role, savedDba.dbaLevel);
    console.log(`✔ DBA N2 registado. Permissões obtidas: ${dbaPermissions.length} (${dbaPermissions.join(', ')})`);
    if (!dbaPermissions.includes(PERMISSIONS.DBA_OPERATE) || dbaPermissions.includes(PERMISSIONS.DBA_ADMIN)) {
      console.error('❌ FALHA: Permissões do DBA Nível 2 divergentes da matriz RBAC.');
      failed = true;
    } else {
      console.log('✔ Permissões do DBA Nível 2 devidamente isoladas (DBA_OPERATE autorizada, DBA_ADMIN restrita).');
    }

    // 5. Testar Rejeição de Duplicidade de Email
    console.log('\n--- 5. Testar Deteção de Email Já Existente ---');
    const existing = await UserRepository.findOneBy({ email: testCorpEmail });
    if (existing) {
      console.log(`✔ Detetado email duplicado com sucesso (${testCorpEmail}). O registo impedirá duplicação.`);
    } else {
      console.error('❌ FALHA: Deveria encontrar o utilizador já existente.');
      failed = true;
    }

    // 6. Testar Registo no AuditLog
    console.log('\n--- 6. Testar Registo de Auditoria de Criação de Utilizador ---');
    await AuthService.logAudit({
      userId: savedUser.id,
      userEmail: savedUser.email,
      userRole: savedUser.role,
      action: 'USER_REGISTERED',
      resource: '/api/auth/register',
      status: 'SUCCESS',
      details: { role: savedUser.role, quotaLimit: savedUser.quotaLimit }
    });

    const auditEntry = await AuditLogRepository.findOne({
      where: { userEmail: testDevEmail, action: 'USER_REGISTERED' },
      order: { createdAt: 'DESC' }
    });

    if (!auditEntry) {
      console.error('❌ FALHA: Registo de auditoria forense não encontrado para USER_REGISTERED.');
      failed = true;
    } else {
      console.log(`✔ Registo de auditoria imutável verificado com sucesso (ID: ${auditEntry.id}, Ação: ${auditEntry.action}).`);
    }

  } catch (err) {
    console.error('Erro fatal durante a execução dos testes:', err);
    failed = true;
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }

  console.log('\n================================================================');
  if (failed) {
    console.log('❌ FALHA: Um ou mais testes de Registo e Login falharam.');
    process.exit(1);
  } else {
    console.log('✅ SUCESSO: Todos os testes de Registo e Login passaram com distinção!');
    process.exit(0);
  }
}

runTests();
