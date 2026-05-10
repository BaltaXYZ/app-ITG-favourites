export const DIFFICULTIES = ["9", "10", "11", "12-13"] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];

export type DifficultyCounts = Record<Difficulty, number>;

export type Song = {
  id: string;
  title: string;
  artist?: string;
  difficulty: Difficulty;
};

export type SongLibrary = Record<Difficulty, Song[]>;

export type SingleSegmentStrategy = {
  type: "single";
  difficulty: Difficulty;
};

export type AlternateSegmentStrategy = {
  type: "alternate";
  difficulties: [Difficulty, Difficulty];
};

export type SequenceSegmentStrategy = {
  type: "sequence";
  difficulties: Difficulty[];
};

export type WeightedSegmentStrategy = {
  type: "weighted";
  weights: Partial<Record<Difficulty, number>>;
};

export type SegmentStrategy =
  | SingleSegmentStrategy
  | AlternateSegmentStrategy
  | SequenceSegmentStrategy
  | WeightedSegmentStrategy;

export type PassSegment = {
  id: string;
  name: string;
  fromMinute: number;
  untilMinute?: number;
  strategy: SegmentStrategy;
};

export type PassPlan = {
  version: 1;
  id: string;
  name: string;
  targetMinutes: number;
  warmupSongCount: number;
  avoidRepeats: boolean;
  segments: PassSegment[];
  source?: "template" | "custom" | "saved";
  createdAt?: string;
  updatedAt?: string;
};

export type WarmupPassItem = {
  type: "warmup";
  id: string;
  label: string;
  ordinal: number;
};

export type SongPassItem = {
  type: "song";
  id: string;
  song: Song;
  difficulty: Difficulty;
  segmentId: string;
  ordinal: number;
};

export type PassItem = WarmupPassItem | SongPassItem;

export type CompletedPassItem = PassItem & {
  completedAtMs: number;
  elapsedMs: number;
};

export type PassStatus = "active" | "finished";

export type PassSession = {
  plan: PassPlan;
  startedAtMs: number;
  status: PassStatus;
  currentItem?: PassItem;
  history: CompletedPassItem[];
  usedSongIdsByDifficulty: Record<Difficulty, string[]>;
  segmentStepById: Record<string, number>;
  finishedAtMs?: number;
};

export type StartPassOptions = {
  nowMs?: number;
  random?: () => number;
};

export type AdvancePassOptions = {
  nowMs?: number;
  random?: () => number;
};

export type PassEngineErrorCode =
  | "EMPTY_LIBRARY"
  | "INVALID_PLAN"
  | "NO_ACTIVE_SEGMENT"
  | "NO_SONGS_FOR_DIFFICULTY";
