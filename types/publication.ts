export interface PublicProject {
  slug: string;
  projectId: string;
  title: string;
  description: string;
  coverImageUrl?: string;
  publishedAt: number;
  lastRepublishedAt: number;
  totalVolumesCount: number;
  totalChaptersCount: number;
  readingSettings: {
    bodyFont: string;
    firstLineIndentCm: number;
    sceneBreakSymbol: string;
  };
}

export interface PublicVolume {
  id: string;
  volumeNumber: number;
  title: string;
  slug: string;
  order: number;
}

export interface PublicChapterSnapshot {
  id: string;
  volumeId: string;
  chapterNumber: number | null;
  title: string;
  subtitle?: string;
  dateText?: string;
  locationText?: string;
  order: number;
  sourceRevisionId: string;
  publishedAt: number;
  wordCount: number;
  renderedHtml: string;
  plainText: string;
}

export interface PublicationHistoryRecord {
  id: string;
  projectId: string;
  scope: 'chapter' | 'volume' | 'project';
  targetEntityId: string;
  sourceVariantId: string;
  sourceRevisionId: string;
  publishedBy: string;
  publishedAt: number;
  status: 'active' | 'rolled_back' | 'unpublished';
  metadata: {
    title: string;
    wordCount: number;
    notes?: string;
  };
}
