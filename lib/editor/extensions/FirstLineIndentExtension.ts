import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    firstLineIndent: {
      toggleFirstLineIndent: () => ReturnType;
      setFirstLineIndent: (enabled: boolean) => ReturnType;
    };
  }
}

export const FirstLineIndentExtension = Extension.create({
  name: 'firstLineIndent',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          noIndent: {
            default: false,
            parseHTML: (element) => element.classList.contains('no-indent'),
            renderHTML: (attributes) => {
              if (attributes.noIndent) {
                return { class: 'no-indent' };
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
      toggleFirstLineIndent:
        () =>
        ({ commands, editor }) => {
          const current = editor.getAttributes('paragraph').noIndent;
          return commands.updateAttributes('paragraph', { noIndent: !current });
        },
      setFirstLineIndent:
        (enabled: boolean) =>
        ({ commands }) => {
          return commands.updateAttributes('paragraph', { noIndent: !enabled });
        },
    };
  },
});
