import { Extension } from '@tiptap/core';
import {
  EMPTY_PARAGRAPH_OVERRIDES,
  PARAGRAPH_OVERRIDE_KEYS,
  isAlignment,
  paragraphOverrideStyle,
  type Alignment,
  type ParagraphOverrides,
} from '@/lib/format/effective';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphFormat: {
      /** Applies a partial set of overrides; null clears one back to inherit. */
      setParagraphFormat: (overrides: Partial<ParagraphOverrides>) => ReturnType;
      /** Removes every override so the paragraph inherits project defaults. */
      resetParagraphFormat: () => ReturnType;
      setParagraphAlignment: (alignment: Alignment | null) => ReturnType;
      /** Word-style indent stepping, in 0.5cm steps, clamped at 0. */
      adjustLeftIndent: (deltaCm: number) => ReturnType;
    };
  }
}

const INDENT_STEP_CM = 0.5;
const MAX_LEFT_INDENT_CM = 10;

/**
 * Tri-state paragraph formatting. (Stage 3A)
 *
 * Every attribute defaults to `null`, meaning "inherit the project default".
 * A stored value means the author explicitly overrode it — including `0`, which
 * is a real override (e.g. "no first-line indent") and must never be treated as
 * absent.
 *
 * The previous extensions declared non-null defaults (`lineSpacing: 1.08`,
 * `noIndent: false`), which ProseMirror then serialised onto every paragraph,
 * permanently baking the project default into the manuscript.
 */
export const ParagraphFormatExtension = Extension.create({
  name: 'paragraphFormat',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: Object.fromEntries(
          PARAGRAPH_OVERRIDE_KEYS.map((key) => [
            key,
            {
              default: EMPTY_PARAGRAPH_OVERRIDES[key],
              // Overrides live in the document model, not in parsed HTML.
              parseHTML: (element: HTMLElement) => {
                const raw = element.getAttribute(`data-${key}`);
                if (raw === null || raw === '') return null;
                if (key === 'textAlignOverride') return isAlignment(raw) ? raw : null;
                const n = Number(raw);
                return Number.isFinite(n) ? n : null;
              },
              renderHTML: (attrs: Record<string, unknown>) => {
                const value = attrs[key];
                if (value === null || value === undefined) return {};
                return { [`data-${key}`]: String(value) };
              },
            },
          ])
        ),
      },
    ];
  },

  addCommands() {
    return {
      setParagraphFormat:
        (overrides) =>
        ({ commands }) =>
          commands.updateAttributes('paragraph', overrides),

      resetParagraphFormat:
        () =>
        ({ commands }) =>
          commands.updateAttributes('paragraph', { ...EMPTY_PARAGRAPH_OVERRIDES }),

      setParagraphAlignment:
        (alignment) =>
        ({ commands }) =>
          commands.updateAttributes('paragraph', { textAlignOverride: alignment }),

      adjustLeftIndent:
        (deltaCm) =>
        ({ editor, commands }) => {
          const current = editor.getAttributes('paragraph').leftIndentCmOverride;
          const base = typeof current === 'number' ? current : 0;
          const next = Math.min(
            MAX_LEFT_INDENT_CM,
            Math.max(0, Number((base + deltaCm).toFixed(3)))
          );
          // Returning to 0 clears the override rather than storing a zero.
          return commands.updateAttributes('paragraph', {
            leftIndentCmOverride: next === 0 ? null : next,
          });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-]': () => this.editor.commands.adjustLeftIndent(INDENT_STEP_CM),
      'Mod-[': () => this.editor.commands.adjustLeftIndent(-INDENT_STEP_CM),
      'Mod-Shift-l': () => this.editor.commands.setParagraphAlignment('left'),
      'Mod-Shift-e': () => this.editor.commands.setParagraphAlignment('center'),
      'Mod-Shift-r': () => this.editor.commands.setParagraphAlignment('right'),
      'Mod-Shift-j': () => this.editor.commands.setParagraphAlignment('justify'),
    };
  },
});

export { paragraphOverrideStyle, INDENT_STEP_CM };
