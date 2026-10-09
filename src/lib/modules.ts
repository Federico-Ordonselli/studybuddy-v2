/**
 * Moduli registrati: un dominio con `module` mostra il link al modulo. Il modulo non
 * dipende dallo slug del dominio. Vuoto finché non arriva il primo (sf6, fase F5).
 */
export interface ModuleInfo { title: string; href: string }

export const MODULES: Record<string, ModuleInfo> = {};
