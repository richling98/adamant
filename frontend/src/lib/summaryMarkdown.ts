export interface SummaryMarkdownShape {
  hasTable: boolean;
  hasInstructionLeak: boolean;
  hasTemplateArtifacts: boolean;
  lineCount: number;
  markdownLength: number;
}

function normalizeTableSeparatorLine(line: string): string {
  const trimmed = line.trim();
  const isSeparator = /^\|[\s:\-]+\|(\s*[\s:\-]+\|)+$/.test(trimmed);
  if (!isSeparator) {
    return line;
  }

  const columns = trimmed
    .split('|')
    .slice(1, -1)
    .map((column) => column.trim());

  const normalizedColumns = columns.map((column) => {
    const hasLeftAlign = column.startsWith(':');
    const hasRightAlign = column.endsWith(':');
    const dashCount = (column.match(/-/g) || []).length;
    const dashes = '-'.repeat(Math.max(3, dashCount));
    return `${hasLeftAlign ? ':' : ''}${dashes}${hasRightAlign ? ':' : ''}`;
  });

  return `| ${normalizedColumns.join(' | ')} |`;
}

function stripInlineMarkdown(text: string): string {
  return text.replace(/\*\*/g, '').replace(/[*`_]/g, '').trim();
}

function parseTableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return [];
  }

  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

function isTableRow(line: string): boolean {
  return parseTableCells(line).length >= 2;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:\-]+(\|[\s:\-]+)+\|?\s*$/.test(line.trim());
}

function convertTablesToBullets(markdown: string): string {
  const lines = markdown.split('\n');
  const converted: string[] = [];
  let index = 0;
  let inCodeFence = false;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      converted.push(line);
      index += 1;
      continue;
    }

    const divider = lines[index + 1];
    if (!inCodeFence && divider !== undefined && isTableRow(line) && isTableSeparator(divider)) {
      const headers = parseTableCells(line).map(stripInlineMarkdown);
      index += 2;

      while (index < lines.length && isTableRow(lines[index])) {
        const cells = parseTableCells(lines[index]);
        const fields = cells
          .map((cell, cellIndex) => {
            const value = cell.trim();
            if (!value) {
              return '';
            }
            const label = headers[cellIndex] || 'Item';
            return `**${label}**: ${value}`;
          })
          .filter(Boolean);

        if (fields.length > 0) {
          converted.push(`- ${fields.join('; ')}`);
        }
        index += 1;
      }

      if (converted.length > 0 && converted[converted.length - 1] !== '') {
        converted.push('');
      }
      continue;
    }

    converted.push(line);
    index += 1;
  }

  return converted.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function normalizeSummaryMarkdown(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') {
    return '';
  }

  let normalized = markdown.replace(/\r\n/g, '\n');

  // Remove common leaked instruction/template content from model output.
  normalized = normalized.replace(/\n?SECTION-SPECIFIC INSTRUCTIONS:[\s\S]*$/i, '');
  normalized = normalized.replace(/<\/?template>/gi, '');
  normalized = normalized.replace(/```template[\s\S]*?```/gi, '');
  normalized = convertTablesToBullets(normalized);

  const lines = normalized.split('\n');
  normalized = lines
    .map((line) => normalizeTableSeparatorLine(line).replace(/[ \t]+$/g, ''))
    .join('\n');

  // Keep spacing predictable for parser and fallback renderer.
  normalized = normalized.replace(/\n{3,}/g, '\n\n').trim();

  return normalized;
}

export function detectMarkdownShape(markdown: string): SummaryMarkdownShape {
  const source = markdown || '';
  const hasTable =
    /\|[-:\s]+\|/.test(source) ||
    source
      .split('\n')
      .some((line) => line.trim().startsWith('|') && line.trim().endsWith('|'));

  return {
    hasTable,
    hasInstructionLeak: /SECTION-SPECIFIC INSTRUCTIONS:/i.test(source),
    hasTemplateArtifacts: /<\/?template>/i.test(source),
    lineCount: source ? source.split('\n').length : 0,
    markdownLength: source.length,
  };
}
