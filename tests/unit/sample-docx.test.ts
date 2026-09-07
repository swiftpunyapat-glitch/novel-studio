import { describe, expect, test } from 'vitest';
import JSZip from 'jszip';
import { mkdirSync } from 'fs';
import { buildSample, sampleChapters } from '../fixtures/generate-sample';

/**
 * Builds the manual-acceptance sample and asserts every advertised feature is
 * actually present in the OOXML, so the artifact handed to a human reviewer is
 * known-good before they open it.
 */
describe('Manual acceptance sample document', () => {
  test('generates and contains every exercised feature', async () => {
    mkdirSync('tests/output', { recursive: true });
    const buffer = await buildSample('tests/output/REDLINE LOVE - Chapter 5.docx');

    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')!.async('string');

    // Thai and English prose
    expect(xml).toContain('เสียงจากลาดพร้าว');
    expect(xml).toContain('This paragraph inherits every project default');
    // Thai tone marks
    expect(xml).toContain('ก่ ก้ ก๊ ก๋');

    // Fonts and sizes
    expect(xml).toMatch(/w:ascii="Georgia"/);
    expect(xml).toMatch(/w:ascii="Tahoma"/);
    expect(xml).toMatch(/<w:sz w:val="40"\s*\/>/); // 20pt
    expect(xml).toMatch(/<w:sz w:val="24"\s*\/>/); // 12pt

    // Emphasis
    expect(xml).toMatch(/<w:b\s*\/>/);
    expect(xml).toMatch(/<w:i\s*\/>/);
    expect(xml).toMatch(/<w:u w:val="single"\s*\/>/);
    expect(xml).toMatch(/<w:strike\s*\/>/);

    // Alignment
    for (const jc of ['left', 'center', 'right', 'both']) {
      expect(xml).toMatch(new RegExp(`<w:jc w:val="${jc}"\s*/>`));
    }

    // Indents and spacing
    expect(xml).toMatch(/w:firstLine="1134"/); // 2cm
    expect(xml).toMatch(/w:firstLine="0"/);
    expect(xml).toMatch(/w:left="850"/); // 1.5cm
    expect(xml).toMatch(/w:before="360"/); // 18pt
    expect(xml).toMatch(/w:line="480"/); // double
    expect(xml).toMatch(/w:line="360"/); // 1.5
    expect(xml).toMatch(/w:line="259"/); // inherited 1.08

    // Breaks
    expect(xml).toContain('***');
    expect(xml).toMatch(/<w:br w:type="page"\s*\/>/);
    expect(xml).toMatch(/<w:br\s*\/>/); // hard break

    // Chapter metadata via named styles
    expect(xml).toContain('CHAPTER 5');
    expect(xml).toContain('NovelChapterTitle');
    expect(xml).toContain('20 กันยายน 2568');

    // Both chapters present
    expect(xml).toContain('Second Chapter');
    expect(sampleChapters).toHaveLength(2);
  });
});
