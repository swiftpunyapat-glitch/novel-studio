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
  totalWordCount: number;
  createdAt: number;
  updatedAt: number;
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
  latestRevisionNumber: number;
  lastSavedAt: number;
  lastEditedBySessionId: string;
  createdAt: number;
  updatedAt: number;
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
