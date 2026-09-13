/**
 * @fileoverview Motor de Correspondência e Resolução Semântica de Serviços (MatchingEngine)
 * @module Core/MatchingEngine
 * @description
 * Associa as exigências declaradas na intenção (`requirements.capabilities`) aos microserviços
 * concretos registados no catálogo (`CapabilityRegistry`). Mapeia cada ação semântica ao nó
 * com a melhor pontuação combinada de confiança, segurança e disponibilidade operacional.
 * Fornece métodos de pré-validação para verificar se uma intenção pode ser integralmente
 * satisfeita antes de comprometer recursos no motor de execução.
 *
 * @security Garante que apenas serviços registados, com identidade confirmada e pontuação
 * de confiança compatível com o limiar mínimo, são elegíveis para vinculação.
 * @audit Permite auditar as decisões algorítmicas de roteamento e seleção de fornecedores de serviços.
 */

import { ParsedIntent, ServiceMatch } from './types';
import { CapabilityRegistry } from './capability-registry';

/**
 * @description Motor responsável pela vinculação inteligente entre contratos de intenção e microserviços executores.
 */
export class MatchingEngine {
  /**
   * @param {CapabilityRegistry} registry - Catálogo central de serviços para consulta e resolução de capacidades.
   */
  constructor(private registry: CapabilityRegistry) {}

  /**
   * @description Determina e associa o melhor fornecedor de serviço disponível para cada capacidade exigida na intenção.
   * Devolve um mapa indexado pelo identificador do requisito (`requisito -> ServiceMatch`).
   *
   * @param {ParsedIntent} intent - A intenção canónica contendo a lista de capacidades requeridas.
   * @returns {Promise<Map<string, ServiceMatch>>} Mapa de correspondências associando cada requisito ao serviço ótimo.
   * @audit Regista avisos operacionais caso algum dos requisitos da intenção não encontre nenhum microserviço apto.
   */
  async matchIntent(intent: ParsedIntent): Promise<Map<string, ServiceMatch>> {
    const matches = new Map<string, ServiceMatch>();
    for (const req of intent.requirements.capabilities) {
      const best = await this.registry.findBestServiceForCapability(req);
      if (best) {
        matches.set(req, best);
      } else {
        console.warn(`[Motor de Correspondência] Nenhum microserviço disponível para o requisito: ${req}`);
      }
    }
    return matches;
  }

  /**
   * @description Inspeciona previamente se todas as capacidades exigidas pela intenção possuem serviços ativos aptos a supri-las.
   * Utilizado como barreira de segurança (*gatekeeper*) antes de dar início à orquestração.
   *
   * @param {ParsedIntent} intent - Intenção a ser testada.
   * @returns {Promise<boolean>} Verdadeiro se todos os requisitos tiverem pelo menos um serviço correspondente; falso caso contrário.
   * @security Previne a execução parcial de intenções que inevitavelmente falhariam por falta de capacidades.
   */
  async canFulfillIntent(intent: ParsedIntent): Promise<boolean> {
    for (const req of intent.requirements.capabilities) {
      const matches = await this.registry.findServicesForCapability(req);
      if (matches.length === 0) return false;
    }
    return true;
  }
}