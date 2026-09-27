// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareCardButton } from '../components/share-result-button.js';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  share: vi.fn(() => Promise.resolve('shared' as const)),
}));
vi.mock('../lib/story-card.js', () => ({ prepareShareCards: mocks.prepare, shareStoryFile: mocks.share }));

describe('compartilhar com escolha de formato', () => {
  afterEach(() => { cleanup(); mocks.prepare.mockReset(); mocks.share.mockClear(); });

  it('Stories usa o 9:16 e conversa usa o 4:5, com texto e link juntos', async () => {
    const story = new File(['s'], 'story.jpg');
    const post = new File(['p'], 'post.jpg');
    mocks.prepare.mockResolvedValue({ post, story });
    const message = { text: 'Duvido você me ganhar:', url: 'https://quiz.test/temas/naruto' };
    render(<ShareCardButton card={{ input: { name: 'M', publicId: '#QGM' }, kind: 'invite' }} label="Compartilhar" message={message} />);

    fireEvent.click(screen.getByRole('button', { name: 'Compartilhar' }));
    fireEvent.click(screen.getByRole('button', { name: /Stories e status/ }));
    await waitFor(() => expect(mocks.share).toHaveBeenCalledWith(story, message));

    fireEvent.click(screen.getByRole('button', { name: 'Compartilhar' }));
    fireEvent.click(screen.getByRole('button', { name: /Conversa ou feed/ }));
    await waitFor(() => expect(mocks.share).toHaveBeenLastCalledWith(post, message));
  });
});
