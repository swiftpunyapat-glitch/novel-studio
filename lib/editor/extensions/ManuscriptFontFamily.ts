import FontFamily from '@tiptap/extension-font-family';
import { canonicalFontName, fontCssStack } from '@/lib/editor/fonts';

/**
 * Run-level font family with a split between stored and displayed value.
 * (Stage 4A)
 *
 * Tiptap's stock `FontFamily` renders the attribute straight into
 * `style="font-family: …"`. That is wrong for this manuscript model in both
 * directions:
 *
 *   - Rendering "TH Sarabun New" with no fallback means a machine without the
 *     font shows the browser's default serif instead of the canvas stack.
 *   - Parsing a pasted `font-family: 'TH Sarabun New', sans-serif` would store
 *     the whole CSS stack as the run's font, and Word would then look that
 *     entire string up as one family name and silently substitute.
 *
 * So the stored attribute stays a canonical family name — the value DOCX
 * export writes — while the DOM gets a display stack with fallbacks. The
 * fallback is presentation; it never reaches the manuscript.
 */
export const ManuscriptFontFamily = FontFamily.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              canonicalFontName(element.style.fontFamily),
            renderHTML: (attributes: Record<string, unknown>) => {
              const family = canonicalFontName(attributes.fontFamily as string);
              if (!family) return {};
              return { style: `font-family: ${fontCssStack(family)}` };
            },
          },
        },
      },
    ];
  },
});
