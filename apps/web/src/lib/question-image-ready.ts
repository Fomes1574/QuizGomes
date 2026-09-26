/**
 * Justiça com foto: o ROUND_READY só sai depois que a foto da pergunta
 * carregou (ou falhou, ou estourou o teto). Assim ninguém começa a rodada
 * olhando uma moldura vazia enquanto o adversário já vê a imagem. O teto
 * mantém a soma apresentação + espera bem abaixo da carência de reconexão da sala (10 s).
 */
export const QUESTION_IMAGE_READY_CAP_MS = 4_000;

const settled = new Map<string, Promise<void>>();

export function waitForQuestionImage(url: string | null | undefined, capMs = QUESTION_IMAGE_READY_CAP_MS): Promise<void> {
  if (url === null || url === undefined || url === '' || typeof Image === 'undefined') return Promise.resolve();
  let loading = settled.get(url);
  if (loading === undefined) {
    loading = new Promise<void>((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.onload = () => {
        // decode() evita o quadro em branco na primeira pintura do <img>.
        if (typeof image.decode === 'function') void image.decode().catch(() => undefined).finally(resolve);
        else resolve();
      };
      image.onerror = () => resolve();
      image.src = url;
    });
    settled.set(url, loading);
    if (settled.size > 32) settled.delete(settled.keys().next().value as string);
  }
  return Promise.race([loading, new Promise<void>((resolve) => { setTimeout(resolve, Math.max(0, capMs)); })]);
}
