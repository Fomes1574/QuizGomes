import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/button.js';
import { useAuth } from '../features/auth-context.js';
import { apiRequest } from '../lib/api.js';
import type { Category, ThemeSummary } from '../lib/models.js';

export function CreatePage() {
  const { firebaseUser, getToken, profile, signIn } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    void apiRequest<{ categories: Category[] }>('/api/categories')
      .then((result) => {
        setCategories(result.categories);
        setCategoryId((current) => current || result.categories[0]?.id || '');
      })
      .catch(() => setMessage({ kind: 'error', text: 'Não foi possível carregar as categorias.' }));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const token = await getToken();
      if (token === null || profile === null) throw new Error('Entre e conclua seu perfil para enviar um tema.');
      const result = await apiRequest<{ theme: ThemeSummary }>('/api/themes', {
        body: { categoryId, description, name }, method: 'POST', token,
      });
      setMessage({ kind: 'success', text: `“${result.theme.name}” foi enviado para revisão.` });
      setName('');
      setDescription('');
    } catch (submitError) {
      setMessage({ kind: 'error', text: submitError instanceof Error ? submitError.message : 'Não foi possível enviar o tema.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page page--narrow">
      <div className="page-heading"><div><span className="eyebrow">Contribua</span><h1>Criar tema</h1><p>Proponha um novo assunto. A publicação acontece somente após revisão.</p></div></div>
      {firebaseUser === null ? (
        <div className="auth-card">
          <span className="auth-card__symbol">+</span>
          <h2>Entre para criar</h2>
          <p>Seu perfil identifica a autoria e, após aprovação, torna você owner do tema.</p>
          <Button onClick={() => void signIn()}>Continuar com Google</Button>
        </div>
      ) : (
        <form className="form-card" onSubmit={(event) => void submit(event)}>
          <label className="field"><span>Categoria</span><select onChange={(event) => setCategoryId(event.target.value)} required value={categoryId}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="field"><span>Nome do tema</span><input maxLength={60} minLength={2} onChange={(event) => setName(event.target.value)} placeholder="Ex.: The Last of Us" required value={name} /></label>
          <label className="field"><span>Descrição curta</span><textarea maxLength={240} minLength={12} onChange={(event) => setDescription(event.target.value)} placeholder="Diga em poucas palavras o que este tema reúne." required rows={4} value={description} /><small>{description.length}/240</small></label>
          <aside className="review-note"><strong>Antes de aparecer para todos</strong><p>A administração verifica nome, categoria e escopo. Perguntas são enviadas em uma etapa separada depois da aprovação.</p></aside>
          {message && <p className={`form-message form-message--${message.kind}`} role="status">{message.text}</p>}
          <Button disabled={saving || profile === null} type="submit">{saving ? 'Enviando…' : 'Enviar para revisão'}</Button>
        </form>
      )}
    </section>
  );
}
