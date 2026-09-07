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
  primaryImageRefId?: string;
  primaryImageUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CharacterReference {
  id: string;
  characterId: string;
  projectId: string;
  storagePath: string;
  downloadUrl: string;
  caption: string;
  isPrimary: boolean;
  fileSizeBytes: number;
  mimeType: string;
  createdAt: number;
}
