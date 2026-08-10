import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return <section className="page"><div className="state-card"><span className="state-card__orb">404</span><h1>Essa pergunta não existe</h1><p>O caminho pode ter mudado ou nunca esteve por aqui.</p><Link className="button button--primary" to="/">Voltar aos temas</Link></div></section>;
}
