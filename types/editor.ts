export type EditorTheme = 'light' | 'dark' | 'system';

export interface UserPreferences {
  appearanceTheme: EditorTheme;
  editorWidthMode: 'a5-page' | 'continuous-focus';
  customUiScale: number;
  updatedAt: number;
}

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'offline_pending' | 'error';
