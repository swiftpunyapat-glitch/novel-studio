import { Node, mergeAttributes } from '@tiptap/core';
import {
  SCENE_HEADER_SEPARATOR,
  isEmptySceneHeader,
  normalizeSceneHeaderAttrs,
  normalizeSceneHeaderField,
  type SceneHeaderAttrs,
} from '@/lib/editor/scene-header';

/**
 * Semantic scene header. (Stage 4C)
 *
 * A scene break says "the scene changes". A scene header says *when* and
 * *where* the next one happens:
 *
 *     ***
 *     18:30 — Bangkok
 *
 * Both fields are optional and independent, so `18:30`, `Bangkok` and
 * `18:30 — Bangkok` are all valid, and a bare scene break stays valid too.
 *
 * Why a node rather than a typed line of prose:
 *
 *   - The values stay addressable. A paragraph reading "18:30 — Bangkok" is
 *     indistinguishable from dialogue to every consumer; `{ timeText,
 *     locationText }` is not, which is what makes later canon and timeline
 *     analysis possible without parsing prose.
 *   - Reader HTML and DOCX can style it as a scene header instead of inheriting
 *     body-paragraph indentation.
 *   - It survives a round trip through manuscript JSON unchanged.
 *
 * This is scene-level metadata and is deliberately separate from Chapter
 * metadata (`dateText` / `locationText` on the Chapter document), which
 * describes the chapter as a whole. Nothing here is ever inferred: the author
 * types both fields, or leaves them empty.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sceneHeader: {
      /**
       * Inserts a scene break, optionally followed by a scene header, then a
       * fresh paragraph for the new scene.
       */
      insertSceneBreakWithHeader: (header?: Partial<SceneHeaderAttrs> | null) => ReturnType;
      /** Rewrites the attributes of the currently selected scene header. */
      updateSceneHeader: (header: Partial<SceneHeaderAttrs>) => ReturnType;
    };
  }
}

export const SceneHeaderExtension = Node.create({
  name: 'sceneHeader',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      timeText: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          normalizeSceneHeaderField(element.getAttribute('data-time')),
        renderHTML: (attributes: Record<string, unknown>) => {
          const value = normalizeSceneHeaderField(attributes.timeText);
          return value ? { 'data-time': value } : {};
        },
      },
      locationText: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          normalizeSceneHeaderField(element.getAttribute('data-location')),
        renderHTML: (attributes: Record<string, unknown>) => {
          const value = normalizeSceneHeaderField(attributes.locationText);
          return value ? { 'data-location': value } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="scene-header"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const { timeText, locationText } = normalizeSceneHeaderAttrs(
      node.attrs as Partial<SceneHeaderAttrs>
    );

    const children: unknown[] = [];
    if (timeText) children.push(['span', { class: 'scene-header-time' }, timeText]);
    if (timeText && locationText) {
      children.push(['span', { class: 'scene-header-sep' }, SCENE_HEADER_SEPARATOR]);
    }
    if (locationText) {
      children.push(['span', { class: 'scene-header-location' }, locationText]);
    }

    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'scene-header',
        class: 'novel-scene-header',
      }),
      ...children,
    ] as never;
  },

  addCommands() {
    return {
      insertSceneBreakWithHeader:
        (header) =>
        ({ chain }) => {
          const attrs = normalizeSceneHeaderAttrs(header);
          const nodes: Array<Record<string, unknown>> = [{ type: 'sceneBreak' }];

          if (!isEmptySceneHeader(attrs)) {
            nodes.push({ type: this.name, attrs });
          }

          return chain().insertContent(nodes).createParagraphNear().run();
        },

      updateSceneHeader:
        (header) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, normalizeSceneHeaderAttrs(header)),
    };
  },
});
