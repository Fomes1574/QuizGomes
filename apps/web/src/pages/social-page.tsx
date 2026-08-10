import { EmptyState } from '../components/async-state.js';
import { Icon } from '../components/icons.js';

export function SocialPage() {
  return (
    <section className="page">
      <div className="page-heading">
        <div><span className="eyebrow">Sua roda</span><h1>Social</h1><p>Amigos, desafios e partidas pendentes em um só lugar.</p></div>
      </div>
      <label className="search-field">
        <Icon name="search" />
        <span className="sr-only">Buscar jogador</span>
        <input placeholder="Buscar por nome ou #QG…" type="search" />
      </label>
      <div className="social-summary">
        <article><span className="status-dot status-dot--online" /><strong>0</strong><small>online</small></article>
        <article><span className="status-dot status-dot--pending" /><strong>0</strong><small>pedidos</small></article>
        <article><span className="status-dot" /><strong>0</strong><small>assíncronas</small></article>
      </div>
      <EmptyState description="Quando você adicionar alguém pelo nome ou ID público, essa pessoa aparecerá aqui." title="Sua lista está pronta para crescer" />
    </section>
  );
}
