import { LibraryError } from './errors';
import type { QuizQuestion } from './tutor/quiz';
export function positiveId(value: unknown, name: string, required = false): number | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new LibraryError(`${name}: serve un intero positivo`);
  return value;
}
export function text(value: unknown, name: string, max = 10000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new LibraryError(`${name}: serve testo non vuoto di massimo ${max} caratteri`);
  return value.trim();
}
export function quizQuestion(value: unknown): QuizQuestion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LibraryError('question non valida');
  const q = value as Record<string,unknown>;
  if (q.type !== 'mcq' && q.type !== 'open') throw new LibraryError('Tipo di domanda non valido');
  const question = text(q.question,'question'), answer = text(q.answer,'answer');
  if (q.rationale !== undefined && typeof q.rationale !== 'string') throw new LibraryError('rationale non valida');
  if (typeof q.rationale === 'string' && q.rationale.length > 10000) throw new LibraryError('rationale troppo lunga');
  let options: string[] | undefined;
  if (q.type === 'mcq') {
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 10) throw new LibraryError('options non valide');
    options = q.options.map(o=>text(o,'opzione'));
    if (!options.some(o=>o.trim().toLowerCase() === answer.toLowerCase())) throw new LibraryError('La risposta deve essere una delle opzioni');
  }
  return {type:q.type,question,answer,rationale:q.rationale as string ?? '',options};
}
