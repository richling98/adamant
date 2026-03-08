import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMarkdownShape, normalizeSummaryMarkdown } from './summaryMarkdown.ts';

test('normalizeSummaryMarkdown strips leaked instruction blocks', () => {
  const input = [
    '**Summary**',
    '',
    'Good content',
    '',
    'SECTION-SPECIFIC INSTRUCTIONS:',
    '- hidden stuff',
    '</template>',
  ].join('\n');

  const output = normalizeSummaryMarkdown(input);
  assert.equal(output.includes('SECTION-SPECIFIC INSTRUCTIONS'), false);
  assert.equal(output.includes('hidden stuff'), false);
  assert.equal(output.includes('Good content'), true);
});

test('normalizeSummaryMarkdown converts markdown tables into bullet rows', () => {
  const input = '| Name | Value |\n| - | :--: |\n| Foo | Bar |';
  const output = normalizeSummaryMarkdown(input);
  assert.equal(output.includes('| --- | :---: |'), false);
  assert.equal(output.includes('- **Name**: Foo; **Value**: Bar'), true);
});

test('detectMarkdownShape reports table and instruction leak flags', () => {
  const input = [
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    'SECTION-SPECIFIC INSTRUCTIONS:',
  ].join('\n');

  const shape = detectMarkdownShape(input);
  assert.equal(shape.hasTable, true);
  assert.equal(shape.hasInstructionLeak, true);
  assert.equal(shape.lineCount, 4);
});
