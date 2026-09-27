import { describe, expect, it } from 'vitest';
import { chunkCsv, chunkJsonQuestions, fileLineForChunkRow, splitCsvRecords } from '../lib/import-chunks.js';

describe('divisão de importação em partes', () => {
  it('respeita quebra de linha e vírgula dentro de aspas', () => {
    const records = splitCsvRecords('﻿prompt,a\r\n"Linha 1\ncontinua, ok",x\n\n"Dupla ""aspas""",y');
    expect(records).toEqual([
      { line: 1, raw: 'prompt,a' },
      { line: 2, raw: '"Linha 1\ncontinua, ok",x' },
      { line: 5, raw: '"Dupla ""aspas""",y' },
    ]);
  });

  it('repete o cabeçalho em cada parte de 100', () => {
    const rows = Array.from({ length: 201 }, (_, index) => `P${index},A`);
    const chunks = chunkCsv(['prompt,a', ...rows].join('\n'));
    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.text.split('\n').length)).toEqual([101, 101, 2]);
    expect(chunks.every((chunk) => chunk.text.startsWith('prompt,a\n'))).toBe(true);
    expect(chunks.map((chunk) => chunk.firstLine)).toEqual([2, 102, 202]);
    // "Linha 2" da segunda parte é a linha 102 do arquivo.
    expect(fileLineForChunkRow(chunks[1]!, 2)).toBe(102);
    expect(fileLineForChunkRow(chunks[1]!, 5)).toBe(105);
  });

  it('aceita lista ou { questions } no JSON e recusa outros formatos', () => {
    expect(chunkJsonQuestions(Array.from({ length: 150 }, (_, index) => index))?.map((chunk) => chunk.length)).toEqual([100, 50]);
    expect(chunkJsonQuestions({ questions: [1, 2] })).toEqual([[1, 2]]);
    expect(chunkJsonQuestions({ outra: 1 })).toBeNull();
  });
});
