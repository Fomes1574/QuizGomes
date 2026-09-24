import { describe, expect, it } from 'vitest';
import { parseQuestionsCsv } from '../services/question-csv.js';

const HEADER = 'themeId,difficulty,prompt,optionA,optionB,optionC,optionD,correctOption,sourceUrl,sourceTitle,sourceKind';

describe('import CSV de perguntas', () => {
  it('converte linhas válidas em ImportedQuestion, uma fonte por linha', () => {
    const csv = [
      HEADER,
      'tema-1,EASY,"Qual a capital do Brasil?",Brasília,Rio,São Paulo,Salvador,0,https://fonte.test/a,Fonte A,WEB',
      'tema-1,MEDIUM,"Quanto é 2+2?",2,3,4,5,2,https://fonte.test/b,,PRIMARY',
    ].join('\n');
    const { diagnostics, questions } = parseQuestionsCsv(csv);
    expect(diagnostics).toEqual([]);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({
      correctOption: 0, prompt: 'Qual a capital do Brasil?', themeId: 'tema-1',
    });
    expect(questions[0]?.sources).toEqual([{ kind: 'WEB', title: 'Fonte A', url: 'https://fonte.test/a' }]);
    expect(questions[1]?.sources).toEqual([{ kind: 'PRIMARY', url: 'https://fonte.test/b' }]);
  });

  it('aceita lote sem fonte nem themeId quando o tema é escolhido no painel', () => {
    const csv = [
      'difficulty,prompt,optionA,optionB,optionC,optionD,correctOption',
      'EASY,"Pergunta sem fonte?",A,B,C,D,1',
    ].join('\n');
    const { diagnostics, questions } = parseQuestionsCsv(csv, 'tema-escolhido');
    expect(diagnostics).toEqual([]);
    expect(questions).toEqual([expect.objectContaining({
      correctOption: 1, sources: [], themeId: 'tema-escolhido',
    })]);
  });

  it('usa o tema escolhido no painel mesmo se o CSV trouxer outro themeId', () => {
    const csv = [
      HEADER,
      'tema-errado,EASY,"Pergunta no tema correto?",A,B,C,D,0,,,',
    ].join('\n');
    const { diagnostics, questions } = parseQuestionsCsv(csv, 'tema-selecionado');
    expect(diagnostics).toEqual([]);
    expect(questions[0]).toMatchObject({ sources: [], themeId: 'tema-selecionado' });
  });

  it('recusa CSV sem cabeçalho esperado', () => {
    const csv = 'a,b,c\n1,2,3';
    const { diagnostics, questions } = parseQuestionsCsv(csv);
    expect(questions).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.messages[0]).toContain('Colunas ausentes');
  });

  it('recusa CSV vazio ou sem linhas de dados', () => {
    expect(parseQuestionsCsv('').diagnostics[0]?.messages[0]).toContain('vazio');
    expect(parseQuestionsCsv(HEADER).diagnostics[0]?.messages[0]).toContain('nenhuma linha');
  });

  it('nunca importa nada quando qualquer linha for inválida (sem importação parcial)', () => {
    const csv = [
      HEADER,
      'tema-1,EASY,"Pergunta válida?",A,B,C,D,0,https://fonte.test/valida,,WEB',
      'tema-1,EASY,"Pergunta com alternativas repetidas?",X,X,Y,Z,0,https://fonte.test/invalida,,WEB',
    ].join('\n');
    const { diagnostics, questions } = parseQuestionsCsv(csv);
    expect(questions).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ row: 3 });
  });

  it('aponta a linha exata (1 = cabeçalho) de cada diagnóstico', () => {
    const csv = [
      HEADER,
      'tema-1,EASY,"Pergunta OK?",A,B,C,D,0,https://fonte.test/ok,,WEB',
      'tema-1,EASY,"Alternativa correta fora do intervalo?",A,B,C,D,9,https://fonte.test/x,,WEB',
      'tema-1,EASY,"Faltando colunas",A,B,C',
    ].join('\n');
    const { diagnostics } = parseQuestionsCsv(csv);
    expect(diagnostics.map((diagnostic) => diagnostic.row)).toEqual([3, 4]);
  });

  it('recusa lote maior que o limite técnico', () => {
    const rows = Array.from({ length: 101 }, (_, index) => (
      `tema-1,EASY,"Pergunta ${index}?",A,B,C,D,0,https://fonte.test/${index},,WEB`
    ));
    const csv = [HEADER, ...rows].join('\n');
    const { diagnostics, questions } = parseQuestionsCsv(csv);
    expect(questions).toEqual([]);
    expect(diagnostics[0]?.messages[0]).toContain('no máximo');
  });

  it('recusa duplicata dentro do mesmo lote CSV', () => {
    const csv = [
      HEADER,
      'tema-1,EASY,"Pergunta repetida?",A,B,C,D,0,https://fonte.test/1,,WEB',
      'tema-1,EASY,"Pergunta repetida?",A,B,C,D,0,https://fonte.test/2,,WEB',
    ].join('\n');
    const { diagnostics, questions } = parseQuestionsCsv(csv);
    expect(questions).toEqual([]);
    expect(diagnostics[0]?.messages[0]).toContain('duplicadas');
  });

  it('suporta aspas escapadas e vírgulas dentro de campos entre aspas', () => {
    const csv = [
      HEADER,
      'tema-1,EASY,"Pergunta com ""aspas"" e, vírgula?",A,B,C,D,0,https://fonte.test/1,"Título, com vírgula",WEB',
    ].join('\n');
    const { diagnostics, questions } = parseQuestionsCsv(csv);
    expect(diagnostics).toEqual([]);
    expect(questions[0]?.prompt).toBe('Pergunta com "aspas" e, vírgula?');
    expect(questions[0]?.sources[0]?.title).toBe('Título, com vírgula');
  });
});
