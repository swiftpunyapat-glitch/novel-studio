export interface CharacterRelationship {
  targetCharacterId: string;
  targetCharacterName: string;
  relationType: string;
  description: string;
}

export interface Character {
  id: string;
  projectId: string;
  name: string;
  aliases: string[];
  role: 'protagonist' | 'antagonist' | 'supporting' | 'minor';
  description: string;
  appearance: string;
  personality: string;
  biography: string;
  relationships: CharacterRelationship[];
  writerNotes: string;

  /**
   * AUDIT H9 / C3: single source of truth for which reference image is primary.
   *
   * Previously primacy was recorded three ways — `primaryImageRefId`,
   * `primaryImageUrl` and `CharacterReference.isPrimary` — with nothing keeping
   * them consistent. Only this pointer remains; `primaryImageUrl` is gone so a
   * permanent public download URL can never become the source of truth.
   */
  primaryImageRefId?: string;

  createdAt: number;
  updatedAt: number;
}

export interface CharacterReference {
  id: string;
  characterId: string;
  projectId: string;

  /**
   * Canonical location of the image. Access is resolved per-request through
   * authenticated Firebase Storage, which storage.rules gates on project
   * ownership. No long-lived download URL is persisted: Firebase download URLs
   * embed an unguessable token that keeps working after rules change, so
   * storing one would leak access that C3's ownership check cannot revoke.
   */
  storagePath: string;

  caption: string;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: number;
}
