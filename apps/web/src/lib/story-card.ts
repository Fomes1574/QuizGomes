/**
 * Carta 9:16 do resultado para stories (1080 × 1920). Desenhada só com
 * texto e formas: nenhuma imagem externa entra no canvas, então ele nunca
 * fica "contaminado" por CORS e sempre pode virar arquivo. As cores são
 * fixas de propósito: a imagem sai igual em qualquer tema do aparelho.
 */
export interface StoryCardInput {
  opponent: { name: string; score: number };
  personalRecord: boolean;
  ranked: boolean;
  result: 'DRAW' | 'LOSS' | 'WIN';
  themeName: string | null;
  viewer: { name: string; score: number };
}

const WIDTH = 1_080;
const HEIGHT = 1_920;
const HEADLINE: Record<StoryCardInput['result'], string> = { DRAW: 'EMPATE', LOSS: 'DERROTA', WIN: 'VITÓRIA' };
const ACCENT: Record<StoryCardInput['result'], [string, string]> = {
  DRAW: ['#5a56d6', '#2d2a7a'],
  LOSS: ['#3b3f58', '#1a1c2a'],
  WIN: ['#e0353d', '#7a1420'],
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts.at(-1)?.[0] ?? '' : '')).toLocaleUpperCase('pt-BR');
}

/** Encolhe a fonte até o texto caber na largura. */
function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number, weight: number, size: number, family: string): void {
  let current = size;
  context.font = `${weight} ${current}px ${family}`;
  while (context.measureText(text).width > maxWidth && current > 24) {
    current -= 4;
    context.font = `${weight} ${current}px ${family}`;
  }
}

function shortName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return first.length > 14 ? `${first.slice(0, 13)}…` : first;
}

export function storyCardFileName(input: StoryCardInput): string {
  return `quiz-gomes-${input.result === 'WIN' ? 'vitoria' : input.result === 'DRAW' ? 'empate' : 'resultado'}.png`;
}

export function drawStoryCard(context: CanvasRenderingContext2D, input: StoryCardInput): void {
  const display = '"Bricolage Grotesque", "Inter", system-ui, sans-serif';
  const body = '"Inter", system-ui, sans-serif';
  const [accent, deep] = ACCENT[input.result];

  const background = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  background.addColorStop(0, accent);
  background.addColorStop(1, deep);
  context.fillStyle = background;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  // Cartas decorativas inclinadas ao fundo, na linguagem das cartas de tema.
  context.save();
  context.globalAlpha = 0.1;
  context.fillStyle = '#ffffff';
  for (const [x, y, angle] of [[140, 360, -0.25], [820, 520, 0.3], [180, 1500, 0.2], [880, 1620, -0.2]] as const) {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.beginPath();
    context.roundRect(-110, -150, 220, 300, 28);
    context.fill();
    context.restore();
  }
  context.restore();

  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillStyle = 'rgba(255,255,255,0.85)';
  context.font = `800 44px ${display}`;
  context.fillText('QUIZ GOMES', WIDTH / 2, 170);

  context.fillStyle = 'rgba(255,255,255,0.75)';
  context.font = `600 38px ${body}`;
  context.fillText(input.ranked ? 'Partida rankeada' : 'Partida normal', WIDTH / 2, 250);

  if (input.themeName !== null) {
    context.fillStyle = '#ffffff';
    fitText(context, input.themeName, WIDTH - 160, 800, 76, display);
    context.fillText(input.themeName, WIDTH / 2, 350);
  }

  context.fillStyle = '#ffffff';
  fitText(context, HEADLINE[input.result], WIDTH - 120, 900, 190, display);
  context.fillText(HEADLINE[input.result], WIDTH / 2, 640);

  // Placar: dois medalhões com iniciais e pontos.
  const seats = [
    { x: 300, ...input.viewer, label: 'Você' },
    { x: 780, ...input.opponent, label: 'Adversário' },
  ];
  for (const seat of seats) {
    context.beginPath();
    context.arc(seat.x, 900, 130, 0, Math.PI * 2);
    context.fillStyle = 'rgba(255,255,255,0.16)';
    context.fill();
    context.lineWidth = 8;
    context.strokeStyle = 'rgba(255,255,255,0.7)';
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = `800 96px ${display}`;
    context.fillText(initials(seat.name), seat.x, 935);
    context.font = `700 44px ${body}`;
    context.fillText(shortName(seat.name), seat.x, 1100);
    context.fillStyle = 'rgba(255,255,255,0.7)';
    context.font = `600 32px ${body}`;
    context.fillText(seat.label, seat.x, 1150);
    context.fillStyle = '#ffffff';
    context.font = `900 150px ${display}`;
    context.fillText(String(seat.score), seat.x, 1330);
  }
  context.font = `800 64px ${display}`;
  context.fillStyle = 'rgba(255,255,255,0.8)';
  context.fillText('×', WIDTH / 2, 1310);

  if (input.personalRecord) {
    context.fillStyle = '#ffd35c';
    context.beginPath();
    context.roundRect(WIDTH / 2 - 330, 1420, 660, 96, 48);
    context.fill();
    context.fillStyle = '#3a2600';
    context.font = `800 44px ${body}`;
    context.fillText('★ Novo recorde pessoal', WIDTH / 2, 1484);
  }

  context.fillStyle = 'rgba(255,255,255,0.85)';
  context.font = `700 44px ${body}`;
  context.fillText('Duvido você me ganhar.', WIDTH / 2, 1700);
  context.fillStyle = 'rgba(255,255,255,0.65)';
  context.font = `600 34px ${body}`;
  context.fillText('10 s por pergunta · sem desempate', WIDTH / 2, 1760);
}

export async function renderStoryCard(input: StoryCardInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Não foi possível gerar a imagem.');
  if (typeof document.fonts?.ready?.then === 'function') await document.fonts.ready.catch(() => undefined);
  drawStoryCard(context, input);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob === null) reject(new Error('Não foi possível gerar a imagem.'));
    else resolve(blob);
  }, 'image/png'));
}

export async function prepareStoryCard(input: StoryCardInput): Promise<File> {
  return new File([await renderStoryCard(input)], storyCardFileName(input), { type: 'image/png' });
}

/**
 * Compartilha como arquivo quando o aparelho aceita; senão baixa a imagem.
 * Recebe o arquivo já pronto: o Safari só abre o menu de compartilhar se a
 * chamada acontecer logo no toque, sem esperar o canvas.
 */
export async function shareStoryFile(file: File): Promise<'downloaded' | 'shared' | 'cancelled'> {
  const blob = file;
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'QUIZ GOMES' });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
