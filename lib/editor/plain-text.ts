import { sceneHeaderToText } from '@/lib/editor/scene-header';

interface TiptapNode {
  type?: string;
  text?: string;
  content?: TiptapNode[];
  attrs?: Record<string, unknown>;
  [key: string]: unknown;
}

export function extractPlainTextFromTiptap(doc: { content?: TiptapNode[] } | null | undefined): string {
  if (!doc || !doc.content) return '';

  const lines: string[] = [];

  function traverse(node: TiptapNode): string {
    if (node.type === 'text') {
      return node.text || '';
    }

    if (node.type === 'sceneBreak') {
      return '\n***\n';
    }

    if (node.type === 'sceneHeader') {
      // Word count follows what the author actually wrote, so an empty header
      // contributes nothing.
      const text = sceneHeaderToText(node.attrs as { timeText?: string; locationText?: string });
      return text ? `\n${text}\n` : '';
    }

    if (node.type === 'pageBreak') {
      return '\n[PAGE BREAK]\n';
    }

    if (node.content && Array.isArray(node.content)) {
      const childTexts: string = node.content.map((child) => traverse(child)).join('');
      if (node.type === 'paragraph') {
        lines.push(childTexts);
        return '';
      }
      return childTexts;
    }

    return '';
  }

  doc.content.forEach((block) => {
    const result = traverse(block);
    if (result) lines.push(result);
  });

  return lines.join('\n').trim();
}

export function calculateWordCount(text: string): { wordCount: number; charCount: number } {
  if (!text) return { wordCount: 0, charCount: 0 };

  const charCount = text.length;

  // Thai words do not use spaces, so we count standard whitespace tokens for English/Latin
  // and handle Thai sequences
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = tokens.length;

  return { wordCount, charCount };
}
