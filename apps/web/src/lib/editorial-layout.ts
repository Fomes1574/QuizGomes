export type TextMeasure = (text: string) => number;

function wrapLineWidths(text: string, maxWidth: number, measure: TextMeasure): number[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [0];
  const lines: number[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current.length > 0) lines.push(measure(current));
    if (measure(word) <= maxWidth) {
      current = word;
      continue;
    }
    let fragment = '';
    for (const character of word) {
      if (fragment.length > 0 && measure(fragment + character) > maxWidth) {
        lines.push(measure(fragment));
        fragment = character;
      } else {
        fragment += character;
      }
    }
    current = fragment;
  }
  if (current.length > 0) lines.push(measure(current));
  return lines;
}

export interface EditorialLayoutResult {
  answerLines: number[];
  flags: Array<'ANSWER_TOO_TALL' | 'PROMPT_TOO_TALL'>;
  promptLines: number;
  publishable: boolean;
}

export function validateEditorialLayout(
  prompt: string,
  options: readonly [string, string, string, string],
  measurePrompt: TextMeasure,
  measureAnswer: TextMeasure,
  viewportWidth = 320,
): EditorialLayoutResult {
  const promptWidth = Math.max(240, viewportWidth - 32);
  const answerWidth = Math.max(112, (viewportWidth - 54) / 2);
  const promptLines = wrapLineWidths(prompt, promptWidth, measurePrompt).length;
  const answerWidths = options.map((option) => wrapLineWidths(option, answerWidth, measureAnswer));
  const answerLines = answerWidths.map((lines) => lines.length);
  const answerTooTall = answerWidths.some((lines) => lines.length > 2 || (lines.length === 2 && (lines[1] ?? 0) > answerWidth * 0.5));
  const flags: EditorialLayoutResult['flags'] = [];
  if (promptLines > 3) flags.push('PROMPT_TOO_TALL');
  if (answerTooTall) flags.push('ANSWER_TOO_TALL');
  return { answerLines, flags, promptLines, publishable: flags.length === 0 };
}
