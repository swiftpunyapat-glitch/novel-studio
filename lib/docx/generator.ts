import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  PageBreak,
  AlignmentType,
  LineRuleType,
  UnderlineType,
  convertMillimetersToTwip,
  type ISectionOptions,
  type IParagraphOptions,
} from 'docx';
import type { DocumentSettings } from '@/types/project';
import {
  resolveParagraphFormat,
  resolveRunFormat,
  cmToTwip,
  ptToTwip,
  ptToHalfPoints,
  multiplierToLineTwip,
  type Alignment,
} from '@/lib/format/effective';
import { isSupportedNode, UnsupportedNodeError } from '@/lib/editor/manuscript-schema';
import { sceneHeaderToText } from '@/lib/editor/scene-header';
import { canonicalFontName } from '@/lib/editor/fonts';

/**
 * Tiptap -> OOXML mapper. (Audit H1 / H2, Stage 3H + 3I)
 *
 * Rewritten rather than patched. The previous mapper hardcoded left alignment,
 * ignored every per-paragraph and per-run override, and assumed each block's
 * children were text nodes — so lists and blockquotes exported as empty runs.
 *
 * Three rules govern this file:
 *   1. Every property comes from `resolveParagraphFormat` / `resolveRunFormat`,
 *      so export and editor can never disagree about what "effective" means.
 *   2. The walker is recursive and explicit; an unknown node throws
 *      `UnsupportedNodeError` rather than emitting an empty paragraph.
 *   3. Chapter metadata is read from the Chapter model and rendered through
 *      named paragraph styles. It is never duplicated into ProseMirror JSON.
 */

interface TiptapNode {
  type?: string;
  text?: string;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: TiptapNode[];
  attrs?: Record<string, unknown>;
}

export interface ChapterExportData {
  chapterNumber?: number | null;
  title: string;
  subtitle?: string;
  dateText?: string;
  locationText?: string;
  content: { type?: string; content?: TiptapNode[] } | null | undefined;
}

const ALIGNMENT_MAP: Record<Alignment, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

/** Named styles for chapter metadata, so formatting is defined once. */
const STYLE_IDS = {
  chapterNumber: 'NovelChapterNumber',
  chapterTitle: 'NovelChapterTitle',
  chapterSubtitle: 'NovelChapterSubtitle',
  chapterContext: 'NovelChapterContext',
  sceneBreak: 'NovelSceneBreak',
  sceneHeader: 'NovelSceneHeader',
} as const;

function buildStyles(settings: DocumentSettings) {
  // A canonical family name, never a CSS stack: Word resolves w:ascii and w:cs
  // as one font name, so "TH Sarabun New, sans-serif" would silently substitute.
  const font = canonicalFontName(settings.bodyFont) ?? settings.bodyFont;
  const bodyHalfPt = ptToHalfPoints(settings.bodyFontSizePt);

  const centered = {
    alignment: AlignmentType.CENTER,
    indent: { firstLine: 0, left: 0, right: 0 },
  };

  return {
    default: {
      document: {
        run: {
          font,
          size: bodyHalfPt,
        },
        paragraph: {
          spacing: {
            before: ptToTwip(settings.paragraphSpacingBeforePt),
            after: ptToTwip(settings.paragraphSpacingAfterPt),
            line: multiplierToLineTwip(settings.lineSpacingMultiplier),
            lineRule: LineRuleType.AUTO,
          },
        },
      },
    },
    paragraphStyles: [
      {
        id: STYLE_IDS.chapterNumber,
        name: 'Novel Chapter Number',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font, size: ptToHalfPoints(12), bold: true, allCaps: true },
        paragraph: { ...centered, spacing: { before: ptToTwip(12), after: ptToTwip(6) } },
      },
      {
        id: STYLE_IDS.chapterTitle,
        name: 'Novel Chapter Title',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font, size: ptToHalfPoints(18), bold: true },
        paragraph: { ...centered, spacing: { before: ptToTwip(6), after: ptToTwip(9) } },
      },
      {
        id: STYLE_IDS.chapterSubtitle,
        name: 'Novel Chapter Subtitle',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font, size: ptToHalfPoints(14), italics: true },
        paragraph: { ...centered, spacing: { before: 0, after: ptToTwip(6) } },
      },
      {
        id: STYLE_IDS.chapterContext,
        name: 'Novel Chapter Context',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font, size: ptToHalfPoints(11) },
        paragraph: { ...centered, spacing: { before: ptToTwip(3), after: ptToTwip(18) } },
      },
      {
        id: STYLE_IDS.sceneBreak,
        name: 'Novel Scene Break',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font, size: bodyHalfPt, bold: true },
        paragraph: { ...centered, spacing: { before: ptToTwip(12), after: ptToTwip(12) } },
      },
      {
        // A scene header sits directly under its scene break, so it carries no
        // space before — the break's 12pt after already separates them.
        id: STYLE_IDS.sceneHeader,
        name: 'Novel Scene Header',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font, size: bodyHalfPt, italics: true },
        paragraph: { ...centered, spacing: { before: 0, after: ptToTwip(12) } },
      },
    ],
  };
}

/**
 * Builds a run. `font` and `size` are always emitted so Word does not fall back
 * to its own defaults; the docx library maps a string `font` onto w:ascii,
 * w:hAnsi, w:eastAsia AND w:cs, and derives w:szCs / w:bCs / w:iCs from
 * size / bold / italics — which is what keeps Thai (complex script) text in
 * Sarabun at the right size rather than Word's default Cordia New.
 */
function buildRun(node: TiptapNode, settings: DocumentSettings): TextRun {
  const format = resolveRunFormat(node.marks, settings);

  return new TextRun({
    text: node.text ?? '',
    font: format.fontFamily,
    size: ptToHalfPoints(format.fontSizePt),
    bold: format.bold,
    italics: format.italic,
    strike: format.strike,
    underline: format.underline ? { type: UnderlineType.SINGLE } : undefined,
  });
}

function paragraphOptions(
  node: TiptapNode,
  settings: DocumentSettings
): Omit<IParagraphOptions, 'children'> {
  const f = resolveParagraphFormat(node.attrs, settings);

  return {
    alignment: ALIGNMENT_MAP[f.alignment],
    indent: {
      firstLine: cmToTwip(f.firstLineIndentCm),
      left: cmToTwip(f.leftIndentCm),
      right: cmToTwip(f.rightIndentCm),
    },
    spacing: {
      before: ptToTwip(f.spaceBeforePt),
      after: ptToTwip(f.spaceAfterPt),
      line: multiplierToLineTwip(f.lineSpacingMultiplier),
      lineRule: LineRuleType.AUTO,
    },
  };
}

/** Recursively converts a paragraph's inline children into runs and breaks. */
function buildInline(
  nodes: TiptapNode[] | undefined,
  settings: DocumentSettings,
  path: string
): TextRun[] {
  const out: TextRun[] = [];
  if (!Array.isArray(nodes)) return out;

  nodes.forEach((child, index) => {
    const childPath = `${path}/${child?.type ?? 'unknown'}[${index}]`;

    if (!isSupportedNode(child?.type)) {
      throw new UnsupportedNodeError(child?.type ?? 'undefined', childPath);
    }

    switch (child.type) {
      case 'text':
        out.push(buildRun(child, settings));
        break;

      case 'hardBreak':
        // A soft line break inside a paragraph, not a new paragraph.
        out.push(new TextRun({ break: 1 }));
        break;

      default:
        // Nested blocks inside a paragraph are not part of the schema.
        throw new UnsupportedNodeError(child.type ?? 'undefined', childPath);
    }
  });

  return out;
}

/** Converts one block-level node into one or more DOCX paragraphs. */
function buildBlock(
  node: TiptapNode,
  settings: DocumentSettings,
  path: string
): Paragraph[] {
  if (!isSupportedNode(node?.type)) {
    throw new UnsupportedNodeError(node?.type ?? 'undefined', path);
  }

  switch (node.type) {
    case 'paragraph': {
      const children = buildInline(node.content, settings, path);
      return [
        new Paragraph({
          ...paragraphOptions(node, settings),
          // An empty paragraph is meaningful whitespace in a manuscript.
          children: children.length ? children : [new TextRun({ text: '' })],
        }),
      ];
    }

    case 'sceneBreak':
      return [
        new Paragraph({
          style: STYLE_IDS.sceneBreak,
          children: [
            new TextRun({
              text: settings.sceneBreakSymbol || '***',
              font: resolveRunFormat(null, settings).fontFamily,
              size: ptToHalfPoints(settings.bodyFontSizePt),
              bold: true,
            }),
          ],
        }),
      ];

    case 'sceneHeader': {
      const text = sceneHeaderToText(node.attrs as { timeText?: string; locationText?: string });
      // An empty header carries no information; emitting a blank centered
      // paragraph would add stray vertical space to the printed page.
      if (!text) return [];
      return [
        new Paragraph({
          style: STYLE_IDS.sceneHeader,
          children: [
            new TextRun({
              text,
              font: resolveRunFormat(null, settings).fontFamily,
              size: ptToHalfPoints(settings.bodyFontSizePt),
              italics: true,
            }),
          ],
        }),
      ];
    }

    case 'pageBreak':
      // A real OOXML page break, not a visual separator.
      return [new Paragraph({ children: [new PageBreak()] })];

    case 'text':
    case 'hardBreak':
      // Inline content must live inside a paragraph.
      throw new UnsupportedNodeError(node.type, `${path} (inline node at block level)`);

    default:
      throw new UnsupportedNodeError(node.type ?? 'undefined', path);
  }
}

/** Chapter metadata paragraphs, sourced from the Chapter model (Stage 3I). */
function buildChapterHeading(chapter: ChapterExportData): Paragraph[] {
  const out: Paragraph[] = [];

  if (chapter.chapterNumber !== null && chapter.chapterNumber !== undefined) {
    out.push(
      new Paragraph({
        style: STYLE_IDS.chapterNumber,
        children: [new TextRun({ text: `CHAPTER ${chapter.chapterNumber}` })],
      })
    );
  }

  out.push(
    new Paragraph({
      style: STYLE_IDS.chapterTitle,
      children: [new TextRun({ text: chapter.title || 'Untitled Chapter' })],
    })
  );

  if (chapter.subtitle) {
    out.push(
      new Paragraph({
        style: STYLE_IDS.chapterSubtitle,
        children: [new TextRun({ text: chapter.subtitle })],
      })
    );
  }

  const context = [chapter.dateText, chapter.locationText].filter(Boolean).join(' — ');
  if (context) {
    out.push(
      new Paragraph({
        style: STYLE_IDS.chapterContext,
        children: [new TextRun({ text: context })],
      })
    );
  }

  return out;
}

export interface GenerateOptions {
  /** Page size in millimetres. Defaults to A5. */
  pageWidthMm?: number;
  pageHeightMm?: number;
}

export async function generateDocxDocument(
  projectTitle: string,
  settings: DocumentSettings,
  chapters: ChapterExportData[],
  options: GenerateOptions = {}
): Promise<Buffer> {
  const paragraphs: Paragraph[] = [];

  chapters.forEach((chapter, index) => {
    // Each chapter after the first starts on a fresh page.
    if (index > 0) {
      paragraphs.push(new Paragraph({ children: [new PageBreak()] }));
    }

    paragraphs.push(...buildChapterHeading(chapter));

    const blocks = chapter.content?.content ?? [];
    blocks.forEach((node, blockIndex) => {
      paragraphs.push(
        ...buildBlock(node, settings, `chapter[${index}]/content[${blockIndex}]`)
      );
    });
  });

  const section: ISectionOptions = {
    properties: {
      page: {
        size: {
          width: convertMillimetersToTwip(options.pageWidthMm ?? 148),
          height: convertMillimetersToTwip(options.pageHeightMm ?? 210),
        },
        margin: {
          top: convertMillimetersToTwip(settings.margins.topMm),
          bottom: convertMillimetersToTwip(settings.margins.bottomMm),
          left: convertMillimetersToTwip(settings.margins.leftMm),
          right: convertMillimetersToTwip(settings.margins.rightMm),
        },
      },
    },
    children: paragraphs,
  };

  const doc = new Document({
    title: projectTitle,
    styles: buildStyles(settings),
    sections: [section],
  });

  return Packer.toBuffer(doc);
}

export { STYLE_IDS };
