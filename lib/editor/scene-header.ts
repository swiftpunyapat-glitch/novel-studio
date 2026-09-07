/**
 * Scene header value semantics. (Stage 4C)
 *
 * Deliberately dependency-free. The Tiptap node lives in
 * `extensions/SceneHeaderExtension.ts`, but DOCX export, published HTML and
 * plain-text projection all run on the server and must not drag the editor
 * runtime in just to read two strings. Keeping the rules here is also what
 * stops the three consumers from joining time and location differently.
 */

export interface SceneHeaderAttrs {
  timeText: string | null;
  locationText: string | null;
}

/** The separator between time and location when both are present. */
export const SCENE_HEADER_SEPARATOR = ' — ';

/** Blank and whitespace-only values are stored as null, never as "". */
export function normalizeSceneHeaderField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeSceneHeaderAttrs(
  header: Partial<SceneHeaderAttrs> | null | undefined
): SceneHeaderAttrs {
  return {
    timeText: normalizeSceneHeaderField(header?.timeText),
    locationText: normalizeSceneHeaderField(header?.locationText),
  };
}

/** True when a header would carry no information and should not be inserted. */
export function isEmptySceneHeader(
  header: Partial<SceneHeaderAttrs> | null | undefined
): boolean {
  const { timeText, locationText } = normalizeSceneHeaderAttrs(header);
  return timeText === null && locationText === null;
}

/**
 * One-line projection used by plain text, DOCX and search.
 *
 * Either field may be absent, so all three of "18:30 — Bangkok", "18:30" and
 * "Bangkok" are valid renderings, and an empty header renders as nothing.
 */
export function sceneHeaderToText(
  header: Partial<SceneHeaderAttrs> | null | undefined
): string {
  const { timeText, locationText } = normalizeSceneHeaderAttrs(header);
  return [timeText, locationText].filter(Boolean).join(SCENE_HEADER_SEPARATOR);
}
