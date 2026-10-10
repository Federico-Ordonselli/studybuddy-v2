// Roster Street Fighter 6.
// Base game + Year 1 (Rashid, A.K.I., Ed, Akuma) + Year 2 (M. Bison, Terry, Elena, Mai).
// Modificabile: aggiungi qui i personaggi Year 3+ man mano che escono.

export type Sf6Archetype =
  | "Shoto"
  | "Charge"
  | "Grappler"
  | "Rushdown"
  | "Zoner"
  | "Setplay"
  | "Footsies"
  | "Mixup"
  | "Stance"
  | "Trickster";

export type Sf6Character = {
  slug: string;
  name: string;
  archetype: Sf6Archetype;
  /** 1 = easy, 5 = execution heavy */
  difficulty: 1 | 2 | 3 | 4 | 5;
  tagline: string;
  /** Year 0 = base game, Y1, Y2, Y3 */
  year: 0 | 1 | 2 | 3;
};

export const SF6_ROSTER: Sf6Character[] = [
  // --- Base game ---
  { slug: "ryu",     name: "Ryu",        archetype: "Shoto",     difficulty: 2, year: 0, tagline: "Il fondamento. Fireball, DP, footsies." },
  { slug: "ken",     name: "Ken",        archetype: "Rushdown",  difficulty: 3, year: 0, tagline: "Shoto offensivo con run e mixup." },
  { slug: "luke",    name: "Luke",       archetype: "Shoto",     difficulty: 2, year: 0, tagline: "Damage feroce, neutral solido." },
  { slug: "jamie",   name: "Jamie",      archetype: "Stance",    difficulty: 4, year: 0, tagline: "Drunken Master, scaling con i drink." },
  { slug: "chun-li", name: "Chun-Li",    archetype: "Footsies",  difficulty: 3, year: 0, tagline: "Normals lunghi, stance Serenity." },
  { slug: "guile",   name: "Guile",      archetype: "Charge",    difficulty: 3, year: 0, tagline: "Sonic Boom, defense superlativa." },
  { slug: "cammy",   name: "Cammy",      archetype: "Rushdown",  difficulty: 3, year: 0, tagline: "Pressure forte e dive kick mixup." },
  { slug: "juri",    name: "Juri",       archetype: "Trickster", difficulty: 4, year: 0, tagline: "Fuhajin charges e setplay." },
  { slug: "kimberly",name: "Kimberly",   archetype: "Rushdown",  difficulty: 4, year: 0, tagline: "Spray run, vortice di mixup." },
  { slug: "lily",    name: "Lily",       archetype: "Rushdown",  difficulty: 3, year: 0, tagline: "Wind charges per command grab." },
  { slug: "jp",      name: "JP",         archetype: "Zoner",     difficulty: 4, year: 0, tagline: "Zoning multistrato, Amnesia." },
  { slug: "deejay",  name: "Dee Jay",    archetype: "Footsies",  difficulty: 3, year: 0, tagline: "Pokes, fireball, swag." },
  { slug: "manon",   name: "Manon",      archetype: "Grappler",  difficulty: 3, year: 0, tagline: "Command grab a stack, damage scaling." },
  { slug: "marisa",  name: "Marisa",     archetype: "Footsies",  difficulty: 2, year: 0, tagline: "Damage stratosferico, armor." },
  { slug: "zangief", name: "Zangief",    archetype: "Grappler",  difficulty: 3, year: 0, tagline: "SPD, lariat, walk forward." },
  { slug: "dhalsim", name: "Dhalsim",    archetype: "Zoner",     difficulty: 5, year: 0, tagline: "Teleport, limbs, fireball." },
  { slug: "honda",   name: "E. Honda",   archetype: "Charge",    difficulty: 2, year: 0, tagline: "Headbutt, butt slam, super armor." },
  { slug: "blanka",  name: "Blanka",     archetype: "Trickster", difficulty: 3, year: 0, tagline: "Rolling, Blanka-chan doll setplay." },

  // --- Year 1 ---
  { slug: "rashid",  name: "Rashid",     archetype: "Mixup",     difficulty: 4, year: 1, tagline: "Eagle Spike, ysaar setplay." },
  { slug: "aki",     name: "A.K.I.",     archetype: "Zoner",     difficulty: 4, year: 1, tagline: "Veleno, snake-stance, slithering." },
  { slug: "ed",      name: "Ed",         archetype: "Rushdown",  difficulty: 3, year: 1, tagline: "Boxe Psycho Power, niente motions." },
  { slug: "akuma",   name: "Akuma",      archetype: "Shoto",     difficulty: 4, year: 1, tagline: "Glass cannon. Damage massimo, vita minima." },

  // --- Year 2 ---
  { slug: "bison",   name: "M. Bison",   archetype: "Charge",    difficulty: 3, year: 2, tagline: "Psycho Crusher, scissor pressure." },
  { slug: "terry",   name: "Terry",      archetype: "Shoto",     difficulty: 3, year: 2, tagline: "Power Wave, Burning Knuckle, Buster Wolf." },
  { slug: "elena",   name: "Elena",      archetype: "Trickster", difficulty: 4, year: 2, tagline: "Capoeira, stance switch, healing." },
  { slug: "mai",     name: "Mai",        archetype: "Setplay",   difficulty: 3, year: 2, tagline: "Kachosen, hover, ukihane." },
];

export function getSf6Character(slug: string): Sf6Character | undefined {
  return SF6_ROSTER.find((c) => c.slug === slug);
}

export const SF6_ARCHETYPE_COLORS: Record<Sf6Archetype, string> = {
  Shoto:     "var(--sf6-shoto)",
  Charge:    "var(--sf6-charge)",
  Grappler:  "var(--sf6-grappler)",
  Rushdown:  "var(--sf6-rushdown)",
  Zoner:     "var(--sf6-zoner)",
  Setplay:   "var(--sf6-setplay)",
  Footsies:  "var(--sf6-footsies)",
  Mixup:     "var(--sf6-mixup)",
  Stance:    "var(--sf6-stance)",
  Trickster: "var(--sf6-trickster)",
};
