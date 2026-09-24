/**
 * Chave de conteúdo de uma pergunta: mesmo hash para o mesmo tema+enunciado
 * +alternativas, normalizado e minúsculo, para detectar duplicata tanto no
 * import em lote quanto na criação/edição individual. Dificuldade não entra
 * mais no hash: o pool é único por tema desde 2026-09-24.
 */
export interface QuestionContentKey {
  options: readonly [string, string, string, string];
  prompt: string;
  /** Só revisões de uma ACTIVE recebem este escopo; criações/importações
   * continuam detectando a mesma pergunta como duplicata. */
  revisionOf?: string;
  themeId: string;
}

/** Pool único por tema (id determinístico); ver migration `0007_unify_question_pools.sql`. */
export function questionPoolId(themeId: string): string {
  return `${themeId}:pool`;
}

export async function questionContentHash(question: QuestionContentKey): Promise<string> {
  const normalized = JSON.stringify({
    options: question.options.map((option) => option.normalize('NFKC').trim().toLocaleLowerCase('pt-BR')),
    prompt: question.prompt.normalize('NFKC').trim().toLocaleLowerCase('pt-BR'),
    ...(question.revisionOf === undefined ? {} : { revisionOf: question.revisionOf }),
    themeId: question.themeId,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
