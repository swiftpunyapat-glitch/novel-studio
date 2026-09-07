import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sceneBreak: {
      insertSceneBreak: () => ReturnType;
    };
  }
}

export const SceneBreakExtension = Node.create({
  name: 'sceneBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [
      {
        tag: 'div[data-type="scene-break"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'scene-break',
        class: 'novel-scene-break',
      }),
      '***',
    ];
  },

  addCommands() {
    return {
      insertSceneBreak:
        () =>
        ({ chain }) => {
          return chain()
            .insertContent({ type: this.name })
            .createParagraphNear()
            .run();
        },
    };
  },
});
