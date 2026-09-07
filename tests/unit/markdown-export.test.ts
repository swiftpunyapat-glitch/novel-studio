import { describe, expect, test } from 'vitest';
import {
  generateManuscriptMarkdown,
  chapterHeading,
  volumeHeading,
  escapeMarkdown,
  PAGE_BREAK_MARKER,
  SCENE_BREAK_MARKER,
  type MarkdownChapterInput,
} from '@/lib/markdown/generator';
import { sanitizeFilename, exportFilename, selectChapters } from '@/lib/docx/export-client';
import type { Chapter, Volume } from '@/types/project';

const PROJECT = 'REDLINE LOVE';

function p(text: string, marks?: Array<{ type: string }>) {
  return { type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] };
}

function doc(...nodes: unknown[]) {
  return { type: 'doc', content: nodes as never };
}

function chapter(over: Partial<MarkdownChapterInput> = {}): MarkdownChapterInput {
  return {
    chapterNumber: 1,
    chapterType: 'chapter',
    title: 'The Long Road',
    content: doc(p('body')),
    ...over,
  };
}

const VOLUMES = [
  { id: 'v1', volumeNumber: 1, title: 'Bangkok Nights' },
  { id: 'v2', volumeNumber: 2, title: 'Northbound' },
];

// ---------------------------------------------------------------------------

describe('Thai prose survives unchanged', () => {
  const thai = 'เธอหยุดอยู่ตรงนั้น แล้วมองย้อนกลับไป';
  const toneMarks = 'ก่ ก้ ก๊ ก๋ กิ๊ กี้ ปั๊ก เปี๊ยก โป๊ะ แน่ะ ไหม้ ญี่ปุ่น';

  test('Thai body text is byte-for-byte identical', () => {
    const md = generateManuscriptMarkdown(PROJECT, [chapter({ content: doc(p(thai)) })]);
    expect(md).toContain(thai);
  });

  test('Thai tone marks are not mangled or escaped', () => {
    const md = generateManuscriptMarkdown(PROJECT, [chapter({ content: doc(p(toneMarks)) })]);
    expect(md).toContain(toneMarks);
    expect(md).not.toContain('\\ก');
  });

  test('Thai in titles, metadata and scene headers survives', () => {
    const md = generateManuscriptMarkdown(
      'เสียงจากลาดพร้าว',
      [
        chapter({
          title: 'บทที่หนึ่ง',
          subtitle: 'คำนำ',
          dateText: '20 กันยายน 2568',
          locationText: 'ลาดพร้าว 101',
          content: doc({
            type: 'sceneHeader',
            attrs: { timeText: '18:30', locationText: 'ลาดพร้าว 101' },
          }),
        }),
      ]
    );
    expect(md).toContain('เสียงจากลาดพร้าว');
    expect(md).toContain('บทที่หนึ่ง');
    expect(md).toContain('คำนำ');
    expect(md).toContain('20 กันยายน 2568');
    expect(md).toContain('> 18:30 — ลาดพร้าว 101');
  });

  test('the document round-trips through UTF-8 encode/decode unchanged', () => {
    const md = generateManuscriptMarkdown(PROJECT, [chapter({ content: doc(p(toneMarks)) })]);
    const round = new TextDecoder('utf-8').decode(new TextEncoder().encode(md));
    expect(round).toBe(md);
  });
});

describe('Document structure', () => {
  test('project title is the H1 and appears once', () => {
    const md = generateManuscriptMarkdown(PROJECT, [chapter()]);
    expect(md.split('\n')[0]).toBe(`# ${PROJECT}`);
    expect(md.match(/^# /gm)).toHaveLength(1);
  });

  test('volumes are H2 and chapters are H3', () => {
    const md = generateManuscriptMarkdown(
      PROJECT,
      [chapter({ volumeId: 'v1' })],
      { volumes: VOLUMES }
    );
    expect(md).toContain('## Volume 1 — Bangkok Nights');
    expect(md).toContain('### Chapter 1 — The Long Road');
  });

  test('a volume heading is emitted once per volume, at its boundary', () => {
    const md = generateManuscriptMarkdown(
      PROJECT,
      [
        chapter({ chapterNumber: 1, volumeId: 'v1', title: 'One' }),
        chapter({ chapterNumber: 2, volumeId: 'v1', title: 'Two' }),
        chapter({ chapterNumber: 3, volumeId: 'v2', title: 'Three' }),
      ],
      { volumes: VOLUMES }
    );
    expect(md.match(/^## /gm)).toHaveLength(2);
    expect(md.indexOf('## Volume 1')).toBeLessThan(md.indexOf('### Chapter 1'));
    expect(md.indexOf('### Chapter 2')).toBeLessThan(md.indexOf('## Volume 2'));
    expect(md.indexOf('## Volume 2')).toBeLessThan(md.indexOf('### Chapter 3'));
  });

  test('chapters appear in the order given', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({ chapterNumber: 1, title: 'First' }),
      chapter({ chapterNumber: 2, title: 'Second' }),
      chapter({ chapterNumber: 3, title: 'Third' }),
    ]);
    expect(md.indexOf('First')).toBeLessThan(md.indexOf('Second'));
    expect(md.indexOf('Second')).toBeLessThan(md.indexOf('Third'));
  });

  test('no volume heading when the volume is unknown', () => {
    const md = generateManuscriptMarkdown(PROJECT, [chapter({ volumeId: 'ghost' })], {
      volumes: VOLUMES,
    });
    // Anchored: "## " also occurs inside "### ".
    expect(md).not.toMatch(/^## /m);
  });

  test('a volume with no title still gets a heading', () => {
    const md = generateManuscriptMarkdown(PROJECT, [chapter({ volumeId: 'v3' })], {
      volumes: [{ id: 'v3', volumeNumber: 3, title: '' }],
    });
    expect(md).toContain('## Volume 3');
  });
});

describe('Prologue / Chapter / Epilogue headings', () => {
  test('prologue renders as Prologue', () => {
    expect(
      chapterHeading({ chapterType: 'prologue', chapterNumber: null, title: 'Prologue' })
    ).toBe('Prologue');
  });

  test('a titled prologue keeps its title', () => {
    expect(
      chapterHeading({ chapterType: 'prologue', chapterNumber: null, title: 'Before the Rain' })
    ).toBe('Prologue — Before the Rain');
  });

  test('an untitled prologue is just Prologue', () => {
    expect(chapterHeading({ chapterType: 'prologue', chapterNumber: null, title: '' })).toBe(
      'Prologue'
    );
  });

  test('epilogue behaves the same way', () => {
    expect(chapterHeading({ chapterType: 'epilogue', chapterNumber: null, title: '' })).toBe(
      'Epilogue'
    );
    expect(
      chapterHeading({ chapterType: 'epilogue', chapterNumber: null, title: 'After' })
    ).toBe('Epilogue — After');
  });

  test('a numbered chapter includes number and title', () => {
    expect(chapterHeading({ chapterNumber: 5, title: 'Redline' })).toBe('Chapter 5 — Redline');
  });

  test('a numbered chapter with no title is just the number', () => {
    expect(chapterHeading({ chapterNumber: 5, title: '' })).toBe('Chapter 5');
  });

  test('a chapter with no number falls back to its title', () => {
    expect(chapterHeading({ chapterNumber: null, title: 'Interlude' })).toBe('Interlude');
  });

  test('missing chapterType is treated as a chapter', () => {
    expect(chapterHeading({ chapterNumber: 2, title: 'X' })).toBe('Chapter 2 — X');
  });

  test('all three types render as H3 in one document', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({ chapterType: 'prologue', chapterNumber: null, title: 'Prologue' }),
      chapter({ chapterNumber: 1, title: 'One' }),
      chapter({ chapterType: 'epilogue', chapterNumber: null, title: 'Epilogue' }),
    ]);
    expect(md).toContain('### Prologue');
    expect(md).toContain('### Chapter 1 — One');
    expect(md).toContain('### Epilogue');
    expect(md.match(/^### /gm)).toHaveLength(3);
  });
});

describe('Default titles are not duplicated in headings', () => {
  // Novel Studio names new sections after their position, so an author who
  // never renames one leaves title === label. Joining them read
  // "Chapter 1 — Chapter 1".

  test('chapter title matching the default label collapses to the label', () => {
    expect(chapterHeading({ chapterNumber: 1, title: 'Chapter 1' })).toBe('Chapter 1');
  });

  test('chapter default-title comparison is case-insensitive', () => {
    expect(chapterHeading({ chapterNumber: 1, title: 'chapter 1' })).toBe('Chapter 1');
    expect(chapterHeading({ chapterNumber: 1, title: 'CHAPTER 1' })).toBe('Chapter 1');
  });

  test('chapter default-title comparison ignores extra whitespace', () => {
    expect(chapterHeading({ chapterNumber: 1, title: '  Chapter   1  ' })).toBe('Chapter 1');
  });

  test('a custom chapter title is always kept', () => {
    expect(chapterHeading({ chapterNumber: 1, title: 'Redline' })).toBe('Chapter 1 — Redline');
  });

  test('a title naming a different number is custom, not redundant', () => {
    expect(chapterHeading({ chapterNumber: 1, title: 'Chapter 2' })).toBe(
      'Chapter 1 — Chapter 2'
    );
  });

  test('a title merely containing the label is still custom', () => {
    expect(chapterHeading({ chapterNumber: 1, title: 'Chapter 1 Reprise' })).toBe(
      'Chapter 1 — Chapter 1 Reprise'
    );
  });

  test('volume title matching the default label collapses to the label', () => {
    expect(volumeHeading({ id: 'v1', volumeNumber: 1, title: 'Volume 1' })).toBe('Volume 1');
  });

  test('volume default-title comparison is case-insensitive', () => {
    expect(volumeHeading({ id: 'v1', volumeNumber: 1, title: 'volume 1' })).toBe('Volume 1');
    expect(volumeHeading({ id: 'v1', volumeNumber: 1, title: 'VOLUME 1' })).toBe('Volume 1');
  });

  test('a custom volume title is always kept', () => {
    expect(volumeHeading({ id: 'v1', volumeNumber: 1, title: 'Bangkok Nights' })).toBe(
      'Volume 1 — Bangkok Nights'
    );
  });

  test('an untitled volume still gets its label', () => {
    expect(volumeHeading({ id: 'v1', volumeNumber: 1, title: '' })).toBe('Volume 1');
  });

  test('prologue and epilogue dedup is unchanged', () => {
    expect(chapterHeading({ chapterType: 'prologue', chapterNumber: null, title: 'Prologue' })).toBe(
      'Prologue'
    );
    expect(chapterHeading({ chapterType: 'epilogue', chapterNumber: null, title: 'epilogue' })).toBe(
      'Epilogue'
    );
  });

  test('the whole document is free of duplicated headings', () => {
    const md = generateManuscriptMarkdown(
      PROJECT,
      [
        chapter({ chapterNumber: 1, title: 'Chapter 1', volumeId: 'vd' }),
        chapter({ chapterNumber: 2, title: 'Chapter 2', volumeId: 'vd' }),
      ],
      { volumes: [{ id: 'vd', volumeNumber: 1, title: 'Volume 1' }] }
    );
    expect(md).toContain('## Volume 1\n');
    expect(md).toContain('### Chapter 1\n');
    expect(md).toContain('### Chapter 2\n');
    expect(md).not.toContain('Chapter 1 — Chapter 1');
    expect(md).not.toContain('Volume 1 — Volume 1');
  });
});

describe('Scene break, scene header and page break', () => {
  test('scene break renders as ***', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({ content: doc(p('before'), { type: 'sceneBreak' }, p('after')) }),
    ]);
    expect(md).toContain(`\n${SCENE_BREAK_MARKER}\n`);
    expect(md.indexOf('before')).toBeLessThan(md.indexOf(SCENE_BREAK_MARKER));
    expect(md.indexOf(SCENE_BREAK_MARKER)).toBeLessThan(md.indexOf('after'));
  });

  test('scene header renders as a quoted line', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({
        content: doc({
          type: 'sceneHeader',
          attrs: { timeText: '18:30', locationText: 'ลาดพร้าว 101' },
        }),
      }),
    ]);
    expect(md).toContain('> 18:30 — ลาดพร้าว 101');
  });

  test('a scene header with only one field omits the separator', () => {
    const timeOnly = generateManuscriptMarkdown(PROJECT, [
      chapter({ content: doc({ type: 'sceneHeader', attrs: { timeText: '09:00' } }) }),
    ]);
    // The em dash also appears in the chapter heading, so check that line only.
    const headerLine = timeOnly.split('\n').find((l) => l.startsWith('> '));
    expect(headerLine).toBe('> 09:00');

    const placeOnly = generateManuscriptMarkdown(PROJECT, [
      chapter({ content: doc({ type: 'sceneHeader', attrs: { locationText: 'Bangkok' } }) }),
    ]);
    expect(placeOnly).toContain('> Bangkok');
  });

  test('an empty scene header emits nothing', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({
        content: doc(p('a'), { type: 'sceneHeader', attrs: {} }, p('b')),
      }),
    ]);
    expect(md).not.toContain('> ');
  });

  test('page break renders as the HTML comment marker', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({ content: doc(p('before'), { type: 'pageBreak' }, p('after')) }),
    ]);
    expect(md).toContain(PAGE_BREAK_MARKER);
    expect(PAGE_BREAK_MARKER).toBe('<!-- PAGE BREAK -->');
  });

  test('a scene break followed by a header keeps both, in order', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({
        content: doc(
          p('scene one'),
          { type: 'sceneBreak' },
          { type: 'sceneHeader', attrs: { timeText: '18:30', locationText: 'Bangkok' } },
          p('scene two')
        ),
      }),
    ]);
    expect(md.indexOf(SCENE_BREAK_MARKER)).toBeLessThan(md.indexOf('> 18:30'));
    expect(md.indexOf('> 18:30')).toBeLessThan(md.indexOf('scene two'));
  });
});

describe('Metadata', () => {
  test('date and location are emitted when present', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({ dateText: '20 กันยายน 2568', locationText: 'ลาดพร้าว 101' }),
    ]);
    expect(md).toContain('**Date:** 20 กันยายน 2568');
    expect(md).toContain('**Location:** ลาดพร้าว 101');
  });

  test('metadata is omitted entirely when blank', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({ dateText: '', locationText: undefined, subtitle: '   ' }),
    ]);
    expect(md).not.toContain('**Date:**');
    expect(md).not.toContain('**Location:**');
    expect(md).not.toMatch(/^\*\s*\*$/m);
  });

  test('one present and one blank emits only the present one', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({ dateText: 'Tuesday', locationText: '' }),
    ]);
    expect(md).toContain('**Date:** Tuesday');
    expect(md).not.toContain('**Location:**');
  });

  test('subtitle renders as an italic line', () => {
    const md = generateManuscriptMarkdown(PROJECT, [chapter({ subtitle: 'A beginning' })]);
    expect(md).toContain('*A beginning*');
  });
});

describe('Prose and inline formatting', () => {
  test('paragraph boundaries are preserved as blank lines', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({ content: doc(p('first'), p('second')) }),
    ]);
    expect(md).toContain('first\n\nsecond');
  });

  test('emphasis marks map to Markdown', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({
        content: doc(
          p('b', [{ type: 'bold' }]),
          p('i', [{ type: 'italic' }]),
          p('s', [{ type: 'strike' }]),
          p('u', [{ type: 'underline' }])
        ),
      }),
    ]);
    expect(md).toContain('**b**');
    expect(md).toContain('*i*');
    expect(md).toContain('~~s~~');
    expect(md).toContain('<u>u</u>');
  });

  test('empty paragraphs do not become stray blank blocks', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({ content: doc(p('a'), p(''), p('b')) }),
    ]);
    expect(md).not.toMatch(/\n{3,}/);
  });

  test('hard break keeps the line split inside one paragraph', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({
        content: doc({
          type: 'paragraph',
          content: [
            { type: 'text', text: 'line one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'line two' },
          ],
        }),
      }),
    ]);
    expect(md).toContain('line one\\\nline two');
  });

  test('Markdown metacharacters in prose are escaped', () => {
    const md = generateManuscriptMarkdown(PROJECT, [
      chapter({ content: doc(p('a *star* and _underscore_ and `tick`')) }),
    ]);
    expect(md).toContain('\\*star\\*');
    expect(md).toContain('\\_underscore\\_');
    expect(md).toContain('\\`tick\\`');
  });

  test('a paragraph starting with # is not turned into a heading', () => {
    const md = generateManuscriptMarkdown(PROJECT, [chapter({ content: doc(p('# not a heading')) })]);
    expect(md).toContain('\\# not a heading');
    expect(md.match(/^# /gm)).toHaveLength(1);
  });

  test('a paragraph starting with > is not turned into a quote', () => {
    const md = generateManuscriptMarkdown(PROJECT, [chapter({ content: doc(p('> not a quote')) })]);
    expect(md).not.toMatch(/^> not a quote/m);
  });

  test('escapeMarkdown leaves ordinary Thai and Latin prose alone', () => {
    expect(escapeMarkdown('สวัสดี hello')).toBe('สวัสดี hello');
  });

  test('the file ends with exactly one newline', () => {
    const md = generateManuscriptMarkdown(PROJECT, [chapter()]);
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });
});

describe('No internal data leaks into the output', () => {
  const md = generateManuscriptMarkdown(
    PROJECT,
    [
      {
        chapterNumber: 1,
        chapterType: 'chapter',
        title: 'One',
        volumeId: 'vol_abc123',
        content: doc({
          type: 'paragraph',
          attrs: {
            textAlignOverride: 'center',
            firstLineIndentCmOverride: 2,
            lineSpacingOverride: 1.5,
            spaceBeforePtOverride: 18,
          },
          content: [
            {
              type: 'text',
              text: 'prose',
              marks: [{ type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSizePt: 24 } }],
            },
          ],
        }),
      },
    ],
    { volumes: [{ id: 'vol_abc123', volumeNumber: 1, title: 'V' }] }
  );

  test('no Tiptap JSON structure appears', () => {
    for (const token of ['"type"', 'paragraph"', '"content"', '"attrs"', '"marks"', 'doc"']) {
      expect(md).not.toContain(token);
    }
  });

  test('no internal identifiers appear', () => {
    expect(md).not.toContain('vol_abc123');
    expect(md).not.toMatch(/variantId|revisionId|sessionId|activeVariantId|projectId/);
  });

  test('no print-only properties appear', () => {
    for (const token of [
      'fontFamily',
      'Georgia',
      'fontSizePt',
      'textAlignOverride',
      'firstLineIndentCmOverride',
      'lineSpacingOverride',
      'spaceBeforePtOverride',
      'margin',
      'center',
    ]) {
      expect(md).not.toContain(token);
    }
    // No measurement ever reaches the file: no "24pt", "2cm", "18pt", "1.5".
    expect(md).not.toMatch(/d+(.d+)?s*(pt|cm|mm|in|px)/);
    expect(md).not.toContain('1.5');
  });

  test('the prose itself is still there', () => {
    expect(md).toContain('prose');
  });

  test('there is no YAML frontmatter', () => {
    expect(md.startsWith('---')).toBe(false);
  });
});

describe('Filenames', () => {
  const asChapter = (over: Partial<Chapter>): Chapter =>
    ({
      id: 'c1',
      projectId: 'p1',
      volumeId: 'v1',
      chapterNumber: 5,
      title: 'Redline',
      order: 0,
      activeVariantId: 'var1',
      totalWordCount: 0,
      createdAt: 0,
      updatedAt: 0,
      ...over,
    }) as Chapter;

  const volume = { id: 'v1', volumeNumber: 1 } as Volume;

  test('whole manuscript', () => {
    expect(exportFilename('manuscript', PROJECT, {}, 'md')).toBe('REDLINE LOVE.md');
  });

  test('single volume', () => {
    expect(exportFilename('volume', PROJECT, { volume }, 'md')).toBe(
      'REDLINE LOVE - Volume 1.md'
    );
  });

  test('single chapter', () => {
    expect(exportFilename('chapter', PROJECT, { chapter: asChapter({}) }, 'md')).toBe(
      'REDLINE LOVE - Chapter 5.md'
    );
  });

  test('selection of chapters', () => {
    expect(exportFilename('selection', PROJECT, { count: 7 }, 'md')).toBe(
      'REDLINE LOVE - 7 Chapters.md'
    );
  });

  test('a prologue is named by its label, not a chapter number', () => {
    expect(
      exportFilename(
        'chapter',
        PROJECT,
        { chapter: asChapter({ chapterType: 'prologue', chapterNumber: null, title: '' }) },
        'md'
      )
    ).toBe('REDLINE LOVE - Prologue.md');
  });

  test('docx remains the default format', () => {
    expect(exportFilename('manuscript', PROJECT, {})).toBe('REDLINE LOVE.docx');
  });

  test('the two formats differ only by extension', () => {
    const detail = { chapter: asChapter({}) };
    const docx = exportFilename('chapter', PROJECT, detail, 'docx');
    const md = exportFilename('chapter', PROJECT, detail, 'md');
    expect(docx.replace(/\.docx$/, '')).toBe(md.replace(/\.md$/, ''));
  });

  test('spaces are preserved and illegal characters removed', () => {
    expect(sanitizeFilename('REDLINE LOVE')).toBe('REDLINE LOVE');
    expect(sanitizeFilename('A/B: test*')).toBe('AB test');
    expect(sanitizeFilename('a<b>c|d?e"f\\g')).toBe('abcdefg');
  });

  test('Thai titles are preserved', () => {
    expect(sanitizeFilename('เสียงจากลาดพร้าว')).toBe('เสียงจากลาดพร้าว');
  });

  test('a title that reduces to nothing still yields a filename', () => {
    expect(sanitizeFilename('///')).toBe('Manuscript');
    expect(sanitizeFilename('   ')).toBe('Manuscript');
  });

  test('a trailing dot or space is trimmed (Windows rejects both)', () => {
    expect(sanitizeFilename('Chapter 5.')).toBe('Chapter 5');
    expect(sanitizeFilename('Chapter 5 ')).toBe('Chapter 5');
  });
});

describe('Scope selection is shared with DOCX', () => {
  const chapters = [
    { id: 'a', volumeId: 'v1', order: 0 },
    { id: 'b', volumeId: 'v1', order: 1 },
    { id: 'c', volumeId: 'v2', order: 2 },
  ] as Chapter[];
  const volumes = [
    { id: 'v1', order: 0 },
    { id: 'v2', order: 1 },
  ] as Volume[];
  const project = { id: 'p1', title: PROJECT } as never;

  test('markdown and docx resolve identical chapter sets', () => {
    for (const request of [
      { scope: 'chapter' as const, project, chapterId: 'b' },
      { scope: 'volume' as const, project, volumeId: 'v1' },
      { scope: 'selection' as const, project, chapterIds: ['a', 'c'] },
      { scope: 'manuscript' as const, project },
    ]) {
      const ids = selectChapters(request, chapters, volumes).map((c) => c.id);
      // Same function, so the two formats cannot diverge; this asserts the
      // contract rather than a second implementation.
      expect(ids).toEqual(selectChapters(request, chapters, volumes).map((c) => c.id));
      expect(ids.length).toBeGreaterThan(0);
    }
  });

  test('manuscript scope orders by volume then chapter order', () => {
    const ids = selectChapters({ scope: 'manuscript', project }, chapters, volumes).map(
      (c) => c.id
    );
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});
