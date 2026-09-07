import { describe, expect, test } from 'vitest';
import { renderTiptapToSafeHtml } from '@/lib/publishing/render';
import { makeSlug } from '@/lib/publishing/slug';

function para(text: string, attrs: Record<string, unknown> = {}) {
  return { type: 'paragraph', attrs, content: [{ type: 'text', text }] };
}

describe('C2 — controlled Tiptap renderer', () => {
  test('escapes HTML metacharacters in prose', () => {
    const html = renderTiptapToSafeHtml({
      type: 'doc',
      content: [para('Hello <script>alert(1)</script> & "friends"')],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  test('drops unknown node types entirely', () => {
    const html = renderTiptapToSafeHtml({
      type: 'doc',
      content: [
        { type: 'iframe', attrs: { src: 'https://evil.example' } },
        para('kept'),
      ],
    } as never);
    expect(html).not.toContain('iframe');
    expect(html).not.toContain('evil.example');
    expect(html).toContain('kept');
  });

  test('drops unknown marks but keeps their text', () => {
    const html = renderTiptapToSafeHtml({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'clickme', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          ],
        },
      ],
    } as never);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<a');
    expect(html).toContain('clickme');
  });

  test('preserves allowed inline marks', () => {
    const html = renderTiptapToSafeHtml({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'i', marks: [{ type: 'italic' }] },
            { type: 'text', text: 'u', marks: [{ type: 'underline' }] },
            { type: 'text', text: 's', marks: [{ type: 'strike' }] },
          ],
        },
      ],
    } as never);
    expect(html).toContain('<strong>b</strong>');
    expect(html).toContain('<em>i</em>');
    expect(html).toContain('<u>u</u>');
    expect(html).toContain('<s>s</s>');
  });

  test('renders semantic breaks as markup, not literal placeholder text', () => {
    const html = renderTiptapToSafeHtml({
      type: 'doc',
      content: [para('before'), { type: 'sceneBreak' }, { type: 'pageBreak' }, para('after')],
    } as never);
    expect(html).toContain('novel-scene-break');
    expect(html).toContain('novel-page-break');
    expect(html).not.toContain('[PAGE BREAK]');
  });

  test('alignment attribute is emitted only from a fixed allow-list', () => {
    const ok = renderTiptapToSafeHtml({
      type: 'doc',
      content: [para('x', { textAlign: 'center' })],
    } as never);
    expect(ok).toContain('align-center');

    const bad = renderTiptapToSafeHtml({
      type: 'doc',
      content: [para('x', { textAlign: '"><script>alert(1)</script>' })],
    } as never);
    expect(bad).not.toContain('<script>');
    expect(bad).not.toContain('align-"');
  });

  test('attribute-injection attempts in text cannot break out of a tag', () => {
    const html = renderTiptapToSafeHtml({
      type: 'doc',
      content: [para('" onmouseover="alert(1)')],
    } as never);
    // The payload survives as visible prose, which is correct — an author may
    // legitimately write that string. What matters is that both quotes are
    // escaped, so no attribute boundary can be formed inside the <p> tag.
    expect(html).toBe('<p>&quot; onmouseover=&quot;alert(1)</p>');
    expect(html).not.toMatch(/<p[^>]*onmouseover/);
  });

  test('handles Thai prose without corruption', () => {
    const thai = 'เสียงจากลาดพร้าว ๑๐๑';
    const html = renderTiptapToSafeHtml({ type: 'doc', content: [para(thai)] } as never);
    expect(html).toContain(thai);
  });

  test('deeply nested content does not recurse without bound', () => {
    let node: Record<string, unknown> = { type: 'paragraph', content: [{ type: 'text', text: 'deep' }] };
    for (let i = 0; i < 200; i++) node = { type: 'blockquote', content: [node] };
    expect(() => renderTiptapToSafeHtml({ type: 'doc', content: [node] } as never)).not.toThrow();
  });
});

describe('C6 — Unicode-safe, collision-resistant slugs', () => {
  test('ASCII titles slugify normally', () => {
    expect(makeSlug('The Long Road')).toBe('the-long-road');
  });

  test('Thai titles produce a real slug, not a timestamp fallback', () => {
    const slug = makeSlug('เสียงจากลาดพร้าว');
    expect(slug).toContain('เสียงจากลาดพร้าว');
    expect(slug).not.toMatch(/^novel-\d+$/);
  });

  test('mixed Thai and Latin is preserved', () => {
    expect(makeSlug('บทที่ 1 Prologue')).toBe('บทที่-1-prologue');
  });

  test('path separators and traversal sequences are stripped', () => {
    const slug = makeSlug('../../projects/evil');
    expect(slug).not.toContain('/');
    expect(slug).not.toContain('..');
  });

  test('reserved Firestore-hostile characters are removed', () => {
    for (const ch of ['/', '\\', '.', '#', '[', ']', '*', '?']) {
      expect(makeSlug(`a${ch}b`)).not.toContain(ch);
    }
  });

  test('a title that reduces to nothing still yields a usable slug', () => {
    expect(makeSlug('///...///').length).toBeGreaterThan(0);
  });

  test('slug length is bounded', () => {
    expect(makeSlug('x'.repeat(500)).length).toBeLessThanOrEqual(80);
  });

  test('slugs are stable for the same input', () => {
    expect(makeSlug('The Long Road')).toBe(makeSlug('The Long Road'));
  });
});
