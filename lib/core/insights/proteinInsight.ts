/**
 * Honest, supportive "what your protein means" copy — part of the meaning-rules
 * library alongside `stepInsight` (Ideas §3: every screen should answer "so
 * what?").
 *
 * Framing rules (ED safeguard, Roadmap §5): protein is a habit to *grow*, never
 * a limit to police. We talk about satiety and keeping muscle while losing
 * weight — never calories, never "too much". One short, non-judgmental sentence.
 *
 * Returns Russian directly, matching `stepInsight` (the project is ru-first; the
 * insights library shares this convention).
 */

export type ProteinBand = 'unset' | 'none' | 'low' | 'building' | 'met';

/// Classifies today's protein against the personal target. A target of 0 means
/// "not set" (a fresh profile) — we still say something useful, just generic.
export function proteinBand(proteinG: number, targetG: number): ProteinBand {
  if (targetG <= 0) return 'unset';
  if (proteinG <= 0) return 'none';
  const ratio = proteinG / targetG;
  if (ratio < 0.5) return 'low';
  if (ratio < 1) return 'building';
  return 'met';
}

/// One honest sentence about what today's protein does for the body, framed
/// against the personal `targetG` (a habit to grow, never a cap).
export function proteinInsight(proteinG: number, targetG: number): string {
  switch (proteinBand(proteinG, targetG)) {
    case 'unset':
      return 'Белок дольше держит сытость и бережёт мышцы. Задайте личную цель — так будет понятнее, к чему идти.';
    case 'none':
      return 'Белка пока нет. Он дольше держит сытость и помогает сохранять мышцы — добавьте источник белка к следующему приёму.';
    case 'low':
      return 'Белка пока немного. Он помогает реже испытывать голод и беречь мышцы при снижении веса.';
    case 'building':
      return 'Хороший задел по белку. Достаточный белок держит сытость и поддерживает мышцы.';
    case 'met':
      return 'Цель по белку на сегодня закрыта — это поддержка сытости и мышц. Хорошая привычка.';
  }
}
