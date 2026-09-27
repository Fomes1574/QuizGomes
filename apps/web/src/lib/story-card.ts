/**
 * Cartões de compartilhamento do QUIZ GOMES.
 *
 * Todo compartilhamento é também um convite: marca visível, um desafio
 * direto ("Duvido você me ganhar") e o endereço para jogar. Formato de story
 * (1080 × 1920), que funciona em Instagram, WhatsApp e TikTok; a prévia de
 * link usa 1200 × 630.
 *
 * Só entram no canvas imagens da própria origem (ícone, avatar enviado) ou
 * de servidores que liberam CORS (foto do Google). Se uma imagem falhar, o
 * cartão cai para as iniciais: nunca fica "contaminado" e sempre vira
 * arquivo. As cores são fixas de propósito: a imagem sai igual em qualquer
 * tema do aparelho.
 */

export const STORY_WIDTH = 1_080;
export const STORY_HEIGHT = 1_920;
export const OG_WIDTH = 1_200;
export const OG_HEIGHT = 630;

const DISPLAY = '"Bricolage Grotesque", "Inter", system-ui, sans-serif';
const BODY = '"Inter", system-ui, sans-serif';
const BRAND_RED = '#e0353d';

type Ctx = CanvasRenderingContext2D;

export interface CardImages {
  brand?: CanvasImageSource | null;
  opponent?: CanvasImageSource | null;
  viewer?: CanvasImageSource | null;
}

interface Palette {
  accent: string;
  deep: string;
  glow: string;
  headline: [string, string];
  ring: [string, string];
}

const PALETTES: Record<'DRAW' | 'LOSS' | 'WIN', Palette> = {
  DRAW: { accent: '#6c63ff', deep: '#0d0b24', glow: 'rgba(124,115,255,0.55)', headline: ['#ffffff', '#c7c3ff'], ring: ['#a5a0ff', '#5a52e0'] },
  LOSS: { accent: '#3f5bd9', deep: '#070b1c', glow: 'rgba(80,110,255,0.45)', headline: ['#ffffff', '#b9c6ff'], ring: ['#8fa4ff', '#3149b8'] },
  WIN: { accent: BRAND_RED, deep: '#16040a', glow: 'rgba(255,90,70,0.6)', headline: ['#fff6d5', '#ffc94d'], ring: ['#ffe08a', '#e0353d'] },
};

// ---------- primitivas ----------

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts.at(-1)?.[0] ?? '' : '')).toLocaleUpperCase('pt-BR');
}

function shortName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return first.length > 14 ? `${first.slice(0, 13)}…` : first;
}

/** Encolhe a fonte até o texto caber na largura. */
function fitFont(context: Ctx, text: string, maxWidth: number, weight: number, size: number, family: string): number {
  let current = size;
  context.font = `${weight} ${current}px ${family}`;
  while (context.measureText(text).width > maxWidth && current > 22) {
    current -= 4;
    context.font = `${weight} ${current}px ${family}`;
  }
  return current;
}

function roundRect(context: Ctx, x: number, y: number, width: number, height: number, radius: number): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

/** Fundo escuro com brilho, raios de luz, pontilhado e cartas inclinadas. */
function drawBackdrop(context: Ctx, width: number, height: number, palette: Palette, glowY: number): void {
  const base = context.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, palette.deep);
  base.addColorStop(0.55, '#0b0b12');
  base.addColorStop(1, palette.deep);
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);

  const glow = context.createRadialGradient(width / 2, glowY, 0, width / 2, glowY, width * 0.75);
  glow.addColorStop(0, palette.glow);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  // Raios de luz saindo do centro do duelo.
  context.save();
  context.translate(width / 2, glowY);
  context.globalAlpha = 0.07;
  context.fillStyle = '#ffffff';
  for (let ray = 0; ray < 16; ray += 1) {
    context.rotate((Math.PI * 2) / 16);
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(-40, -height);
    context.lineTo(40, -height);
    context.closePath();
    context.fill();
  }
  context.restore();

  // Pontilhado discreto: textura sem pesar no arquivo.
  context.save();
  context.globalAlpha = 0.07;
  context.fillStyle = '#ffffff';
  for (let y = 24; y < height; y += 48) {
    for (let x = (y / 48) % 2 === 0 ? 24 : 48; x < width; x += 48) {
      context.beginPath();
      context.arc(x, y, 2, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.restore();

  // Cartas de tema inclinadas nas bordas, na linguagem do app.
  context.save();
  context.strokeStyle = 'rgba(255,255,255,0.14)';
  context.lineWidth = 3;
  const scale = width / STORY_WIDTH;
  for (const [x, y, angle] of [[90, 0.2, -0.28], [990, 0.33, 0.3], [70, 0.8, 0.22], [1010, 0.9, -0.2]] as const) {
    context.save();
    context.translate(x * scale, y * height);
    context.rotate(angle);
    context.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(context, -100 * scale, -140 * scale, 200 * scale, 280 * scale, 26 * scale);
    context.fill();
    context.stroke();
    context.restore();
  }
  context.restore();
}

/** Ícone + "QUIZ GOMES", centralizados em x. */
function drawBrand(context: Ctx, centerX: number, y: number, size: number, icon: CanvasImageSource | null | undefined): void {
  context.save();
  context.font = `800 ${size}px ${DISPLAY}`;
  context.textBaseline = 'middle';
  context.textAlign = 'left';
  const label = 'QUIZ GOMES';
  const textWidth = context.measureText(label).width;
  const iconSize = size * 1.5;
  const gap = size * 0.4;
  const total = (icon ? iconSize + gap : 0) + textWidth;
  let x = centerX - total / 2;
  if (icon) {
    context.save();
    roundRect(context, x, y - iconSize / 2, iconSize, iconSize, iconSize * 0.24);
    context.clip();
    context.drawImage(icon, x, y - iconSize / 2, iconSize, iconSize);
    context.restore();
    x += iconSize + gap;
  }
  context.fillStyle = '#ffffff';
  context.fillText(label, x, y + size * 0.04);
  context.restore();
}

function drawPill(context: Ctx, centerX: number, y: number, text: string, options: { fill: string; font: string; ink: string; stroke?: string }): void {
  context.save();
  context.font = options.font;
  const width = context.measureText(text).width + 64;
  roundRect(context, centerX - width / 2, y - 34, width, 68, 34);
  context.fillStyle = options.fill;
  context.fill();
  if (options.stroke !== undefined) {
    context.lineWidth = 2;
    context.strokeStyle = options.stroke;
    context.stroke();
  }
  context.fillStyle = options.ink;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, centerX, y + 2);
  context.restore();
}

/** Avatar redondo com anel colorido; sem foto, as iniciais. */
function drawMedallion(
  context: Ctx,
  x: number,
  y: number,
  radius: number,
  name: string,
  ring: [string, string],
  image: CanvasImageSource | null | undefined,
  dim = false,
): void {
  context.save();
  if (!dim) {
    context.shadowColor = ring[1];
    context.shadowBlur = 60;
  }
  const ringGradient = context.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
  ringGradient.addColorStop(0, ring[0]);
  ringGradient.addColorStop(1, ring[1]);
  context.beginPath();
  context.arc(x, y, radius + 12, 0, Math.PI * 2);
  context.fillStyle = ringGradient;
  context.fill();
  context.restore();

  context.save();
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.clip();
  if (image) {
    context.drawImage(image, x - radius, y - radius, radius * 2, radius * 2);
  } else {
    const face = context.createLinearGradient(x, y - radius, x, y + radius);
    face.addColorStop(0, '#2a2a3a');
    face.addColorStop(1, '#14141c');
    context.fillStyle = face;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `800 ${Math.round(radius * 0.72)}px ${DISPLAY}`;
    context.fillText(initials(name), x, y + radius * 0.04);
  }
  if (dim) {
    context.fillStyle = 'rgba(0,0,0,0.35)';
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  context.restore();
}

/** Texto grande com degradê e brilho. */
function drawHeadline(context: Ctx, text: string, centerX: number, y: number, maxWidth: number, size: number, colors: [string, string], glow: string): void {
  context.save();
  const actual = fitFont(context, text, maxWidth, 900, size, DISPLAY);
  const gradient = context.createLinearGradient(0, y - actual, 0, y);
  gradient.addColorStop(0, colors[0]);
  gradient.addColorStop(1, colors[1]);
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.shadowColor = glow;
  context.shadowBlur = 50;
  context.fillStyle = gradient;
  context.fillText(text, centerX, y);
  context.restore();
}

/**
 * Faixa segura: tudo que importa fica entre y=285 e y=1635. Nos Stories e no
 * Status, o topo (~250 px: progresso e perfil) e a base (~270 px: campo de
 * resposta) ficam cobertos pelo app; e o recorte 4:5 (1080 × 1350) dessa
 * mesma faixa vira o formato de conversa e feed, sem desenhar duas vezes.
 */
export const SAFE_TOP = 285;
export const POST_HEIGHT = 1_350;
const CTA_TOP = 1_440;

/** Painel de convite no rodapé da faixa segura: o chamado para jogar. */
function drawCallToAction(context: Ctx, width: number, top: number, headline: string, subline: string, accent: string): void {
  const margin = 70;
  const height = 190;
  context.save();
  roundRect(context, margin, top, width - margin * 2, height, 44);
  // Base escura por baixo do vidro: nada do fundo atravessa o chamado.
  context.fillStyle = 'rgba(10,10,16,0.82)';
  context.fill();
  context.fillStyle = 'rgba(255,255,255,0.07)';
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = 'rgba(255,255,255,0.18)';
  context.stroke();
  // Faixa de cor à esquerda, como a lombada das cartas de tema.
  context.save();
  roundRect(context, margin, top, width - margin * 2, height, 44);
  context.clip();
  context.fillStyle = accent;
  context.fillRect(margin, top, 14, height);
  context.restore();

  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillStyle = '#ffffff';
  fitFont(context, headline, width - margin * 2 - 80, 800, 56, DISPLAY);
  context.fillText(headline, width / 2, top + 84);
  context.fillStyle = 'rgba(255,255,255,0.72)';
  fitFont(context, subline, width - margin * 2 - 80, 600, 36, BODY);
  context.fillText(subline, width / 2, top + 148);
  context.restore();
}

/** Endereço curto para digitar ("quizgomes.app"), sem protocolo. */
export function shareHost(origin: string | undefined = typeof location === 'undefined' ? undefined : location.origin): string {
  if (origin === undefined || origin === '' || origin === 'null') return 'QUIZ GOMES';
  try {
    return new URL(origin).host;
  } catch {
    return 'QUIZ GOMES';
  }
}

// ---------- resultado ----------

export interface StoryCardInput {
  host?: string;
  opponent: { avatarUrl?: string | null; name: string; score: number };
  personalRecord: boolean;
  ranked: boolean;
  result: 'DRAW' | 'LOSS' | 'WIN';
  themeName: string | null;
  viewer: { avatarUrl?: string | null; name: string; score: number };
}

const HEADLINE: Record<StoryCardInput['result'], string> = { DRAW: 'EMPATE', LOSS: 'QUASE!', WIN: 'VITÓRIA' };

/** Frase curta que provoca sem mentir sobre o placar. */
export function resultHook(input: Pick<StoryCardInput, 'opponent' | 'result' | 'viewer'>): string {
  if (input.result === 'WIN') {
    return input.viewer.score >= input.opponent.score * 2 ? 'Atropelei geral.' : 'Ganhei no conhecimento.';
  }
  if (input.result === 'DRAW') return 'Ninguém cedeu um ponto.';
  const margin = input.opponent.score === 0 ? 1 : (input.opponent.score - input.viewer.score) / input.opponent.score;
  return margin <= 0.15 ? 'Perdi por um triz.' : 'Hoje não foi. Amanhã tem revanche.';
}

export function storyCardFileName(input: Pick<StoryCardInput, 'result'>): string {
  return `quiz-gomes-${input.result === 'WIN' ? 'vitoria' : input.result === 'DRAW' ? 'empate' : 'resultado'}.jpg`;
}

export function drawStoryCard(context: Ctx, input: StoryCardInput, images: CardImages = {}): void {
  const palette = PALETTES[input.result];
  const center = STORY_WIDTH / 2;
  drawBackdrop(context, STORY_WIDTH, STORY_HEIGHT, palette, 975);
  drawBrand(context, center, 340, 44, images.brand);

  drawPill(context, center, 428, input.ranked ? 'PARTIDA RANKEADA' : 'PARTIDA NORMAL', {
    fill: 'rgba(255,255,255,0.08)', font: `700 30px ${BODY}`, ink: 'rgba(255,255,255,0.86)', stroke: 'rgba(255,255,255,0.24)',
  });
  if (input.themeName !== null) {
    context.save();
    context.textAlign = 'center';
    context.fillStyle = '#ffffff';
    fitFont(context, input.themeName, STORY_WIDTH - 160, 800, 76, DISPLAY);
    context.fillText(input.themeName, center, 535);
    context.restore();
  }

  drawHeadline(context, HEADLINE[input.result], center, 720, STORY_WIDTH - 140, 180, palette.headline, palette.glow);
  context.save();
  context.textAlign = 'center';
  context.fillStyle = 'rgba(255,255,255,0.8)';
  context.font = `600 44px ${BODY}`;
  context.fillText(resultHook(input), center, 792);
  context.restore();

  // Duelo: medalhões, nomes e placar.
  const viewerWon = input.result === 'WIN';
  const opponentWon = input.result === 'LOSS';
  const seats = [
    { image: images.viewer, label: 'EU', name: input.viewer.name, score: input.viewer.score, winner: viewerWon, x: 290, dim: opponentWon },
    { image: images.opponent, label: 'ADVERSÁRIO', name: input.opponent.name, score: input.opponent.score, winner: opponentWon, x: 790, dim: viewerWon },
  ];
  for (const seat of seats) {
    drawMedallion(context, seat.x, 975, 118, seat.name, seat.winner || input.result === 'DRAW' ? palette.ring : ['#5b5b6b', '#2b2b36'], seat.image, seat.dim);
    context.save();
    context.textAlign = 'center';
    context.fillStyle = '#ffffff';
    context.font = `700 46px ${BODY}`;
    context.fillText(shortName(seat.name), seat.x, 1_162);
    context.fillStyle = 'rgba(255,255,255,0.6)';
    context.font = `700 26px ${BODY}`;
    context.fillText(seat.label, seat.x, 1_200);
    context.fillStyle = seat.dim ? 'rgba(255,255,255,0.55)' : '#ffffff';
    context.font = `900 140px ${DISPLAY}`;
    if (!seat.dim) {
      context.shadowColor = palette.glow;
      context.shadowBlur = 40;
    }
    context.fillText(String(seat.score), seat.x, 1_336);
    context.restore();
  }
  // Selo "×" entre os dois.
  context.save();
  context.beginPath();
  context.arc(center, 975, 50, 0, Math.PI * 2);
  context.fillStyle = BRAND_RED;
  context.shadowColor = 'rgba(224,53,61,0.8)';
  context.shadowBlur = 40;
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = '#ffffff';
  context.font = `900 56px ${DISPLAY}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('×', center, 973);
  context.restore();

  if (input.personalRecord) {
    drawPill(context, center, 1_394, '★ Novo recorde pessoal', { fill: '#ffd35c', font: `800 40px ${BODY}`, ink: '#3a2600' });
  }

  const challenge = input.themeName === null ? 'Duvido você me ganhar.' : `Duvido você me ganhar em ${input.themeName}.`;
  drawCallToAction(context, STORY_WIDTH, CTA_TOP, challenge, `Quiz 1×1 grátis · ${input.host ?? shareHost()}`, palette.accent);
}

// ---------- perfil ----------

export interface ProfileCardInput {
  avatarUrl?: string | null;
  bestTheme: { name: string; rankLabel: string } | null;
  frameColors?: [string, string] | null;
  host?: string;
  level: number;
  name: string;
  publicId: string;
  streak: number;
  wins: number;
}

export function drawProfileCard(context: Ctx, input: ProfileCardInput, images: CardImages = {}): void {
  const palette = PALETTES.WIN;
  const center = STORY_WIDTH / 2;
  drawBackdrop(context, STORY_WIDTH, STORY_HEIGHT, palette, 590);
  drawBrand(context, center, 340, 44, images.brand);
  drawMedallion(context, center, 585, 160, input.name, input.frameColors ?? palette.ring, images.viewer);

  context.save();
  context.textAlign = 'center';
  context.fillStyle = '#ffffff';
  fitFont(context, input.name, STORY_WIDTH - 160, 900, 92, DISPLAY);
  context.fillText(input.name, center, 850);
  context.restore();
  drawPill(context, center, 922, input.publicId, { fill: 'rgba(255,255,255,0.1)', font: `700 34px ${BODY}`, ink: '#ffffff', stroke: 'rgba(255,255,255,0.28)' });

  // Quatro números que dizem quem é o jogador.
  const tiles = [
    { label: 'NÍVEL', value: String(input.level) },
    { label: 'OFENSIVA', value: input.streak > 0 ? `${input.streak} ${input.streak === 1 ? 'dia' : 'dias'}` : '—' },
    { label: 'VITÓRIAS', value: input.wins.toLocaleString('pt-BR') },
    { label: 'MELHOR TEMA', value: input.bestTheme?.rankLabel ?? '—', caption: input.bestTheme?.name },
  ];
  tiles.forEach((tile, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 90 + column * 460;
    const y = 995 + row * 205;
    context.save();
    roundRect(context, x, y, 440, 180, 36);
    context.fillStyle = 'rgba(255,255,255,0.08)';
    context.fill();
    context.strokeStyle = 'rgba(255,255,255,0.16)';
    context.lineWidth = 2;
    context.stroke();
    context.textAlign = 'left';
    context.fillStyle = 'rgba(255,255,255,0.62)';
    context.font = `800 26px ${BODY}`;
    context.fillText(tile.label, x + 34, y + 54);
    context.fillStyle = '#ffffff';
    fitFont(context, tile.value, 372, 900, 64, DISPLAY);
    context.fillText(tile.value, x + 34, y + 122);
    if (tile.caption !== undefined) {
      context.fillStyle = 'rgba(255,255,255,0.7)';
      fitFont(context, tile.caption, 372, 600, 26, BODY);
      context.fillText(tile.caption, x + 34, y + 160);
    }
    context.restore();
  });

  drawCallToAction(context, STORY_WIDTH, CTA_TOP, 'Me desafia no QUIZ GOMES', `Me adiciona: ${input.publicId} · ${input.host ?? shareHost()}`, palette.accent);
}

// ---------- marco de ofensiva e conquistas ----------

export type MilestoneTier = 'bronze' | 'diamond' | 'ember' | 'gold' | 'legend' | 'platinum' | 'silver' | 'year';

const TIER_PALETTES: Record<MilestoneTier, Palette> = {
  bronze: { accent: '#d99058', deep: '#1a0d05', glow: 'rgba(230,150,90,0.55)', headline: ['#ffe2c4', '#d99058'], ring: ['#ffd1a1', '#7a3e1d'] },
  diamond: { accent: '#38bdf8', deep: '#04121c', glow: 'rgba(120,230,255,0.55)', headline: ['#ffffff', '#a1ffce'], ring: ['#a1ffce', '#2b5876'] },
  ember: { accent: '#ff7a18', deep: '#1a0804', glow: 'rgba(255,122,24,0.55)', headline: ['#fff1c2', '#ff9a3c'], ring: ['#ffd35c', '#ff4d2e'] },
  gold: { accent: '#ffc94d', deep: '#1a1204', glow: 'rgba(255,205,80,0.6)', headline: ['#fff6d5', '#ffc94d'], ring: ['#fff3b0', '#b8741a'] },
  legend: { accent: '#f7d774', deep: '#140312', glow: 'rgba(247,215,116,0.6)', headline: ['#fff6d5', '#f7d774'], ring: ['#f7d774', '#b31217'] },
  platinum: { accent: '#7ee8fa', deep: '#06121c', glow: 'rgba(126,232,250,0.5)', headline: ['#ffffff', '#7ee8fa'], ring: ['#e0f7ff', '#3a6ea5'] },
  silver: { accent: '#c9d3e0', deep: '#0c0f14', glow: 'rgba(201,211,224,0.45)', headline: ['#ffffff', '#c9d3e0'], ring: ['#f1f5f9', '#5b6b82'] },
  year: { accent: '#ff5f6d', deep: '#12051e', glow: 'rgba(255,95,109,0.55)', headline: ['#ffffff', '#ffc371'], ring: ['#ffc371', '#7b2ff7'] },
};

export interface MilestoneCardInput {
  big: string;
  bigCaption: string;
  description: string;
  host?: string;
  name: string;
  tier: MilestoneTier;
  title: string;
}

/** Coroa de louros simples: dois ramos de folhas desenhados à mão no canvas. */
function drawLaurel(context: Ctx, centerX: number, centerY: number, radius: number, color: string): void {
  context.save();
  context.fillStyle = color;
  for (const side of [-1, 1]) {
    for (let leaf = 0; leaf < 9; leaf += 1) {
      const angle = Math.PI / 2 + side * (0.35 + leaf * 0.27);
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      context.save();
      context.translate(x, y);
      context.rotate(angle + side * 0.9);
      context.beginPath();
      context.ellipse(0, 0, 16, 40, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }
  context.restore();
}

export function drawMilestoneCard(context: Ctx, input: MilestoneCardInput, images: CardImages = {}): void {
  const palette = TIER_PALETTES[input.tier];
  const center = STORY_WIDTH / 2;
  drawBackdrop(context, STORY_WIDTH, STORY_HEIGHT, palette, 760);
  drawBrand(context, center, 340, 44, images.brand);
  drawPill(context, center, 408, 'CONQUISTA DESBLOQUEADA', { fill: 'rgba(255,255,255,0.1)', font: `800 30px ${BODY}`, ink: '#ffffff', stroke: palette.accent });

  // Quanto mais raro, mais ornamento: louros a partir de 100 dias, anel duplo em 1 e 2 anos.
  if (input.tier !== 'ember') drawLaurel(context, center, 720, 280, `${palette.accent}cc`);
  if (input.tier === 'year' || input.tier === 'legend') {
    context.save();
    context.strokeStyle = palette.accent;
    context.lineWidth = 6;
    context.globalAlpha = 0.6;
    context.beginPath();
    context.arc(center, 720, 262, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
  drawHeadline(context, input.big, center, 800, STORY_WIDTH - 640, 300, palette.headline, palette.glow);
  context.save();
  context.textAlign = 'center';
  context.fillStyle = 'rgba(255,255,255,0.85)';
  context.font = `800 54px ${BODY}`;
  context.fillText(input.bigCaption.toLocaleUpperCase('pt-BR'), center, 880);
  context.fillStyle = '#ffffff';
  fitFont(context, input.title, STORY_WIDTH - 160, 900, 84, DISPLAY);
  context.fillText(input.title, center, 1_110);
  context.fillStyle = 'rgba(255,255,255,0.75)';
  fitFont(context, input.description, STORY_WIDTH - 180, 600, 40, BODY);
  context.fillText(input.description, center, 1_178);
  context.fillStyle = 'rgba(255,255,255,0.9)';
  context.font = `700 44px ${BODY}`;
  context.fillText(input.name, center, 1_280);
  context.restore();

  drawCallToAction(context, STORY_WIDTH, CTA_TOP, 'Consegue chegar aqui?', `Jogue grátis · ${input.host ?? shareHost()}`, palette.accent);
}

// ---------- convite ----------

export interface InviteCardInput {
  host?: string;
  name: string;
  publicId: string;
}

export function drawInviteCard(context: Ctx, input: InviteCardInput, images: CardImages = {}): void {
  const palette = PALETTES.WIN;
  const center = STORY_WIDTH / 2;
  drawBackdrop(context, STORY_WIDTH, STORY_HEIGHT, palette, 800);
  drawBrand(context, center, 340, 44, images.brand);
  drawHeadline(context, 'BORA', center, 570, STORY_WIDTH - 200, 190, PALETTES.WIN.headline, palette.glow);
  drawHeadline(context, 'DUELAR?', center, 755, STORY_WIDTH - 200, 190, PALETTES.WIN.headline, palette.glow);
  drawMedallion(context, center, 930, 112, input.name, palette.ring, images.viewer);
  context.save();
  context.textAlign = 'center';
  context.fillStyle = '#ffffff';
  fitFont(context, input.name, STORY_WIDTH - 200, 800, 64, DISPLAY);
  context.fillText(input.name, center, 1_140);
  context.restore();
  const facts = ['1×1 em tempo real', '10 s por pergunta', 'Ranking por tema'];
  facts.forEach((fact, index) => {
    drawPill(context, center, 1_215 + index * 76, fact, { fill: 'rgba(255,255,255,0.08)', font: `700 34px ${BODY}`, ink: '#ffffff', stroke: 'rgba(255,255,255,0.2)' });
  });
  drawCallToAction(context, STORY_WIDTH, CTA_TOP, `Me adiciona: ${input.publicId}`, `Jogue grátis · ${input.host ?? shareHost()}`, palette.accent);
}

// ---------- prévia de link (1200 × 630) ----------

export function drawOgCard(context: Ctx, images: CardImages = {}, host = ''): void {
  const invite = host === '' || host === 'QUIZ GOMES' ? 'Jogue grátis no navegador' : `Jogue grátis · ${host}`;
  const palette = PALETTES.WIN;
  drawBackdrop(context, OG_WIDTH, OG_HEIGHT, palette, 315);
  drawBrand(context, 330, 110, 40, images.brand);
  context.save();
  context.textAlign = 'center';
  context.fillStyle = '#ffffff';
  context.font = `900 84px ${DISPLAY}`;
  context.fillText('Quiz 1×1', 330, 280);
  context.fillText('ao vivo', 330, 370);
  context.fillStyle = 'rgba(255,255,255,0.78)';
  fitFont(context, 'Escolha um tema e prove quem manja mais.', 560, 600, 32, BODY);
  context.fillText('Escolha um tema e prove quem manja mais.', 330, 450);
  context.fillStyle = '#ffd35c';
  fitFont(context, invite, 560, 800, 30, BODY);
  context.fillText(invite, 330, 530);
  context.restore();

  // Mini placar à direita: o jogo explicado numa imagem.
  context.save();
  context.translate(910, 315);
  context.rotate(-0.05);
  roundRect(context, -230, -230, 460, 460, 48);
  context.fillStyle = 'rgba(255,255,255,0.08)';
  context.fill();
  context.strokeStyle = 'rgba(255,255,255,0.2)';
  context.lineWidth = 2;
  context.stroke();
  context.textAlign = 'center';
  context.fillStyle = 'rgba(255,255,255,0.7)';
  context.font = `800 24px ${BODY}`;
  context.fillText('PARTIDA RANKEADA', 0, -170);
  const headline = context.createLinearGradient(0, -130, 0, -40);
  headline.addColorStop(0, '#fff6d5');
  headline.addColorStop(1, '#ffc94d');
  context.fillStyle = headline;
  context.font = `900 84px ${DISPLAY}`;
  context.fillText('VITÓRIA', 0, -60);
  context.fillStyle = '#ffffff';
  context.font = `900 92px ${DISPLAY}`;
  context.fillText('180', -120, 88);
  context.fillStyle = 'rgba(255,255,255,0.55)';
  context.fillText('140', 120, 88);
  context.fillStyle = BRAND_RED;
  context.beginPath();
  context.arc(0, 55, 34, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffffff';
  context.font = `900 40px ${DISPLAY}`;
  context.fillText('×', 0, 68);
  context.fillStyle = 'rgba(255,255,255,0.75)';
  context.font = `700 26px ${BODY}`;
  context.fillText('10 s por pergunta', 0, 180);
  context.restore();
}

// ---------- renderização e compartilhamento ----------

/** Carrega uma imagem para o canvas; falha silenciosa vira "sem imagem". */
export async function loadCardImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (url === null || url === undefined || url === '' || typeof Image === 'undefined') return null;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';
  image.src = url;
  try {
    await Promise.race([
      image.decode(),
      new Promise((_, reject) => { setTimeout(() => reject(new Error('timeout')), 2_500); }),
    ]);
    return image;
  } catch {
    return null;
  }
}

async function fontsReady(): Promise<void> {
  if (typeof document === 'undefined' || document.fonts === undefined) return;
  await Promise.all([
    document.fonts.load(`900 100px ${DISPLAY}`),
    document.fonts.load(`700 40px ${BODY}`),
  ]).catch(() => undefined);
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  // JPEG de alta qualidade: ~5× menor que PNG com a textura do fundo; todo app aceita.
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob === null) reject(new Error('Não foi possível gerar a imagem.'));
    else resolve(blob);
  }, 'image/jpeg', 0.9));
}

const BRAND_ICON_URL = '/icons/icon-192.webp';

export type ShareCard =
  | { input: StoryCardInput; kind: 'result' }
  | { input: ProfileCardInput; kind: 'profile' }
  | { input: MilestoneCardInput; kind: 'milestone' }
  | { input: InviteCardInput; kind: 'invite' };

/** Stories/Status (9:16) ou conversa/feed (4:5). */
export type ShareFormat = 'post' | 'story';

function baseNameFor(card: ShareCard): string {
  if (card.kind === 'result') return storyCardFileName(card.input).replace(/\.jpg$/, '');
  if (card.kind === 'profile') return 'quiz-gomes-perfil';
  if (card.kind === 'milestone') return 'quiz-gomes-conquista';
  return 'quiz-gomes-convite';
}

export interface ShareCardFiles {
  post: File;
  story: File;
}

/**
 * Gera os dois formatos de uma vez: o story inteiro (1080 × 1920) e, para
 * conversas e feed, o recorte 4:5 (1080 × 1350) da faixa segura, onde já
 * está tudo o que importa. Com ícone e fotos quando disponíveis.
 */
export async function prepareShareCards(card: ShareCard): Promise<ShareCardFiles> {
  const viewerUrl = card.kind === 'result' ? card.input.viewer.avatarUrl
    : card.kind === 'profile' ? card.input.avatarUrl : null;
  const [brand, viewer, opponent] = await Promise.all([
    loadCardImage(BRAND_ICON_URL),
    loadCardImage(viewerUrl),
    loadCardImage(card.kind === 'result' ? card.input.opponent.avatarUrl : null),
  ]);
  const images: CardImages = { brand, opponent, viewer };
  const story = document.createElement('canvas');
  story.width = STORY_WIDTH;
  story.height = STORY_HEIGHT;
  const context = story.getContext('2d');
  if (context === null) throw new Error('Não foi possível gerar a imagem.');
  await fontsReady();
  if (card.kind === 'result') drawStoryCard(context, card.input, images);
  else if (card.kind === 'profile') drawProfileCard(context, card.input, images);
  else if (card.kind === 'milestone') drawMilestoneCard(context, card.input, images);
  else drawInviteCard(context, card.input, images);

  const post = document.createElement('canvas');
  post.width = STORY_WIDTH;
  post.height = POST_HEIGHT;
  const postContext = post.getContext('2d');
  if (postContext === null) throw new Error('Não foi possível gerar a imagem.');
  postContext.drawImage(story, 0, SAFE_TOP, STORY_WIDTH, POST_HEIGHT, 0, 0, STORY_WIDTH, POST_HEIGHT);

  const [storyBlob, postBlob] = await Promise.all([toJpeg(story), toJpeg(post)]);
  const base = baseNameFor(card);
  return {
    post: new File([postBlob], `${base}-conversa.jpg`, { type: 'image/jpeg' }),
    story: new File([storyBlob], `${base}.jpg`, { type: 'image/jpeg' }),
  };
}

/** Compatibilidade: só o story. */
export async function prepareShareCard(card: ShareCard): Promise<File> {
  return (await prepareShareCards(card)).story;
}

/** Compatibilidade: cartão de resultado. */
export async function prepareStoryCard(input: StoryCardInput): Promise<File> {
  return prepareShareCard({ input, kind: 'result' });
}

/**
 * Compartilha a imagem com texto e link (o link abre a prévia bonita do
 * tema); quando o aparelho não aceita arquivo, baixa a imagem. Recebe o
 * arquivo já pronto: o Safari só abre o menu se a chamada acontecer logo no
 * toque, sem esperar o canvas.
 */
export async function shareStoryFile(
  file: File,
  message?: { text: string; url?: string },
): Promise<'downloaded' | 'shared' | 'cancelled'> {
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'QUIZ GOMES',
        ...(message === undefined ? {} : { text: message.url === undefined ? message.text : `${message.text} ${message.url}` }),
      });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
