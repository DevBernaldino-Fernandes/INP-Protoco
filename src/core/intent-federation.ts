/**
 * @fileoverview Federação de Portais e Delegação Criptográfica entre Nós (Intent Federation)
 * @module Core/IntentFederation
 * @description
 * Permite a comunicação e delegação segura de sub-intenções e tarefas entre múltiplos nós
 * ou gateways distribuídos no ecossistema INP. Cada nó gera um par de chaves assimétricas
 * de curva elíptica (`secp256k1`) no arranque, assinando digitalmente pedidos e respostas
 * (ECDSA com SHA-256) para garantir autenticidade mútua, não-repúdio e integridade.
 *
 * @security Valida os endpoints dos nós parceiros via NetworkSecurity contra ataques SSRF.
 * Sanitiza rigorosamente verbos e alvos para evitar injeção de DSL maliciosa.
 * Exige a verificação da assinatura criptográfica da resposta antes de aceitar dados do par.
 * @audit Permite rastrear formalmente o caminho de delegação inter-nós através de assinaturas digitais verificáveis.
 */

import crypto from 'crypto';
import axios from 'axios';
import { ServiceMatch } from './types';
import { NetworkSecurity } from './network-security';

/**
 * @description Estrutura descritiva de um portal ou nó parceiro federado.
 */
export interface PeerGateway {
  /** Identificador único do portal parceiro */
  id: string;
  /** Nome semântico ou institucional do gateway */
  name: string;
  /** URL de extremidade HTTP/HTTPS do portal */
  endpoint: string;
  /** Chave pública em formato PEM para verificação de assinaturas digitais */
  publicKey: string;
}

/**
 * @description Gestor centralizado de federação entre nós do protocolo INP (Padrão Singleton).
 */
export class IntentFederation {
  private static instance: IntentFederation;
  /** Mapa de portais parceiros conhecidos e registados */
  private peers = new Map<string, PeerGateway>();
  
  /** Chave pública em formato PEM deste portal para partilha com a rede */
  public publicKey: string;
  /** Chave privada para assinatura digital de pedidos e respostas */
  private privateKey: string;

  /**
   * Construtor privado: inicializa o par de chaves assimétricas da curva elíptica secp256k1.
   */
  private constructor() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'secp256k1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }

  /**
   * @description Obtém a instância única partilhada do IntentFederation.
   * @returns {IntentFederation} Instância do gestor de federação.
   */
  public static getInstance(): IntentFederation {
    if (!IntentFederation.instance) {
      IntentFederation.instance = new IntentFederation();
    }
    return IntentFederation.instance;
  }

  /**
   * @description Regista um novo portal parceiro no catálogo de nós federados.
   *
   * @param {PeerGateway} peer - Dados e credenciais públicas do portal parceiro.
   * @throws {Error} Caso o ponto de extremidade viole as regras de segurança de rede (SSRF).
   * @security Valida o URL do nó via NetworkSecurity para evitar direcionamentos internos abusivos.
   * @audit Regista a adesão de um novo par de confiança na topologia do protocolo.
   */
  public registerPeer(peer: PeerGateway): void {
    if (peer.endpoint) {
      NetworkSecurity.validateEndpoint(peer.endpoint);
    }
    this.peers.set(peer.id, peer);
    console.log(`[Federação] Portal parceiro registado: "${peer.name}" em ${peer.endpoint}`);
  }

  /**
   * @description Devolve a lista de todos os portais parceiros federados.
   * @returns {PeerGateway[]} Lista de gateways registados.
   */
  public getPeers(): PeerGateway[] {
    return Array.from(this.peers.values());
  }

  /**
   * @description Delega a execução de uma capacidade atómica num portal parceiro remoto via rede.
   * Compõe uma sub-intenção DSL e valida a resposta e a assinatura criptográfica do parceiro.
   *
   * @param {string} peerId - Identificador do nó parceiro para o qual delegar.
   * @param {string} verb - Verbo semântico da ação (ex.: "PROCESS").
   * @param {string} target - Alvo da ação (ex.: "PAYMENT").
   * @param {any} context - Contexto e parâmetros a fornecer ao nó parceiro.
   * @returns {Promise<any>} A saída final produzida e assinada pelo portal remoto.
   * @throws {Error} Se os parâmetros contiverem carateres ilegais, o nó não existir ou a assinatura falhar.
   * @security Proteção contra injeção DSL via regex e validação criptográfica de integridade e autoria da resposta.
   * @audit Garante rastreabilidade ponta-a-ponta entre domínios administrativos distintos.
   */
  public async delegateExecution(
    peerId: string,
    verb: string,
    target: string,
    context: any
  ): Promise<any> {
    // MEDIDA DE SEGURANÇA: Sanitização estrita para prevenir injeções sintáticas na DSL
    if (!/^[A-Z0-9_-]+$/i.test(verb.trim()) || !/^[A-Z0-9_\s-]+$/i.test(target.trim())) {
      throw new Error(`Erro de Segurança na Federação: Carateres não autorizados detetados no verbo "${verb}" ou alvo "${target}".`);
    }

    const peer = this.peers.get(peerId);
    if (!peer) {
      throw new Error(`Erro de Federação: O portal parceiro "${peerId}" não se encontra registado.`);
    }

    console.log(`[Federação] A delegar a ação "${verb} ${target}" no portal "${peer.name}" (${peer.endpoint})`);

    // Geração da sub-intenção em formato declarativo DSL do INP
    const text = `
INTENT "delegated_flow" {
  CONTEXT ${JSON.stringify(context)}
  REQUIRE { ${verb} ${target} }
  FLOW { SEQUENCE { ${verb} ${target} } }
  OUTPUT { FORMAT "json" }
}
    `.trim();

    try {
      const response = await axios.post(`${peer.endpoint}/api/peers/execute`, {
        text,
        requesterPublicKey: this.publicKey
      }, { timeout: 10000 });

      const { success, result, signature } = response.data;
      if (!success) {
        throw new Error(`Erro de Federação: A execução no nó parceiro falhou. Detalhes: ${response.data.error}`);
      }

      // Verificação da assinatura digital emitida pelo nó parceiro
      const isSignatureValid = this.verifySignature(result, signature, peer.publicKey);
      if (!isSignatureValid) {
        throw new Error(`Erro de Segurança na Federação: A validação da assinatura digital falhou para a resposta do parceiro "${peer.name}".`);
      }

      console.log(`[Federação] Execução validada criptograficamente a partir do parceiro "${peer.name}".`);
      return result.finalOutput;

    } catch (err: any) {
      console.error(`[Federação] Falha na delegação transacional ao parceiro:`, err.message);
      throw err;
    }
  }

  /**
   * @description Assina digitalmente uma carga útil com a chave privada secp256k1 deste portal.
   *
   * @param {any} payload - Dados a serem assinados.
   * @returns {string} Assinatura digital codificada em Base64.
   * @security Garante o não-repúdio dos dados enviados para outros nós da rede.
   */
  public signPayload(payload: any): string {
    const data = JSON.stringify(payload);
    const sign = crypto.createSign('SHA256');
    sign.update(data);
    return sign.sign(this.privateKey, 'base64');
  }

  /**
   * @description Valida uma assinatura digital face a uma carga útil e à chave pública do remetente.
   *
   * @param {any} payload - Carga útil original verificada.
   * @param {string} signature - Assinatura digital em Base64.
   * @param {string} peerPublicKey - Chave pública PEM do parceiro remetente.
   * @returns {boolean} Verdadeiro se a assinatura for matematicamente autêntica; falso caso contrário.
   */
  public verifySignature(payload: any, signature: string, peerPublicKey: string): boolean {
    try {
      const data = JSON.stringify(payload);
      const verify = crypto.createVerify('SHA256');
      verify.update(data);
      return verify.verify(peerPublicKey, signature, 'base64');
    } catch {
      return false;
    }
  }
}
