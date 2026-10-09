import { describe, expect, it } from 'vitest';
import { buildExportZip, importCsvOf, photoNames, type ExportedQuestion } from '../lib/question-export-zip.js';
import { buildPhotoLibrary, photoRowsFromCsv, planPhotos } from '../lib/question-photo-import.js';
import { chunkCsv } from '../lib/import-chunks.js';
import { listZipEntries, readZipEntry } from '../lib/zip-reader.js';
import { crc32, createZip } from '../lib/zip-writer.js';

const KEY_A = 'questions/00000000-0000-4000-8000-00000000000a/v1.webp';
const KEY_B = 'questions/00000000-0000-4000-8000-00000000000b/v2.webp';
const KEY_GONE = 'questions/00000000-0000-4000-8000-00000000000c/v1.webp';

/** Perguntas sintéticas de teste, nunca de produção. */
const QUESTIONS: ExportedQuestion[] = [
  { correctOption: 2, imageKey: KEY_A, options: ['Um', 'Dois', 'Três, com vírgula', 'Quatro'], prompt: '[FIXTURE] Qual é a "certa"?', sources: [{ kind: 'WEB', title: 'Fonte', url: 'https://exemplo.test/a' }], status: 'ACTIVE' },
  { correctOption: 0, imageKey: null, options: ['A', 'B', 'C', 'D'], prompt: '[FIXTURE] Sem foto?', sources: [], status: 'IN_REVIEW' },
  { correctOption: 1, imageKey: KEY_A, options: ['A', 'B', 'C', 'D'], prompt: '[FIXTURE] Mesma foto da primeira?', sources: [], status: 'DISABLED' },
  { correctOption: 3, imageKey: KEY_B, options: ['A', 'B', 'C', 'D'], prompt: '[FIXTURE] Outra foto?', sources: [], status: 'REJECTED' },
  { correctOption: 1, imageKey: KEY_GONE, options: ['A', 'B', 'C', 'D'], prompt: '[FIXTURE] Foto sumiu?', sources: [], status: 'ACTIVE' },
];

describe('gerador de .zip', () => {
  it('calcula o CRC-32 padrão', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('o leitor do painel lê de volta o que o gerador escreveu, com nomes acentuados', async () => {
    const photo = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
    const zip = await createZip([
      { data: 'prompt\r\nOlá', name: 'perguntas.csv' },
      { data: new Blob([photo]), name: 'fotos/coração.webp' },
    ]);
    const entries = await listZipEntries(zip);
    expect(entries.map((entry) => entry.name)).toEqual(['perguntas.csv', 'fotos/coração.webp']);
    expect(await (await readZipEntry(zip, entries[0]!, 1000)).text()).toBe('prompt\r\nOlá');
    expect(new Uint8Array(await (await readZipEntry(zip, entries[1]!, 1000)).arrayBuffer())).toEqual(photo);
  });
});

describe('exportação com fotos', () => {
  it('dá um nome por foto e reaproveita quando duas perguntas usam a mesma', () => {
    const names = photoNames(QUESTIONS);
    expect(names.get(KEY_A)).toBe('pergunta-0001.webp');
    expect(names.get(KEY_B)).toBe('pergunta-0004.webp');
    expect(names.size).toBe(3);
  });

  it('o CSV sai no formato da importação, que o próprio painel divide em partes', () => {
    const csv = importCsvOf(QUESTIONS, photoNames(QUESTIONS));
    expect(csv.startsWith('\uFEFFprompt,optionA,optionB,optionC,optionD,correctOption,foto,sourceUrl,sourceTitle,sourceKind,status\r\n')).toBe(true);
    expect(csv).toContain('"[FIXTURE] Qual é a ""certa""?",Um,Dois,"Três, com vírgula",Quatro,2,pergunta-0001.webp,https://exemplo.test/a,Fonte,WEB,Ativa');
    expect(csv).toContain('[FIXTURE] Sem foto?,A,B,C,D,0,,,,,Em revisão');
    const chunks = chunkCsv(csv);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text.startsWith('prompt,')).toBe(true);
  });

  it('o .zip volta pela importação: cada linha encontra a sua foto e a que falhou fica sem', async () => {
    const fetched: string[] = [];
    const result = await buildExportZip(QUESTIONS, (key) => {
      fetched.push(key);
      return Promise.resolve(key === KEY_GONE ? null : new Blob([new Uint8Array([82, 73, 70, 70, key.length])], { type: 'image/webp' }));
    });
    expect(fetched.sort()).toEqual([KEY_A, KEY_B, KEY_GONE].sort());
    expect(result).toMatchObject({ missingPhotos: 1, photos: 2, questions: 5 });

    const zipFile = new File([result.blob], 'exportado.zip', { type: 'application/zip' });
    const entries = await listZipEntries(zipFile);
    expect(entries.map((entry) => entry.name)).toEqual(['perguntas.csv', 'fotos/pergunta-0001.webp', 'fotos/pergunta-0004.webp']);

    const csv = await (await readZipEntry(zipFile, entries[0]!, 1_000_000)).text();
    const { hasColumn, rows } = photoRowsFromCsv(csv);
    expect(hasColumn).toBe(true);
    expect(rows.map((row) => row.photo)).toEqual(['pergunta-0001.webp', null, 'pergunta-0001.webp', 'pergunta-0004.webp', null]);

    // O mesmo .zip escolhido no campo de fotos da importação.
    const plan = planPhotos(rows, await buildPhotoLibrary([zipFile]));
    expect(plan.missing).toEqual([]);
    expect(plan.ambiguous).toEqual([]);
    expect([...plan.assignments.keys()]).toEqual([0, 2, 3]);
  });

  it('tema sem perguntas ainda gera um .zip com o CSV só de cabeçalho', async () => {
    const result = await buildExportZip([], () => Promise.resolve(null));
    const entries = await listZipEntries(result.blob);
    expect(entries.map((entry) => entry.name)).toEqual(['perguntas.csv']);
    expect(result).toMatchObject({ missingPhotos: 0, photos: 0, questions: 0 });
  });
});
