/**
 * Generates the Stage 3 manual-acceptance sample document.
 *   npx tsx tests/fixtures/generate-sample.ts   (or via vitest, see below)
 *
 * Exercises every formatting feature the brief lists, in both Thai and English,
 * so the output can be opened in Word and Google Docs and checked by hand.
 */
import { writeFileSync } from 'fs';
import { generateDocxDocument } from '@/lib/docx/generator';
import { DEFAULT_DOCUMENT_SETTINGS } from '@/types/project';

const t = (text: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>) => ({
  type: 'text', text, ...(marks ? { marks } : {}),
});
const p = (attrs: Record<string, unknown>, content: unknown[]) => ({
  type: 'paragraph', attrs, content,
});

export const sampleChapters = [
  {
    chapterNumber: 5,
    title: 'เสียงจากลาดพร้าว',
    subtitle: 'The Voice from Lat Phrao',
    dateText: '20 กันยายน 2568',
    locationText: 'ลาดพร้าว 101, กรุงเทพฯ',
    content: {
      type: 'doc',
      content: [
        p({}, [t('ย่อหน้านี้ใช้ค่าเริ่มต้นของโครงการทั้งหมด Sarabun 16pt เยื้องบรรทัดแรก 0.5 ซม. ระยะบรรทัด 1.08')]),
        p({}, [t('This paragraph inherits every project default: Sarabun 16pt, 0.5cm first-line indent, multiple 1.08 line spacing, no space before or after.')]),

        p({}, [t('Georgia at 20pt: ', [{ type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSizePt: 20 } }]),
               t('the quick brown fox', [{ type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSizePt: 20 } }])]),
        p({}, [t('Tahoma 12pt ผสมไทย ', [{ type: 'textStyle', attrs: { fontFamily: 'Tahoma', fontSizePt: 12 } }])]),

        p({}, [
          t('Bold ', [{ type: 'bold' }]),
          t('Italic ', [{ type: 'italic' }]),
          t('Underline ', [{ type: 'underline' }]),
          t('Strike ', [{ type: 'strike' }]),
          t('ตัวหนาไทย', [{ type: 'bold' }]),
        ]),

        p({ textAlignOverride: 'left' }, [t('Left aligned — ชิดซ้าย')]),
        p({ textAlignOverride: 'center' }, [t('Centered — กึ่งกลาง')]),
        p({ textAlignOverride: 'right' }, [t('Right aligned — ชิดขวา')]),
        p({ textAlignOverride: 'justify' }, [t('Justified. ' + 'This paragraph is deliberately long so that justification is visible across the full measure of the A5 page when opened in a word processor. '.repeat(2))]),

        p({ firstLineIndentCmOverride: 2 }, [t('Custom first-line indent of 2 cm.')]),
        p({ firstLineIndentCmOverride: 0 }, [t('Explicit zero first-line indent (flush left).')]),
        p({ leftIndentCmOverride: 1.5, rightIndentCmOverride: 1.5 }, [t('Block quote style: left and right indent 1.5 cm each. ย่อหน้านี้เยื้องซ้ายและขวา')]),
        p({ spaceBeforePtOverride: 18, spaceAfterPtOverride: 18 }, [t('Space before and after: 18 pt each.')]),
        p({ lineSpacingOverride: 2 }, [t('Double line spacing override (2.0). ระยะบรรทัดคู่ เพื่อดูว่าวรรณยุกต์ไทยไม่ทับกัน')]),
        p({ lineSpacingOverride: 1.5 }, [t('Line spacing 1.5 override.')]),

        { type: 'sceneBreak' },

        p({}, [t('After the scene break, formatting returns to the project defaults.')]),
        p({}, [t('Line one'), { type: 'hardBreak' }, t('Line two after a hard break')]),

        { type: 'pageBreak' },

        p({}, [t('This paragraph begins a new page after an explicit page break.')]),
        p({}, [t('ทดสอบวรรณยุกต์ไทย: ก่ ก้ ก๊ ก๋ กิ๊ กี้ ปั๊ก เปี๊ยก โป๊ะ แน่ะ ไหม้ ญี่ปุ่น')]),
      ],
    },
  },
  {
    chapterNumber: 6,
    title: 'Second Chapter',
    content: {
      type: 'doc',
      content: [p({}, [t('A second chapter, to verify chapters are separated by a page break.')])],
    },
  },
];

export async function buildSample(outPath: string) {
  const buffer = await generateDocxDocument(
    'REDLINE LOVE',
    DEFAULT_DOCUMENT_SETTINGS,
    sampleChapters as never
  );
  writeFileSync(outPath, buffer);
  return buffer;
}
