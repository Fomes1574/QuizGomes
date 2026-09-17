// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportQuestionDialog } from '../components/report-question-dialog.js';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  getToken: vi.fn(() => Promise.resolve('synthetic-auth')),
}));

vi.mock('../features/auth-context.js', () => ({
  useAuth: () => ({ getToken: mocks.getToken }),
}));
vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest }));

function dialog(overrides: Partial<Parameters<typeof ReportQuestionDialog>[0]> = {}) {
  return (
    <ReportQuestionDialog
      contextId="match-1"
      contextKind="MATCH"
      onClose={vi.fn()}
      questionId="question-1"
      roundNumber={2}
      {...overrides}
    />
  );
}

describe('diálogo de denúncia de pergunta', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockResolvedValue({ report: { id: 'report-1', status: 'OPEN' } });
  });

  afterEach(cleanup);

  it('exige um motivo antes de habilitar o envio', () => {
    render(dialog());
    expect(screen.getByRole('button', { name: 'Enviar denúncia' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Resposta errada' }));
    expect(screen.getByRole('button', { name: 'Enviar denúncia' })).toBeEnabled();
  });

  it('envia contexto, rodada, motivo e nota — e nunca envia comando à sala', async () => {
    render(dialog());
    fireEvent.click(screen.getByRole('radio', { name: 'Ambígua' }));
    fireEvent.change(screen.getByPlaceholderText('Conte em poucas palavras o que você percebeu.'), {
      target: { value: 'As duas alternativas parecem certas.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }));

    await waitFor(() => { expect(mocks.apiRequest).toHaveBeenCalledTimes(1); });
    expect(mocks.apiRequest).toHaveBeenCalledWith('/api/reports', expect.objectContaining({
      body: {
        contextId: 'match-1', contextKind: 'MATCH', note: 'As duas alternativas parecem certas.',
        questionId: 'question-1', reason: 'AMBIGUOUS', roundNumber: 2,
      },
      method: 'POST',
    }));
    expect(await screen.findByText('Denúncia registrada')).toBeInTheDocument();
  });

  it('nota vazia não é enviada como string em branco', async () => {
    render(dialog());
    fireEvent.click(screen.getByRole('radio', { name: 'Outro motivo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }));

    await waitFor(() => { expect(mocks.apiRequest).toHaveBeenCalledTimes(1); });
    const call = mocks.apiRequest.mock.calls[0] as [string, { body: { note?: string } }] | undefined;
    expect(call?.[1].body.note).toBeUndefined();
  });

  it('mostra o erro do servidor sem fechar o diálogo', async () => {
    mocks.apiRequest.mockRejectedValue(new Error('Muitas denúncias em pouco tempo. Tente de novo em instantes.'));
    render(dialog());
    fireEvent.click(screen.getByRole('radio', { name: 'Desatualizada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Muitas denúncias em pouco tempo.');
    expect(screen.queryByText('Denúncia registrada')).not.toBeInTheDocument();
  });

  it('cancelar fecha sem enviar nada ao servidor', () => {
    const onClose = vi.fn();
    render(dialog({ onClose }));
    fireEvent.click(screen.getByRole('radio', { name: 'Problema na imagem' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  it('a nota tem limite de 280 caracteres', () => {
    render(dialog());
    const textarea = screen.getByPlaceholderText('Conte em poucas palavras o que você percebeu.');
    expect(textarea).toHaveAttribute('maxLength', '280');
  });
});
