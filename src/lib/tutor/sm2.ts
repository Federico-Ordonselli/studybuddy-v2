/**
 * SM-2 (SuperMemo 2). quality: 0-5 (0 = dimenticato, 5 = perfetto).
 * Ritorna lo stato aggiornato della carta.
 */
export interface Sm2State {
  ease: number;
  intervalDays: number;
  repetitions: number;
}

export function sm2(prev: Sm2State, quality: number): Sm2State {
  const q = Math.max(0, Math.min(5, quality));
  let { ease, intervalDays, repetitions } = prev;

  if (q < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    repetitions += 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * ease);
  }

  ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ease < 1.3) ease = 1.3;

  return { ease, intervalDays, repetitions };
}

export function nextDue(intervalDays: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + intervalDays);
  return d;
}
