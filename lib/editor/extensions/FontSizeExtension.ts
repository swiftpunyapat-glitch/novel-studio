import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      /** Sets an explicit run font size in points; null clears the override. */
      setFontSizePt: (pt: number | null) => ReturnType;
    };
  }
}

/**
 * Run-level font size override, stored on the `textStyle` mark. (Stage 3A/3D)
 *
 * Tiptap ships `FontFamily` for `textStyle` but has no point-size equivalent,
 * so this adds one. The unit is points, matching both the project settings and
 * DOCX, so no conversion is needed at export time.
 *
 * `null` means inherit `documentSettings.bodyFontSizePt`. The project default
 * is deliberately never written onto a run.
 */
export const FontSizeExtension = Extension.create({
  name: 'fontSize',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSizePt: {
            default: null,
            parseHTML: (element) => {
              const raw = element.style.fontSize;
              if (!raw) return null;
              const match = /^([\d.]+)pt$/.exec(raw.trim());
              if (!match) return null;
              const value = Number(match[1]);
              return Number.isFinite(value) && value > 0 ? value : null;
            },
            renderHTML: (attributes) => {
              const value = attributes.fontSizePt;
              if (typeof value !== 'number' || !Number.isFinite(value)) return {};
              return { style: `font-size: ${value}pt` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSizePt:
        (pt) =>
        ({ chain }) => {
          if (pt === null) {
            return chain().setMark('textStyle', { fontSizePt: null }).removeEmptyTextStyle().run();
          }
          return chain().setMark('textStyle', { fontSizePt: pt }).run();
        },
    };
  },
});

/** Sizes offered in the toolbar. Authors may still hold other values. */
export const FONT_SIZE_OPTIONS = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32] as const;
