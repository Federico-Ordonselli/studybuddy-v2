/**
 * Moduli registrati: un dominio con `module` mostra il link al modulo, e la quick capture
 * sulle sue route va a quel dominio. Il modulo non dipende dallo slug del dominio.
 */
export interface ModuleInfo { title: string; href: string }

export const MODULES: Record<string, ModuleInfo> = {
  sf6: { title: "Street Fighter 6", href: "/sf6" },
};
