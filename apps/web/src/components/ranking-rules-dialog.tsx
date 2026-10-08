import { TIERS, rankedKnowledgeValues } from '@quiz-gomes/domain';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './button.js';
import { RankEmblem } from './rank-emblem.js';
import { rankTierClass } from './rank-badge.js';

/**
 * "Como funciona o ranking": tudo que mexe (ou não mexe) no Conhecimento de
 * um tema, com os valores reais de cada liga. Os números vêm do domínio, então
 * nunca ficam diferentes do que o servidor aplica.
 */
export function RankingRulesDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      if (!dialog.open && typeof dialog.showModal === 'function') dialog.showModal();
      else if (!dialog.open) dialog.setAttribute('open', '');
    } catch {
      dialog.setAttribute('open', '');
    }
    dialog.querySelector<HTMLElement>('[data-close-rules]')?.focus();
    return () => {
      try {
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      } catch {
        dialog.removeAttribute('open');
      }
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  return createPortal(
    <dialog
      aria-labelledby="ranking-rules-title"
      aria-modal="true"
      className="dialog-backdrop"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      ref={dialogRef}
    >
      <section className="dialog ranking-rules">
        <h1 id="ranking-rules-title">Como funciona o ranking</h1>
        <p>Cada tema tem o seu ranking. Quem manja de Naruto pode ser Bronze em Geografia, e tudo bem.</p>
        <ul className="ranking-rules__facts">
          <li><strong>Só a Rankeada conta.</strong> A Normal e os desafios entre amigos nunca mexem no seu Conhecimento.</li>
          <li><strong>Vitória sobe, derrota desce.</strong> Quanto mais alto você está, menos ganha e mais perde por partida.</li>
          <li><strong>Empate não muda nada.</strong> Não existe desempate.</li>
          <li><strong>Sair no meio conta como derrota.</strong> Se a partida for anulada por falha da sala, ninguém perde nada.</li>
          <li><strong>A fila procura alguém da sua divisão.</strong> Se demorar, ela vai abrindo para divisões vizinhas.</li>
        </ul>
        <table className="ranking-rules__table">
          <caption>Conhecimento por partida em cada liga</caption>
          <thead><tr><th scope="col">Liga</th><th scope="col">Vitória</th><th scope="col">Derrota</th></tr></thead>
          <tbody>
            {TIERS.map((tier) => {
              const values = rankedKnowledgeValues(tier);
              return (
                <tr className={`rank-badge--${rankTierClass(tier)}`} key={tier}>
                  <th scope="row"><span className="ranking-rules__emblem"><RankEmblem tier={tier} /></span>{tier}</th>
                  <td>+{values.win}</td>
                  <td>−{values.loss}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="ranking-rules__foot">Cada liga tem cinco divisões, de V até I. Desafiante é o topo.</p>
        <div className="dialog__actions">
          <Button data-close-rules onClick={onClose}>Entendi</Button>
        </div>
      </section>
    </dialog>,
    document.body,
  );
}
