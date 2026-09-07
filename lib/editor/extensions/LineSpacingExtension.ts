import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lineSpacing: {
      setLineSpacing: (spacing: number) => ReturnType;
    };
  }
}

export const LineSpacingExtension = Extension.create({
  name: 'lineSpacing',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          lineSpacing: {
            default: 1.08,
            parseHTML: (element) => parseFloat(element.style.lineHeight) || 1.08,
            renderHTML: (attributes) => {
              if (attributes.lineSpacing && attributes.lineSpacing !== 1.08) {
                return { style: `line-height: ${attributes.lineSpacing}` };
              }
              return {};
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineSpacing:
        (spacing: number) =>
        ({ commands }) => {
          return commands.updateAttributes('paragraph', { lineSpacing: spacing });
        },
    };
  },
});
