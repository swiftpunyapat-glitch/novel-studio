export interface DocumentSettings {
  paperSize: 'A5';
  margins: {
    topMm: number;
    bottomMm: number;
    leftMm: number;
    rightMm: number;
  };
  bodyFont: string;
  bodyFontSizePt: number;
  paragraphAlignment: 'left' | 'justify' | 'center' | 'right';
  firstLineIndentCm: number;
  paragraphSpacingBeforePt: number;
  paragraphSpacingAfterPt: number;
  lineSpacingType: 'multiple';
  lineSpacingMultiplier: number;
  sceneBreakSymbol: string;
}

export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettings = {
  paperSize: 'A5',
  margins: {
    topMm: 20,
    bottomMm: 20,
    leftMm: 20,
    rightMm: 20,
  },
  bodyFont: 'Sarabun',
  bodyFontSizePt: 16,
  paragraphAlignment: 'left',
  firstLineIndentCm: 0.5,
  paragraphSpacingBeforePt: 0,
  paragraphSpacingAfterPt: 0,
  lineSpacingType: 'multiple',
  lineSpacingMultiplier: 1.08,
  sceneBreakSymbol: '***',
};

export interface Project {
  id: string;
  ownerId: string;
  title: string;
  slug: string;
  description: string;
  coverImageUrl?: string;
  isPublished: boolean;
  documentSettings: DocumentSettings;
  createdAt: number;
  updatedAt: number;
}

export interface Volume {
  id: string;
  projectId: string;
  volumeNumber: number;
  title: string;
  slug: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export type ChapterType = 'prologue' | 'chapter' | 'epilogue';

export interface Chapter {
  id: string;
  projectId: string;
  volumeId: string;
  chapterNumber: number | null;
  title: string;
  subtitle?: string;
  dateText?: string;
  locationText?: string;
  order: number;
  activeVariantId: string;
  publishedRevisionId?: string;

  /**
   * Explicit section type. Backward compatibility: when absent, treated as
   * 'chapter'. Prologue and Epilogue have chapterNumber = null.
   */
  chapterType?: ChapterType;

  /**
   * Denormalized word count of the chapter's ACTIVE variant only, maintained
   * for sidebar and dashboard list views so they need not read every variant.
   *
   * It is explicitly NOT the sum across variants. It is refreshed in the same
   * transaction that saves the active variant, and is not updated when a
   * non-active variant is edited.
   */
  totalWordCount: number;
  createdAt: number;
  updatedAt: number;
}

/** Backward compatibility helper: treats missing chapterType as 'chapter'. */
export function resolveChapterType(
  chapter: Pick<Chapter, 'chapterType'> | null | undefined
): ChapterType {
  return chapter?.chapterType ?? 'chapter';
}

export interface DraftVariant {
  id: string;
  chapterId: string;
  projectId: string;
  name: string;
  status: 'draft' | 'candidate' | 'archived';
  content: {
    type: string;
    content?: unknown[];
  };
  plainText: string;
  wordCount: number;
  characterCount: number;

  /**
   * Optimistic-concurrency token. (Audit H4)
   *
   * Convention: newly created variants start at 1, and every content-bearing
   * save increments by exactly 1. A client holds the value it loaded as its
   * `baseVersion`; a save is committed inside a transaction only when the
   * stored value still equals that baseVersion, so a stale second device
   * cannot overwrite newer work.
   *
   * Legacy documents written before Stage 2 have no field; readers treat
   * `undefined` as 0, so the first versioned save lands on 1.
   */
  contentVersion: number;

  latestRevisionNumber: number;
  lastSavedAt: number;
  lastEditedBySessionId: string;
  createdAt: number;
  updatedAt: number;
}

/** Legacy variants predate `contentVersion`; absent means 0. */
export function readContentVersion(
  variant: Pick<Partial<DraftVariant>, 'contentVersion'> | null | undefined
): number {
  const v = variant?.contentVersion;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export interface Revision {
  id: string;
  variantId: string;
  chapterId: string;
  projectId: string;
  revisionNumber: number;
  label?: string;
  trigger: 'manual' | 'publish_checkpoint' | 'milestone';
  content: {
    type: string;
    content?: unknown[];
  };
  plainText: string;
  wordCount: number;
  createdAt: number;
  createdBy: string;
}
