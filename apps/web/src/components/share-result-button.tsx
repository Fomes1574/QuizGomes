import { useEffect, useId, useRef, useState } from 'react';
import {
  prepareShareCards,
  shareStoryFile,
  type ShareCard,
  type ShareCardFiles,
  type ShareFormat,
  type StoryCardInput,
} from '../lib/story-card.js';
import { Button } from './button.js';
import { Icon } from './icons.js';

/**
 * Compartilhar um cartão (imagem + convite com link). Primeiro a pessoa
 * escolhe onde vai postar: Stories/Status usam o 9:16 com as bordas livres
 * para a interface do app; conversas e feed usam o 4:5, que não vira uma
 * tira fina no chat nem é cortado no feed. Os dois arquivos são gerados
 * logo que a tela aparece, para o toque abrir o menu do sistema na hora (o
 * Safari exige isso).
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
  const filesRef = useRef<Promise<ShareCardFiles> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const key = JSON.stringify(card);
  const choiceId = useId();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      filesRef.current = prepareShareCards(JSON.parse(key) as ShareCard);
      filesRef.current.catch(() => { filesRef.current = null; });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [key]);

  async function share(format: ShareFormat) {
    setBusy(true);
    setNotice(null);
    try {
      const files = await (filesRef.current ?? prepareShareCards(card));
      const outcome = await shareStoryFile(files[format], message);
      if (outcome === 'downloaded') setNotice('Imagem salva. É só postar!');
      if (outcome !== 'cancelled') setChoosing(false);
    } catch {
      setNotice('Não foi possível gerar a imagem neste aparelho.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="share-card">
      <Button aria-controls={choiceId} aria-expanded={choosing} disabled={busy} onClick={() => setChoosing((open) => !open)} variant={variant}>
        <Icon name="share" />{busy ? 'Gerando…' : label}
      </Button>
      {choosing && (
        <div aria-label="Onde você vai compartilhar?" className="share-card__choices" id={choiceId} role="group">
          <button className="share-card__choice" disabled={busy} onClick={() => void share('story')} type="button">
            <span aria-hidden="true" className="share-card__shape share-card__shape--story" />
            <span><strong>Stories e status</strong><small>Instagram, WhatsApp, TikTok</small></span>
          </button>
          <button className="share-card__choice" disabled={busy} onClick={() => void share('post')} type="button">
            <span aria-hidden="true" className="share-card__shape share-card__shape--post" />
            <span><strong>Conversa ou feed</strong><small>WhatsApp, Direct, Telegram</small></span>
          </button>
        </div>
      )}
      {notice !== null && <p className="inline-notice" role="status">{notice}</p>}
    </div>
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
