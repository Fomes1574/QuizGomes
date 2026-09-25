import { useEffect, useRef, useState } from 'react';
import { prepareStoryCard, shareStoryFile, type StoryCardInput } from '../lib/story-card.js';
import { Button } from './button.js';
import { Icon } from './icons.js';

/**
 * Carta de story do resultado. A imagem é gerada logo depois que o
 * resultado aparece, para o toque em "Compartilhar" abrir o menu do sistema
 * na hora (o Safari exige isso).
 */
export function ShareResultButton({ input }: { input: StoryCardInput }) {
  const fileRef = useRef<Promise<File> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(input);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fileRef.current = prepareStoryCard(JSON.parse(key) as StoryCardInput);
      fileRef.current.catch(() => { fileRef.current = null; });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [key]);

  async function share() {
    setBusy(true);
    setNotice(null);
    try {
      const file = await (fileRef.current ?? prepareStoryCard(input));
      const outcome = await shareStoryFile(file);
      if (outcome === 'downloaded') setNotice('Imagem salva. É só postar no story!');
    } catch {
      setNotice('Não foi possível gerar a imagem neste aparelho.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button disabled={busy} onClick={() => void share()} variant="secondary"><Icon name="share" />{busy ? 'Gerando…' : 'Compartilhar resultado'}</Button>
      {notice !== null && <p className="inline-notice" role="status">{notice}</p>}
    </>
  );
}
