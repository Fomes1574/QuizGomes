// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as QuestionImageProcessing from '../lib/question-image-processing.js';
import { AdminCategoriesPanel, AdminQuestionEditorialPanel, AdminThemeModerationPanel } from '../pages/admin-editorial-panels.js';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), apiUpload: vi.fn(), getToken: vi.fn(() => Promise.resolve('synthetic-auth')) }));
vi.mock('../lib/api.js', () => ({
  ClientApiError: class ClientApiError extends Error {},
  apiRequest: mocks.apiRequest,
  apiUpload: mocks.apiUpload,
}));
// jsdom não tem canvas: a compressão vira um WebP sintético.
vi.mock('../lib/question-image-processing.js', async (importOriginal) => ({
  ...await importOriginal<typeof QuestionImageProcessing>(),
  processQuestionImage: vi.fn(() => Promise.resolve({ blob: new Blob(['webp-sintetico'], { type: 'image/webp' }), height: 300, width: 400 })),
}));

describe('AdminCategoriesPanel', () => {
  beforeEach(() => { mocks.apiRequest.mockReset(); });
  afterEach(cleanup);

  it('lista categorias existentes e cria uma nova', async () => {
    const onCatalogChanged = vi.fn();
    mocks.apiRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/admin/categories' && (options?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ categories: [{ id: 'cat-1', name: 'Esportes', revision: 1, slug: 'esportes', sortOrder: 0, status: 'ACTIVE' }] });
      }
      if (path === '/api/admin/categories' && options?.method === 'POST') {
        return Promise.resolve({ category: { id: 'cat-2', name: 'Ciência', revision: 1, slug: 'ciencia', sortOrder: 1, status: 'ACTIVE' } });
      }
      return Promise.resolve({ ok: true });
    });
    render(<AdminCategoriesPanel getToken={mocks.getToken} onCatalogChanged={onCatalogChanged} />);
    expect(await screen.findByDisplayValue('Esportes')).toBeInTheDocument();

    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Ciência' } });
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'ciencia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar categoria' }));

    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/admin/categories', expect.objectContaining({
      body: { name: 'Ciência', slug: 'ciencia', sortOrder: 0 }, method: 'POST',
    })));
    expect(await screen.findByDisplayValue('Ciência')).toBeInTheDocument();
    expect(onCatalogChanged).toHaveBeenCalledTimes(1);
  });
});

describe('AdminThemeModerationPanel', () => {
  beforeEach(() => { mocks.apiRequest.mockReset(); });
  afterEach(cleanup);

  const pendingTheme = {
    activeQuestionCount: 0, artwork: { kind: 'NONE' as const, version: 0 }, categoryId: 'cat-1', categoryName: 'Jogos',
    createdByUserId: 'user-1', coverImageKey: null, description: 'Um tema proposto.', id: 'theme-1', name: 'Tema Proposto',
    origin: 'USER' as const, rejectionNote: null, revision: 1, slug: 'tema-proposto', status: 'PENDING' as const,
  };

  it('mostra temas pendentes e aprova com a revisão esperada', async () => {
    const onCatalogChanged = vi.fn();
    mocks.apiRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/admin/themes' && (options?.method ?? 'GET') === 'GET') return Promise.resolve({ themes: [pendingTheme] });
      if (path === '/api/admin/themes/theme-1/approve') return Promise.resolve({ theme: { ...pendingTheme, revision: 2, status: 'ACTIVE' } });
      return Promise.resolve({ ok: true });
    });
    render(<AdminThemeModerationPanel getToken={mocks.getToken} onCatalogChanged={onCatalogChanged} />);
    expect(await screen.findByText('Tema Proposto')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/admin/themes/theme-1/approve', expect.objectContaining({
      body: { expectedRevision: 1 }, method: 'POST',
    })));
    expect(onCatalogChanged).toHaveBeenCalledTimes(1);
  });
});

/** Abre o seletor de tema, filtra pelo nome e escolhe a opção. */
async function chooseTheme(name: string) {
  const input = await screen.findByRole('combobox', { name: 'Tema' });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(await screen.findByRole('option', { name }));
}

describe('Ocultar e mover no catálogo', () => {
  beforeEach(() => { mocks.apiRequest.mockReset(); });
  afterEach(cleanup);

  const activeTheme = {
    activeQuestionCount: 9, artwork: { kind: 'NONE' as const, version: 0 }, categoryId: 'cat-1', categoryName: 'Jogos',
    createdByUserId: null, coverImageKey: null, description: 'Um tema ativo.', id: 'theme-9', name: 'Tema Ativo',
    origin: 'OFFICIAL' as const, rejectionNote: null, revision: 4, slug: 'tema-ativo', status: 'ACTIVE' as const,
  };
  const categories = [
    { id: 'cat-1', name: 'Jogos', revision: 1, slug: 'jogos', sortOrder: 0, status: 'ACTIVE' },
    { id: 'cat-2', name: 'Escola', revision: 1, slug: 'escola', sortOrder: 1, status: 'ACTIVE' },
  ];

  it('oculta tema com confirmação e mostra de novo pela aba Ocultos', async () => {
    let hidden = false;
    mocks.apiRequest.mockImplementation((path: string, options?: { body?: { hidden?: boolean }; method?: string }) => {
      if (path === '/api/admin/themes') return Promise.resolve({ themes: hidden ? [] : [activeTheme] });
      if (path === '/api/admin/themes?hidden=1') return Promise.resolve({ themes: hidden ? [{ ...activeTheme, hidden: true }] : [] });
      if (path === '/api/admin/categories') return Promise.resolve({ categories });
      if (path === '/api/admin/categories?hidden=1') return Promise.resolve({ categories: [] });
      if (path === '/api/admin/themes/theme-9/visibility' && options?.method === 'POST') {
        hidden = options.body?.hidden === true;
        return Promise.resolve({ theme: activeTheme });
      }
      return Promise.resolve({ ok: true });
    });
    render(<AdminThemeModerationPanel getToken={mocks.getToken} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Ativo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ocultar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ocultar tema' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/admin/themes/theme-9/visibility', expect.objectContaining({
      body: { hidden: true }, method: 'POST',
    })));
    await waitFor(() => expect(screen.queryByText('Tema Ativo')).not.toBeInTheDocument());

    fireEvent.click(await screen.findByRole('tab', { name: 'Ocultos (1)' }));
    expect(await screen.findByText('Tema Ativo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar de novo' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/admin/themes/theme-9/visibility', expect.objectContaining({
      body: { hidden: false }, method: 'POST',
    })));
  });

  it('move o tema para outra categoria com a revisão esperada', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/admin/themes') return Promise.resolve({ themes: [activeTheme] });
      if (path === '/api/admin/themes?hidden=1') return Promise.resolve({ themes: [] });
      if (path === '/api/admin/categories') return Promise.resolve({ categories });
      if (path === '/api/admin/categories?hidden=1') return Promise.resolve({ categories: [] });
      if (path === '/api/admin/themes/theme-9/category') {
        return Promise.resolve({ theme: { ...activeTheme, categoryId: 'cat-2', categoryName: 'Escola', revision: 5 } });
      }
      return Promise.resolve({ ok: true });
    });
    render(<AdminThemeModerationPanel getToken={mocks.getToken} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Ativo' }));
    const select = await screen.findByRole('combobox', { name: 'Categoria' });
    expect(screen.getByRole('button', { name: 'Mover' })).toBeDisabled();
    fireEvent.change(select, { target: { value: 'cat-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mover' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/admin/themes/theme-9/category', expect.objectContaining({
      body: { categoryId: 'cat-2', expectedRevision: 4 }, method: 'POST',
    })));
    expect(await screen.findByText('“Tema Ativo” agora está em Escola.')).toBeInTheDocument();
  });

  it('oculta categoria com confirmação e tira da lista', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path === '/api/admin/categories') return Promise.resolve({ categories });
      return Promise.resolve({ ok: true });
    });
    render(<AdminCategoriesPanel getToken={mocks.getToken} />);
    expect(await screen.findByDisplayValue('Escola')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ocultar' })[1]!);
    fireEvent.click(await screen.findByRole('button', { name: 'Ocultar categoria' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/admin/categories/cat-2/visibility', expect.objectContaining({
      body: { hidden: true }, method: 'POST',
    })));
    await waitFor(() => expect(screen.queryByDisplayValue('Escola')).not.toBeInTheDocument());
  });
});

describe('AdminQuestionEditorialPanel', () => {
  beforeEach(() => { mocks.apiRequest.mockReset(); mocks.apiUpload.mockReset(); });
  afterEach(cleanup);

  const theme = {
    activeQuestionCount: 5, artwork: { kind: 'NONE' as const, version: 0 }, categoryId: 'cat-1', categoryName: 'Jogos',
    createdByUserId: null, coverImageKey: null, description: 'x', id: 'theme-1', name: 'Tema Um',
    origin: 'OFFICIAL' as const, rejectionNote: null, revision: 1, slug: 'tema-um', status: 'ACTIVE' as const,
  };
  const question = {
    activeSlot: null, correctOption: 0, createdAt: '2026-01-01T00:00:00.000Z', createdByUserId: 'user-1',
    id: 'question-1', options: ['A', 'B', 'C', 'D'] as const, poolId: 'pool-1', prompt: 'Pergunta em revisão?',
    replacesQuestionId: null, resolutionNote: null, resolvedAt: null, resolvedByUserId: null, sources: [], status: 'IN_REVIEW' as const, themeId: 'theme-1',
  };

  it('busca tema, lista perguntas em revisão e aprova', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/api/admin/themes')) return Promise.resolve({ themes: [theme] });
      if (path.startsWith('/api/editorial/themes/theme-1/questions')) return Promise.resolve({ nextCursor: null, questions: [question] });
      if (path === '/api/editorial/questions/question-1/approve') return Promise.resolve({ ok: true });
      return Promise.resolve({ ok: true });
    });
    render(<AdminQuestionEditorialPanel getToken={mocks.getToken} />);

    await chooseTheme('Tema Um');

    expect(await screen.findByText('Pergunta em revisão?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/editorial/questions/question-1/approve', expect.objectContaining({
      body: {}, method: 'POST',
    })));
  });

  it('seleciona a página revisada e aprova o lote por uma única rota', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/api/admin/themes')) return Promise.resolve({ themes: [theme] });
      if (path.startsWith('/api/editorial/themes/theme-1/questions?')) return Promise.resolve({ nextCursor: null, questions: [question] });
      if (path === '/api/editorial/themes/theme-1/questions/approve') return Promise.resolve({ approvedQuestionIds: ['question-1'], failed: [] });
      return Promise.resolve({ ok: true });
    });
    render(<AdminQuestionEditorialPanel getToken={mocks.getToken} />);

    await chooseTheme('Tema Um');
    await screen.findByText('Pergunta em revisão?');
    fireEvent.click(screen.getByLabelText('Selecionar todas as perguntas desta página'));
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar selecionadas (1)' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Aprovar 1 pergunta' }));

    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/editorial/themes/theme-1/questions/approve', expect.objectContaining({
      body: { questionIds: ['question-1'] }, method: 'POST',
    })));
    expect(await screen.findByText('1 pergunta aprovada.')).toBeInTheDocument();
  });

  it('abre uma pergunta em revisão para correção e salva o mesmo rascunho', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/api/admin/themes')) return Promise.resolve({ themes: [theme] });
      if (path.startsWith('/api/editorial/themes/theme-1/questions?')) return Promise.resolve({ nextCursor: null, questions: [question] });
      if (path === '/api/editorial/questions/question-1') return Promise.resolve({ question: { ...question, prompt: 'Pergunta corrigida?' } });
      return Promise.resolve({ ok: true });
    });
    render(<AdminQuestionEditorialPanel getToken={mocks.getToken} />);

    await chooseTheme('Tema Um');
    await screen.findByText('Pergunta em revisão?');
    fireEvent.click(screen.getByRole('button', { name: 'Revisar e editar' }));
    fireEvent.change(screen.getByLabelText('Enunciado da revisão'), { target: { value: 'Pergunta corrigida?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar revisão' }));

    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/editorial/questions/question-1', expect.objectContaining({
      body: { correctOption: 0, options: ['A', 'B', 'C', 'D'], prompt: 'Pergunta corrigida?', sources: [] }, method: 'PATCH',
    })));
    expect(await screen.findByText('Rascunho atualizado. Revise-o antes de aprovar.')).toBeInTheDocument();
  });

  it('importa CSV para o tema selecionado com chave de idempotência', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/api/admin/themes')) return Promise.resolve({ themes: [theme] });
      if (path.startsWith('/api/editorial/themes/theme-1/questions')) return Promise.resolve({ nextCursor: null, questions: [] });
      return Promise.resolve({ ok: true });
    });
    mocks.apiUpload.mockResolvedValue({ imported: 1, status: 'APPLIED' });
    render(<AdminQuestionEditorialPanel getToken={mocks.getToken} />);

    await chooseTheme('Tema Um');
    await screen.findByText('Importar perguntas');

    const file = new File(['difficulty,prompt,optionA,optionB,optionC,optionD,correctOption\nEASY,Pergunta?,A,B,C,D,0'], 'lote.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Arquivo CSV ou JSON'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Importar para revisão' }));

    await waitFor(() => expect(mocks.apiUpload).toHaveBeenCalledWith(
      '/api/admin/questions/import?themeId=theme-1&duplicates=skip',
      expect.objectContaining({ method: 'POST' }),
    ));
    expect(await screen.findByText('1 pergunta enviada para revisão.')).toBeInTheDocument();
  });

  it('arquivo grande sobe em partes de 100, com chave por parte, e soma puladas', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/api/admin/themes')) return Promise.resolve({ themes: [theme] });
      if (path.startsWith('/api/editorial/themes/theme-1/questions')) return Promise.resolve({ nextCursor: null, questions: [] });
      return Promise.resolve({ ok: true });
    });
    mocks.apiUpload
      .mockResolvedValueOnce({ imported: 98, skipped: 2, status: 'APPLIED' })
      .mockResolvedValueOnce({ imported: 100, skipped: 0, status: 'APPLIED' })
      .mockResolvedValueOnce({ imported: 50, skipped: 0, status: 'APPLIED' });
    render(<AdminQuestionEditorialPanel getToken={mocks.getToken} />);
    await chooseTheme('Tema Um');
    await screen.findByText('Importar perguntas');

    const rows = Array.from({ length: 250 }, (_, index) => `"Pergunta ${index}?",A,B,C,D,0`);
    const file = new File([['prompt,optionA,optionB,optionC,optionD,correctOption', ...rows].join('\n')], 'grande.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Arquivo CSV ou JSON'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Importar para revisão' }));

    expect(await screen.findByText('248 perguntas enviadas para revisão · 2 repetidas puladas.')).toBeInTheDocument();
    expect(mocks.apiUpload).toHaveBeenCalledTimes(3);
    const keys = mocks.apiUpload.mock.calls.map((call) => (call[1] as { headers: Record<string, string> }).headers['Idempotency-Key'] ?? '');
    expect(keys.map((key) => key.split(':')[1])).toEqual(['1', '2', '3']);
    expect(new Set(keys.map((key) => key.split(':')[0])).size).toBe(1);
  });

  it('aprova todas em revisão do tema, página por página, até esvaziar', async () => {
    const pending = Array.from({ length: 60 }, (_, index) => ({ ...question, id: `q-${index}`, prompt: `Pendente ${index}?` }));
    const approveCalls: string[][] = [];
    mocks.apiRequest.mockImplementation((path: string, options?: { body?: { questionIds?: string[] } }) => {
      if (path.startsWith('/api/admin/themes')) return Promise.resolve({ themes: [theme] });
      if (path.endsWith('/questions/approve')) {
        const ids = options?.body?.questionIds ?? [];
        approveCalls.push(ids);
        for (const id of ids) pending.splice(pending.findIndex((item) => item.id === id), 1);
        return Promise.resolve({ approvedQuestionIds: ids, failed: [] });
      }
      if (path.startsWith('/api/editorial/themes/theme-1/questions')) {
        return Promise.resolve({ nextCursor: null, questions: pending.slice(0, 50) });
      }
      return Promise.resolve({ ok: true });
    });
    render(<AdminQuestionEditorialPanel getToken={mocks.getToken} />);
    await chooseTheme('Tema Um');
    await screen.findByText('Pendente 0?');

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar todas em revisão deste tema' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar todas' }));

    expect(await screen.findByText('60 perguntas aprovadas.')).toBeInTheDocument();
    expect(approveCalls.map((ids) => ids.length)).toEqual([50, 10]);
    expect(pending).toHaveLength(0);
  });

  it('fotos só podem ser escolhidas depois do arquivo de perguntas', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/api/admin/themes')) return Promise.resolve({ themes: [theme] });
      return Promise.resolve({ nextCursor: null, questions: [] });
    });
    render(<AdminQuestionEditorialPanel getToken={mocks.getToken} />);
    await chooseTheme('Tema Um');
    await screen.findByText('Importar perguntas');
    expect(screen.getByLabelText('Fotos das perguntas')).toBeDisabled();
    expect(screen.getByText('Escolha primeiro o arquivo de perguntas.')).toBeInTheDocument();
  });

  it('importa CSV com fotos: resumo antes, foto só na pergunta criada pela linha que a cita', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/api/admin/themes')) return Promise.resolve({ themes: [theme] });
      return Promise.resolve({ nextCursor: null, questions: [] });
    });
    mocks.apiUpload.mockImplementation((path: string) => {
      if (path.startsWith('/api/admin/questions/import')) {
        return Promise.resolve({
          imported: 2, rows: [{ acceptsImage: true, questionId: 'q-a' }, { acceptsImage: true, questionId: 'q-b' }], skipped: 0, status: 'APPLIED',
        });
      }
      return Promise.resolve({ question: {} });
    });
    render(<AdminQuestionEditorialPanel getToken={mocks.getToken} />);
    await chooseTheme('Tema Um');
    await screen.findByText('Importar perguntas');

    const csv = new File([[
      'prompt,optionA,optionB,optionC,optionD,correctOption,foto',
      '"Quem é esse pokémon?",Pikachu,Bulbasaur,Charmander,Squirtle,0,pikachu.jpg',
      '"Quem é esse pokémon?",Bulbasaur,Pikachu,Charmander,Squirtle,1,charmander.jpg',
    ].join('\n')], 'pokemon.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Arquivo CSV ou JSON'), { target: { files: [csv] } });
    const photos = [
      new File(['jpeg'], 'Pikachu.jpg', { type: 'image/jpeg' }),
      new File(['jpeg'], 'sobrando.jpg', { type: 'image/jpeg' }),
    ];
    fireEvent.change(screen.getByLabelText('Fotos das perguntas'), { target: { files: photos } });

    expect(await screen.findByText('1 foto pronta')).toBeInTheDocument();
    expect(screen.getByText(/Sem foto escolhida \(entram sem foto\): linha 3 \(charmander\.jpg\)/)).toBeInTheDocument();
    expect(screen.getByText(/Não serão enviadas \(nenhuma linha cita\): sobrando\.jpg/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Importar para revisão' }));
    expect(await screen.findByText('2 perguntas enviadas para revisão · 1 foto anexada.')).toBeInTheDocument();
    const imageCalls = mocks.apiUpload.mock.calls.filter((call) => String(call[0]).endsWith('/image'));
    expect(imageCalls).toHaveLength(1);
    expect(imageCalls[0]?.[0]).toBe('/api/admin/questions/q-a/image');
    expect(imageCalls[0]?.[1]).toMatchObject({ method: 'PUT' });
  });

  it('não prende foto em pergunta repetida ou que já tem foto', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/api/admin/themes')) return Promise.resolve({ themes: [theme] });
      return Promise.resolve({ nextCursor: null, questions: [] });
    });
    mocks.apiUpload.mockResolvedValue({ imported: 0, rows: [{ acceptsImage: false, questionId: 'q-antiga' }], skipped: 1, status: 'APPLIED' });
    render(<AdminQuestionEditorialPanel getToken={mocks.getToken} />);
    await chooseTheme('Tema Um');
    await screen.findByText('Importar perguntas');
    const csv = new File(['prompt,optionA,optionB,optionC,optionD,correctOption,foto\n"P?",A,B,C,D,0,a.jpg'], 'a.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Arquivo CSV ou JSON'), { target: { files: [csv] } });
    fireEvent.change(screen.getByLabelText('Fotos das perguntas'), { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } });
    await screen.findByText('1 foto pronta');
    fireEvent.click(screen.getByRole('button', { name: 'Importar para revisão' }));
    expect(await screen.findByText('1 repetida pulada · 1 foto pulada (pergunta repetida ou que já tinha foto).')).toBeInTheDocument();
    expect(mocks.apiUpload).toHaveBeenCalledTimes(1);
  });

  it('na revisão de uma pergunta em revisão, a foto pode ser trocada no próprio formulário', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/api/admin/themes')) return Promise.resolve({ themes: [theme] });
      return Promise.resolve({ nextCursor: null, questions: [{ ...question, imageUrl: '/api/question-images/questions/x/v1.webp' }] });
    });
    render(<AdminQuestionEditorialPanel getToken={mocks.getToken} />);
    await chooseTheme('Tema Um');
    await screen.findByText('Pergunta em revisão?');
    expect(screen.getAllByRole('button', { name: /Foto da pergunta/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Revisar e editar' }));
    expect(screen.getAllByRole('button', { name: /Foto da pergunta/ })).toHaveLength(2);
  });

  it('criar revisão de pergunta publicada leva a foto nova para o rascunho, nunca para a publicada', async () => {
    const createObjectURL = vi.fn(() => 'blob:sintetico');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const active = { ...question, id: 'question-ativa', imageUrl: '/api/question-images/questions/x/v1.webp', prompt: 'Pergunta publicada?', status: 'ACTIVE' as const };
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/api/admin/themes')) return Promise.resolve({ themes: [theme] });
      if (path === '/api/editorial/questions/question-ativa') return Promise.resolve({ draftId: 'draft-1' });
      return Promise.resolve({ nextCursor: null, questions: [active] });
    });
    mocks.apiUpload.mockResolvedValue({ question: {} });
    render(<AdminQuestionEditorialPanel getToken={mocks.getToken} />);
    await chooseTheme('Tema Um');
    fireEvent.click(await screen.findByRole('tab', { name: 'Ativa' }));
    await screen.findByText('Pergunta publicada?');
    fireEvent.click(screen.getByRole('button', { name: 'Criar revisão' }));
    expect(screen.getByText('A foto atual vai junto para o rascunho.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Foto do rascunho'), { target: { files: [new File(['jpeg'], 'nova.jpg', { type: 'image/jpeg' })] } });
    expect(await screen.findByText('Esta foto entra no rascunho. A publicada só muda quando você aprovar.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar revisão' }));

    expect(await screen.findByText(/Revisão criada\. .*A foto nova vai junto\./)).toBeInTheDocument();
    expect(mocks.apiUpload).toHaveBeenCalledTimes(1);
    expect(mocks.apiUpload).toHaveBeenCalledWith('/api/admin/questions/draft-1/image', expect.objectContaining({ method: 'PUT' }));
  });
});
