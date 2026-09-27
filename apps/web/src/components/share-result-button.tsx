import { useEffect, useRef, useState } from 'react';
import { prepareShareCard, shareStoryFile, type ShareCard, type StoryCardInput } from '../lib/story-card.js';
import { Button } from './button.js';
import { Icon } from './icons.js';

/**
 * Botão que compartilha um cartão (imagem + convite com link). A imagem é
 * gerada logo depois que a tela aparece, para o toque abrir o menu do
 * sistema na hora (o Safari exige isso).
 */
export function ShareCardButton({
  card,
  label,
  message,
  variant = 'secondary',
}: {
  card: ShareCard;
  label: string;
  message?: { text: string; url?: string } | undefined;
  variant?: 'ghost' | 'primary' | 'secondary';
}) {
  const fileRef = useRef<Promise<File> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(card);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fileRef.current = prepareShareCard(JSON.parse(key) as ShareCard);
      fileRef.current.catch(() => { fileRef.current = null; });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [key]);

  async function share() {
    setBusy(true);
    setNotice(null);
    try {
      const file = await (fileRef.current ?? prepareShareCard(card));
      const outcome = await shareStoryFile(file, message);
      if (outcome === 'downloaded') setNotice('Imagem salva. É só postar!');
    } catch {
      setNotice('Não foi possível gerar a imagem neste aparelho.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button disabled={busy} onClick={() => void share()} variant={variant}><Icon name="share" />{busy ? 'Gerando…' : label}</Button>
      {notice !== null && <p className="inline-notice" role="status">{notice}</p>}
    </>
  );
}

/** Cartão do resultado, com desafio e link para o mesmo tema. */
export function ShareResultButton({ input, url }: { input: StoryCardInput; url?: string | undefined }) {
  const theme = input.themeName === null ? '' : ` em ${input.themeName}`;
  const text = input.result === 'WIN'
    ? `Fiz ${input.viewer.score} × ${input.opponent.score}${theme} no QUIZ GOMES. Duvido você me ganhar:`
    : `Joguei${theme} no QUIZ GOMES (${input.viewer.score} × ${input.opponent.score}). Topa um duelo?`;
  return (
    <ShareCardButton
      card={{ input, kind: 'result' }}
      label="Compartilhar resultado"
      message={{ text, ...(url === undefined ? {} : { url }) }}
    />
  );
}
