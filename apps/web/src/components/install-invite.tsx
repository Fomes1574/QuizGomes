import { useState } from 'react';
import { installInviteKind, markInstallInviteSeen, promptInstall } from '../lib/install-prompt.js';
import { Button } from './button.js';

/** Aparece uma única vez, depois de uma vitória, se o app ainda não estiver instalado. */
export function InstallInvite() {
  const [kind] = useState(installInviteKind);
  const [open, setOpen] = useState(kind !== null);
  if (!open || kind === null) return null;
  const close = () => { markInstallInviteSeen(); setOpen(false); };
  return (
    <aside aria-label="Instalar o QUIZ GOMES" className="install-invite">
      <strong>Vitória merece atalho na tela inicial</strong>
      {kind === 'ios' ? (
        <p>No Safari, toque em <b>Compartilhar</b> (o quadrado com a seta ⬆) e depois em <b>Adicionar à Tela de Início</b>. Abre em tela cheia, como um app.</p>
      ) : (
        <p>Instale o QUIZ GOMES: abre em tela cheia, mais rápido, direto da tela inicial.</p>
      )}
      <div className="install-invite__actions">
        {kind === 'prompt' && <Button onClick={() => { void promptInstall().finally(close); }}>Instalar</Button>}
        <Button onClick={close} variant="ghost">{kind === 'ios' ? 'Entendi' : 'Agora não'}</Button>
      </div>
    </aside>
  );
}
