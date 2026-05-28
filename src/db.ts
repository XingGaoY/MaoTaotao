import Dexie, { type Table } from 'dexie';

export type FeedingKind = 'breast' | 'formula' | 'solid';
export type DiaperKind = 'pee' | 'poop' | 'mixed';
export type PoopColor =
  | 'yellow'
  | 'green'
  | 'mustard'
  | 'brown'
  | 'white'
  | 'gray'
  | 'clay'
  | 'red'
  | 'black';
export type CryResolvedBy = 'feeding' | 'burp' | 'diaper' | 'sleep' | 'hold' | 'self';
export type CryLabel = 'hungry' | 'tired' | 'discomfort' | 'gas' | 'hold';
export type EventType = 'feeding' | 'diaper' | 'sleep' | 'poop' | 'cry';
export type AttachmentKind = 'photo' | 'audio';

export interface Feeding {
  id?: number;
  ts: number;
  amount?: number;
  side?: 'left' | 'right' | 'both';
  kind?: FeedingKind;
  note?: string;
}

export interface Diaper {
  id?: number;
  ts: number;
  kind: DiaperKind;
  note?: string;
}

export interface Sleep {
  id?: number;
  startTs: number;
  endTs?: number;
  note?: string;
}

export interface Poop {
  id?: number;
  ts: number;
  color: PoopColor;
  warningFlag: boolean;
  note?: string;
}

export interface Cry {
  id?: number;
  ts: number;
  durationS?: number;
  intensity?: 1 | 2 | 3 | 4 | 5;
  resolvedBy?: CryResolvedBy;
  label?: CryLabel;
  note?: string;
}

export interface Attachment {
  id?: number;
  eventType: EventType;
  eventId: number;
  kind: AttachmentKind;
  blob: Blob;
  thumb?: Blob;
  createdAt: number;
}

export class BabyLogDB extends Dexie {
  feeding!: Table<Feeding, number>;
  diaper!: Table<Diaper, number>;
  sleep!: Table<Sleep, number>;
  poop!: Table<Poop, number>;
  cry!: Table<Cry, number>;
  attachment!: Table<Attachment, number>;

  constructor() {
    super('babylog');
    this.version(1).stores({
      feeding: '++id, ts, kind',
      diaper: '++id, ts, kind',
      sleep: '++id, startTs, endTs',
      poop: '++id, ts, color, warningFlag',
      cry: '++id, ts, intensity, resolvedBy, label',
      attachment: '++id, [eventType+eventId], kind, createdAt'
    });
  }
}

export const db = new BabyLogDB();

export const warningPoopColors = new Set<PoopColor>(['white', 'gray', 'clay', 'red', 'black']);

export function isPoopWarning(color: PoopColor) {
  return warningPoopColors.has(color);
}
