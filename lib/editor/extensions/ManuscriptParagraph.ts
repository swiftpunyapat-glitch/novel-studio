import Paragraph from '@tiptap/extension-paragraph';
import { mergeAttributes } from '@tiptap/core';
import { paragraphOverrideStyle } from '@/lib/format/effective';

/**
 * Paragraph node that renders explicit overrides as inline style. (Stage 3C)
 *
 * The override attributes themselves are declared by ParagraphFormatExtension
 * as global attributes, which round-trip through `data-*`. Those alone are not
 * visible, and a per-attribute `renderHTML` cannot emit a combined `style`
 * without the individual results overwriting one another.
 *
 * So the node computes the whole style once, from all attributes together:
 *
 *   - a set override becomes an inline declaration, which beats the canvas
 *     CSS variables and therefore survives a project-default change
 *   - an unset (null) override emits nothing, so the paragraph keeps
 *     inheriting `--novel-*` from the canvas
 */
export const ManuscriptParagraph = Paragraph.extend({
  name: 'paragraph',

  renderHTML({ HTMLAttributes, node }) {
    const style = paragraphOverrideStyle(node.attrs as Record<string, unknown>);

    const declarations = Object.entries(style)
      .map(([property, value]) => {
        // camelCase -> kebab-case for CSS.
        const cssProperty = property.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        return `${cssProperty}: ${value}`;
      })
      .join('; ');

    return [
      'p',
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        declarations ? { style: declarations } : {}
      ),
      0,
    ];
  },
});
