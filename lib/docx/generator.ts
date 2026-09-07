import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  PageBreak,
  AlignmentType,
  convertMillimetersToTwip,
  LineRuleType,
} from 'docx';
import { DocumentSettings } from '@/types/project';

interface TiptapContentNode {
  type?: string;
  text?: string;
  marks?: Array<{ type: string }>;
  content?: TiptapContentNode[];
  attrs?: Record<string, unknown>;
}

interface ChapterExportData {
  chapterNumber?: number | null;
  title: string;
  subtitle?: string;
  dateText?: string;
  locationText?: string;
  content: {
    content?: TiptapContentNode[];
  };
}

export async function generateDocxDocument(
  projectTitle: string,
  settings: DocumentSettings,
  chapters: ChapterExportData[]
): Promise<Buffer> {
  const docxParagraphs: Paragraph[] = [];

  // Formula for Multiple 1.08: 240ths of a line -> Math.round(240 * 1.08) = 259
  const lineSpacingTwip = Math.round(240 * settings.lineSpacingMultiplier);
  const firstLineTwip = convertMillimetersToTwip(settings.firstLineIndentCm * 10);
  const marginTwip = convertMillimetersToTwip(settings.margins.topMm);

  chapters.forEach((chap, index) => {
    // If not first chapter, insert page break between chapters
    if (index > 0) {
      docxParagraphs.push(
        new Paragraph({
          children: [new PageBreak()],
        })
      );
    }

    // 1. Chapter Number Heading
    if (chap.chapterNumber !== null && chap.chapterNumber !== undefined) {
      docxParagraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, after: 120 },
          children: [
            new TextRun({
              text: `CHAPTER ${chap.chapterNumber}`,
              font: settings.bodyFont,
              size: 24, // 12pt
              bold: true,
            }),
          ],
        })
      );
    }

    // 2. Chapter Title Heading
    docxParagraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 180 },
        children: [
          new TextRun({
            text: chap.title,
            font: settings.bodyFont,
            size: 36, // 18pt
            bold: true,
          }),
        ],
      })
    );

    // 3. Subtitle / Context (if present)
    if (chap.subtitle) {
      docxParagraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 120 },
          children: [
            new TextRun({
              text: chap.subtitle,
              font: settings.bodyFont,
              size: 28, // 14pt
              italics: true,
            }),
          ],
        })
      );
    }

    if (chap.dateText || chap.locationText) {
      const contextStr = [chap.dateText, chap.locationText].filter(Boolean).join(' — ');
      docxParagraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 360 },
          children: [
            new TextRun({
              text: contextStr,
              font: settings.bodyFont,
              size: 22, // 11pt
            }),
          ],
        })
      );
    }

    // 4. Chapter Body Paragraphs
    const bodyNodes = chap.content?.content || [];
    bodyNodes.forEach((node) => {
      if (node.type === 'pageBreak') {
        docxParagraphs.push(
          new Paragraph({
            children: [new PageBreak()],
          })
        );
        return;
      }

      if (node.type === 'sceneBreak') {
        docxParagraphs.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 240 },
            children: [
              new TextRun({
                text: settings.sceneBreakSymbol || '***',
                font: settings.bodyFont,
                size: settings.bodyFontSizePt * 2,
                bold: true,
              }),
            ],
          })
        );
        return;
      }

      // Regular Paragraph
      const textRuns: TextRun[] = (node.content || []).map((textChild) => {
        const marks = textChild.marks || [];
        return new TextRun({
          text: textChild.text || '',
          font: settings.bodyFont,
          size: settings.bodyFontSizePt * 2, // docx uses half-points (16pt = 32)
          bold: marks.some((m) => m.type === 'bold'),
          italics: marks.some((m) => m.type === 'italic'),
          underline: marks.some((m) => m.type === 'underline') ? {} : undefined,
          strike: marks.some((m) => m.type === 'strike'),
        });
      });

      const hasNoIndent = node.attrs?.noIndent === true;

      docxParagraphs.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          indent: hasNoIndent ? undefined : { firstLine: firstLineTwip },
          spacing: {
            before: settings.paragraphSpacingBeforePt * 20,
            after: settings.paragraphSpacingAfterPt * 20,
            line: lineSpacingTwip,
            lineRule: LineRuleType.AUTO,
          },
          children: textRuns,
        })
      );
    });
  });

  // Construct Document with A5 dimensions (148mm x 210mm)
  const doc = new Document({
    title: projectTitle,
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(148),
              height: convertMillimetersToTwip(210),
            },
            margin: {
              top: marginTwip,
              bottom: marginTwip,
              left: marginTwip,
              right: marginTwip,
            },
          },
        },
        children: docxParagraphs,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
