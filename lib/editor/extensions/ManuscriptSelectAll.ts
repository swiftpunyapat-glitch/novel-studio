import { Extension } from '@tiptap/core';

/**
 * Ctrl/Cmd+A selects the manuscript, and only the manuscript. (Stage 4B)
 *
 * ProseMirror's base keymap binds `Mod-a` to `selectAll` already, but that is a
 * dependency's default rather than a promise this application makes. Stating it
 * here means the behaviour is owned, discoverable next to the other manuscript
 * keybindings, and covered by `tests/unit/select-all.test.ts`.
 *
 * Returning `true` is the part that matters: the handler reports the key as
 * consumed, so the browser never runs its own "select the whole document".
 *
 * This binding fires only while the editor has focus. A rename box, a metadata
 * field or a dialog input keeps its native Ctrl+A because ProseMirror's keymap
 * is not listening there at all. See `lib/editor/select-all.ts` for the case
 * where focus is in the writing pane but outside the editor.
 */
export const ManuscriptSelectAll = Extension.create({
  name: 'manuscriptSelectAll',

  addKeyboardShortcuts() {
    return {
      'Mod-a': () => this.editor.commands.selectAll(),
    };
  },
});
