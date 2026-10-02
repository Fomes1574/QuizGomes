import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildPhotoLibrary, parseCsvFields, photoRowsFromCsv, photoRowsFromJson, planPhotos, shortList,
} from '../lib/question-photo-import.js';
import { listZipEntries, readZipEntry } from '../lib/zip-reader.js';

/** .zip sintético montado à mão (deflate ou guardado), como o do Windows/macOS. */
function syntheticZip(files: Array<{ data: Uint8Array; deflate?: boolean; name: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const body = file.deflate === false ? file.data : new Uint8Array(deflateRawSync(file.data));
    const method = file.deflate === false ? 0 : 8;
    const local = new DataView(new ArrayBuffer(30 + name.length));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, method, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, file.data.length, true);
    local.setUint16(26, name.length, true);
    new Uint8Array(local.buffer).set(name, 30);
    const central = new DataView(new ArrayBuffer(46 + name.length));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, method, true);
    central.setUint32(20, body.length, true);
    central.setUint32(24, file.data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    new Uint8Array(central.buffer).set(name, 46);
    locals.push(new Uint8Array(local.buffer), body);
    centrals.push(new Uint8Array(central.buffer));
    offset += local.byteLength + body.length;
  }
  const directorySize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) { out.set(part, cursor); cursor += part.length; }
  return out;
}

const PIXELS = new Uint8Array(4096).map((_, index) => index % 251);

describe('leitor de .zip sem biblioteca', () => {
  it('lista e extrai arquivos com deflate e guardados, com pastas e acentos', async () => {
    const zip = new Blob([syntheticZip([
      { data: PIXELS, name: 'fotos/pokémon/pikachu.jpg' },
      { data: PIXELS.slice(0, 100), deflate: false, name: 'bulbasaur.png' },
    ]) as BlobPart]);
    const entries = await listZipEntries(zip);
    expect(entries.map((entry) => entry.name)).toEqual(['fotos/pokémon/pikachu.jpg', 'bulbasaur.png']);
    const first = await readZipEntry(zip, entries[0]!, 1_000_000);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(PIXELS);
    const second = await readZipEntry(zip, entries[1]!, 1_000_000);
    expect(second.size).toBe(100);
  });

  it('para de descompactar quando passa do limite e recusa o que não é .zip', async () => {
    const zip = new Blob([syntheticZip([{ data: PIXELS, name: 'grande.jpg' }]) as BlobPart]);
    const [entry] = await listZipEntries(zip);
    await expect(readZipEntry(zip, entry!, 1_000)).rejects.toThrow('grande demais');
    await expect(listZipEntries(new Blob(['não sou zip']))).rejects.toThrow('.zip válido');
  });
});

describe('coluna foto', () => {
  it('lê campos com aspas, vírgula e aspas escapadas', () => {
    expect(parseCsvFields('"Quem é, afinal?",A,"Diz ""oi""",foto.jpg')).toEqual(['Quem é, afinal?', 'A', 'Diz "oi"', 'foto.jpg']);
  });

  it('CSV: cada linha leva o nome da sua foto; sem coluna, nenhuma', () => {
    const csv = [
      'prompt,optionA,optionB,optionC,optionD,correctOption,Foto',
      '"Quem é esse pokémon?",Pikachu,Bulbasaur,Charmander,Squirtle,0,pikachu.jpg',
      '"Quem é esse pokémon?",Bulbasaur,Pikachu,Charmander,Squirtle,0, ',
    ].join('\n');
    expect(photoRowsFromCsv(csv)).toEqual({
      hasColumn: true,
      rows: [{ label: 'linha 2', photo: 'pikachu.jpg' }, { label: 'linha 3', photo: null }],
    });
    expect(photoRowsFromCsv('prompt,optionA\n"P?",A').hasColumn).toBe(false);
  });

  it('JSON: tira o campo foto do payload e guarda a ordem', () => {
    const result = photoRowsFromJson({ questions: [{ foto: 'a.jpg', prompt: 'P1' }, { prompt: 'P2' }], schemaVersion: 1 });
    expect(result.hasColumn).toBe(true);
    expect(result.rows).toEqual([{ label: 'pergunta 1', photo: 'a.jpg' }, { label: 'pergunta 2', photo: null }]);
    expect(result.parsed).toEqual({ questions: [{ prompt: 'P1' }, { prompt: 'P2' }], schemaVersion: 1 });
  });
});

describe('casamento das fotos com as linhas', () => {
  it('casa por nome sem pasta e sem maiúsculas, aceita nome sem extensão e separa o resto', async () => {
    const zip = new File([syntheticZip([
      { data: PIXELS, name: 'pokemon/Pikachu.JPG' },
      { data: PIXELS, name: '__MACOSX/pokemon/._Pikachu.JPG' },
      { data: PIXELS, name: 'sobrando.png' },
      { data: new TextEncoder().encode('oi'), name: 'leia-me.txt' },
    ]) as BlobPart], 'fotos.zip', { type: 'application/zip' });
    const loose = new File([PIXELS], 'bulbasaur.webp', { type: 'image/webp' });
    const library = await buildPhotoLibrary([zip, loose]);
    expect(library.ignored).toEqual(['leia-me.txt']);
    const plan = planPhotos([
      { label: 'linha 2', photo: 'pikachu.jpg' },
      { label: 'linha 3', photo: 'bulbasaur' },
      { label: 'linha 4', photo: 'charmander.jpg' },
      { label: 'linha 5', photo: null },
    ], library);
    expect([...plan.assignments.keys()]).toEqual([0, 1]);
    expect(plan.assignments.get(0)?.name).toBe('Pikachu.JPG');
    expect(plan.missing).toEqual([{ label: 'linha 4', photo: 'charmander.jpg' }]);
    expect(plan.unused).toEqual(['sobrando.png']);
    expect(plan.referencedRows).toBe(3);
    const extracted = await plan.assignments.get(0)!.load();
    expect(extracted.name).toBe('Pikachu.JPG');
    expect(extracted.size).toBe(PIXELS.length);
  });

  it('nome repetido em fotos diferentes não é adivinhado; foto inválida fica de fora', async () => {
    const library = await buildPhotoLibrary([
      new File([PIXELS], 'igual.jpg', { type: 'image/jpeg' }),
      new File([PIXELS.slice(0, 10)], 'IGUAL.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array(26 * 1024 * 1024)], 'enorme.jpg', { type: 'image/jpeg' }),
    ]);
    const plan = planPhotos([{ label: 'linha 2', photo: 'igual.jpg' }, { label: 'linha 3', photo: 'enorme.jpg' }], library);
    expect(plan.assignments.size).toBe(0);
    expect(plan.ambiguous).toEqual(['igual.jpg']);
    expect(plan.invalid[0]?.name).toBe('enorme.jpg');
  });

  it('resume listas longas', () => {
    expect(shortList(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('a, b, c, d e mais 2');
  });
});
