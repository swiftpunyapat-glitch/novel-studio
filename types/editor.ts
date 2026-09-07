export type EditorTheme = 'light' | 'dark' | 'system';

export interface UserPreferences {
  appearanceTheme: EditorTheme;
  editorWidthMode: 'a5-page' | 'continuous-focus';
  customUiScale: number;
  updatedAt: number;
}

/**
 * Autosave state machine states. (Stage 2E)
 *
 * `dirty`  — edited locally, mirrored, not yet sent
 * `conflict` — another device advanced this variant; awaiting the author
 */
export type AutosaveStatus =
  | 'saved'
  | 'dirty'
  | 'saving'
  | 'offline_pending'
  | 'conflict'
  | 'error';
