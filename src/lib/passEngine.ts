import {
  DIFFICULTIES,
  WARMUP_DIFFICULTIES,
  type AdvancePassOptions,
  type CompletedPassItem,
  type Difficulty,
  type DifficultyCounts,
  type PassEngineErrorCode,
  type PassItem,
  type PassPlan,
  type PassSegment,
  type PassSession,
  type SegmentStrategy,
  type Song,
  type SongLibrary,
  type StartPassOptions
} from "./types";

const MS_PER_MINUTE = 60_000;

export class PassEngineError extends Error {
  constructor(
    public readonly code: PassEngineErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PassEngineError";
  }
}

export const DEFAULT_TARGET_MINUTES = 60;

export const PASS_TEMPLATES = [
  {
    version: 1,
    id: "template-stegrande-60",
    name: "Pass 1: Stegrande 60 min",
    targetMinutes: 60,
    warmupSongCount: 4,
    avoidRepeats: true,
    source: "template",
    segments: [
      segment("p1-9", "Nior", 0, 35, { type: "single", difficulty: "9" }),
      segment("p1-alt-10-9", "Varannan 10/9", 35, 45, {
        type: "alternate",
        difficulties: ["10", "9"]
      }),
      segment("p1-10", "Tior", 45, 57, { type: "single", difficulty: "10" }),
      segment("p1-final-11", "Avslutande elva", 57, undefined, {
        type: "single",
        difficulty: "11"
      })
    ]
  },
  {
    version: 1,
    id: "template-nior-med-avslut",
    name: "Pass 2: Nior med avslut",
    targetMinutes: 60,
    warmupSongCount: 4,
    avoidRepeats: true,
    source: "template",
    segments: [
      segment("p2-9", "Nior", 0, 57, { type: "single", difficulty: "9" }),
      segment("p2-final-10", "Avslutande tia", 57, undefined, {
        type: "single",
        difficulty: "10"
      })
    ]
  },
  createProgressiveTopTemplate()
] satisfies PassPlan[];

export function createProgressiveTopTemplate(
  finalDifficulty: "11" | "12-13" | "either" = "either"
): PassPlan {
  const finalStrategy: SegmentStrategy =
    finalDifficulty === "either"
      ? { type: "weighted", weights: { "11": 1, "12-13": 1 } }
      : { type: "single", difficulty: finalDifficulty };

  return {
    version: 1,
    id: `template-progressiv-topp-${finalDifficulty}`,
    name:
      finalDifficulty === "either"
        ? "Pass 3: Progressiv topp"
        : `Pass 3: Progressiv topp (${finalDifficulty})`,
    targetMinutes: 60,
    warmupSongCount: 4,
    avoidRepeats: true,
    source: "template",
    segments: [
      segment("p3-9", "Nior", 0, 25, { type: "single", difficulty: "9" }),
      segment("p3-alt-9-10", "Varannan 9/10", 25, 45, {
        type: "alternate",
        difficulties: ["9", "10"]
      }),
      segment("p3-10", "Tior", 45, 55, { type: "single", difficulty: "10" }),
      segment("p3-final", "Avslutande topp", 55, undefined, finalStrategy)
    ]
  };
}

export function createSongLibrary(songs: Song[]): SongLibrary {
  return DIFFICULTIES.reduce<SongLibrary>((library, difficulty) => {
    library[difficulty] = songs.filter((song) => song.difficulty === difficulty);
    return library;
  }, emptySongLibrary());
}

export function emptySongLibrary(): SongLibrary {
  return {
    "9": [],
    "10": [],
    "11": [],
    "12-13": []
  };
}

export function countSongsByDifficulty(songs: Song[]): DifficultyCounts {
  return DIFFICULTIES.reduce<DifficultyCounts>((counts, difficulty) => {
    counts[difficulty] = songs.filter((song) => song.difficulty === difficulty).length;
    return counts;
  }, emptyDifficultyCounts());
}

export function emptyDifficultyCounts(): DifficultyCounts {
  return {
    "9": 0,
    "10": 0,
    "11": 0,
    "12-13": 0
  };
}

export function startPass(
  plan: PassPlan,
  library: SongLibrary,
  options: StartPassOptions = {}
): PassSession {
  validatePlan(plan);
  validateLibraryForPlan(plan, library);

  const startedAtMs = options.nowMs ?? Date.now();
  const baseSession: PassSession = {
    plan,
    startedAtMs,
    status: "active",
    history: [],
    usedSongIdsByDifficulty: emptyUsedSongIds(),
    segmentStepById: {}
  };

  const { item, session } = chooseItem(baseSession, library, 1, 0, options.random);

  return {
    ...session,
    currentItem: item
  };
}

export function advancePass(
  session: PassSession,
  library: SongLibrary,
  options: AdvancePassOptions = {}
): PassSession {
  if (session.status === "finished") {
    return session;
  }

  if (!session.currentItem) {
    throw new PassEngineError("INVALID_PLAN", "Cannot advance a pass without a current item.");
  }

  const nowMs = options.nowMs ?? Date.now();
  const elapsedMs = Math.max(0, nowMs - session.startedAtMs);
  const completedItem: CompletedPassItem = {
    ...session.currentItem,
    completedAtMs: nowMs,
    elapsedMs
  };
  const history = [...session.history, completedItem];

  if (elapsedMs >= targetMs(session.plan)) {
    return {
      ...session,
      status: "finished",
      currentItem: undefined,
      history,
      finishedAtMs: nowMs
    };
  }

  const nextOrdinal = history.length + 1;
  const { item, session: nextSession } = chooseItem(
    { ...session, history, currentItem: undefined },
    library,
    nextOrdinal,
    elapsedMs / MS_PER_MINUTE,
    options.random
  );

  return {
    ...nextSession,
    status: "active",
    currentItem: item,
    history
  };
}

export function getElapsedMs(session: PassSession, nowMs = Date.now()): number {
  return Math.max(0, nowMs - session.startedAtMs);
}

export function getRemainingMs(session: PassSession, nowMs = Date.now()): number {
  return Math.max(0, targetMs(session.plan) - getElapsedMs(session, nowMs));
}

export function hasReachedTarget(session: PassSession, nowMs = Date.now()): boolean {
  return getElapsedMs(session, nowMs) >= targetMs(session.plan);
}

export function isDifficulty(value: string): value is Difficulty {
  return DIFFICULTIES.includes(value as Difficulty);
}

export function validatePlan(plan: PassPlan): void {
  if (plan.version !== 1) {
    throw new PassEngineError("INVALID_PLAN", "Only pass plan version 1 is supported.");
  }

  if (!Number.isFinite(plan.targetMinutes) || plan.targetMinutes <= 0) {
    throw new PassEngineError("INVALID_PLAN", "Pass targetMinutes must be greater than 0.");
  }

  if (!Number.isInteger(plan.warmupSongCount) || plan.warmupSongCount < 0) {
    throw new PassEngineError("INVALID_PLAN", "warmupSongCount must be a non-negative integer.");
  }

  if (plan.segments.length === 0) {
    throw new PassEngineError("INVALID_PLAN", "Pass plan must include at least one segment.");
  }

  for (const planSegment of plan.segments) {
    if (!Number.isFinite(planSegment.fromMinute) || planSegment.fromMinute < 0) {
      throw new PassEngineError("INVALID_PLAN", "Segment fromMinute must be 0 or greater.");
    }

    if (
      planSegment.untilMinute !== undefined &&
      (!Number.isFinite(planSegment.untilMinute) ||
        planSegment.untilMinute <= planSegment.fromMinute)
    ) {
      throw new PassEngineError(
        "INVALID_PLAN",
        "Segment untilMinute must be greater than fromMinute."
      );
    }

    validateStrategy(planSegment.strategy);
  }
}

export function activeSegmentAt(plan: PassPlan, elapsedMinutes: number): PassSegment {
  const activeSegment = plan.segments.find(
    (planSegment) =>
      elapsedMinutes >= planSegment.fromMinute &&
      (planSegment.untilMinute === undefined || elapsedMinutes < planSegment.untilMinute)
  );

  if (!activeSegment) {
    throw new PassEngineError(
      "NO_ACTIVE_SEGMENT",
      `No segment covers elapsed minute ${elapsedMinutes}.`
    );
  }

  return activeSegment;
}

export function difficultyForStrategy(
  strategy: SegmentStrategy,
  step: number,
  random: () => number = Math.random
): Difficulty {
  switch (strategy.type) {
    case "single":
      return strategy.difficulty;
    case "alternate":
      return strategy.difficulties[step % strategy.difficulties.length];
    case "sequence":
      if (strategy.difficulties.length === 0) {
        throw new PassEngineError("INVALID_PLAN", "Sequence strategy must include difficulties.");
      }
      return strategy.difficulties[step % strategy.difficulties.length];
    case "weighted":
      return weightedDifficulty(strategy.weights, random);
  }
}

function chooseItem(
  session: PassSession,
  library: SongLibrary,
  ordinal: number,
  elapsedMinutes: number,
  random: () => number = Math.random
): { item: PassItem; session: PassSession } {
  if (ordinal <= session.plan.warmupSongCount) {
    return {
      item: {
        type: "warmup",
        id: `warmup-${ordinal}`,
        label: `Uppvärmningslåt ${ordinal}`,
        difficulty: WARMUP_DIFFICULTIES[(ordinal - 1) % WARMUP_DIFFICULTIES.length],
        ordinal
      },
      session
    };
  }

  const activeSegment = activeSegmentAt(session.plan, elapsedMinutes);
  const currentStep = session.segmentStepById[activeSegment.id] ?? 0;
  const difficulty = difficultyForStrategy(activeSegment.strategy, currentStep, random);
  const { song, usedSongIdsByDifficulty } = selectSongForDifficulty({
    library,
    difficulty,
    usedSongIdsByDifficulty: session.usedSongIdsByDifficulty,
    avoidRepeats: session.plan.avoidRepeats,
    random
  });

  return {
    item: {
      type: "song",
      id: `song-${ordinal}-${song.id}`,
      song,
      difficulty,
      segmentId: activeSegment.id,
      ordinal
    },
    session: {
      ...session,
      usedSongIdsByDifficulty,
      segmentStepById: {
        ...session.segmentStepById,
        [activeSegment.id]: currentStep + 1
      }
    }
  };
}

function selectSongForDifficulty({
  library,
  difficulty,
  usedSongIdsByDifficulty,
  avoidRepeats,
  random
}: {
  library: SongLibrary;
  difficulty: Difficulty;
  usedSongIdsByDifficulty: Record<Difficulty, string[]>;
  avoidRepeats: boolean;
  random: () => number;
}): { song: Song; usedSongIdsByDifficulty: Record<Difficulty, string[]> } {
  const pool = library[difficulty] ?? [];

  if (pool.length === 0) {
    throw new PassEngineError(
      "NO_SONGS_FOR_DIFFICULTY",
      `No songs are available for difficulty ${difficulty}.`
    );
  }

  const usedIds = new Set(usedSongIdsByDifficulty[difficulty]);
  const availablePool = avoidRepeats ? pool.filter((song) => !usedIds.has(song.id)) : pool;
  const activePool = availablePool.length > 0 ? availablePool : pool;
  const selectedSong = activePool[randomIndex(activePool.length, random)];
  const nextUsedIds =
    avoidRepeats && availablePool.length === 0 ? [selectedSong.id] : [...usedIds, selectedSong.id];

  return {
    song: selectedSong,
    usedSongIdsByDifficulty: {
      ...usedSongIdsByDifficulty,
      [difficulty]: avoidRepeats ? unique(nextUsedIds) : usedSongIdsByDifficulty[difficulty]
    }
  };
}

function weightedDifficulty(
  weights: Partial<Record<Difficulty, number>>,
  random: () => number
): Difficulty {
  const entries = DIFFICULTIES.map((difficulty) => ({
    difficulty,
    weight: weights[difficulty] ?? 0
  })).filter((entry) => entry.weight > 0);

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);

  if (entries.length === 0 || totalWeight <= 0) {
    throw new PassEngineError(
      "INVALID_PLAN",
      "Weighted strategy must include at least one positive weight."
    );
  }

  let cursor = random() * totalWeight;
  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor < 0) {
      return entry.difficulty;
    }
  }

  return entries[entries.length - 1].difficulty;
}

function validateStrategy(strategy: SegmentStrategy): void {
  if (strategy.type === "sequence" && strategy.difficulties.length === 0) {
    throw new PassEngineError("INVALID_PLAN", "Sequence strategy must include difficulties.");
  }

  if (strategy.type === "weighted") {
    weightedDifficulty(strategy.weights, () => 0);
  }
}

function validateLibraryForPlan(plan: PassPlan, library: SongLibrary): void {
  const requiredDifficulties = new Set<Difficulty>();

  for (const planSegment of plan.segments) {
    for (const difficulty of difficultiesForStrategy(planSegment.strategy)) {
      requiredDifficulties.add(difficulty);
    }
  }

  for (const difficulty of requiredDifficulties) {
    if (!library[difficulty] || library[difficulty].length === 0) {
      throw new PassEngineError(
        "EMPTY_LIBRARY",
        `Plan requires difficulty ${difficulty}, but that song pool is empty.`
      );
    }
  }
}

function difficultiesForStrategy(strategy: SegmentStrategy): Difficulty[] {
  switch (strategy.type) {
    case "single":
      return [strategy.difficulty];
    case "alternate":
    case "sequence":
      return [...strategy.difficulties];
    case "weighted":
      return DIFFICULTIES.filter((difficulty) => (strategy.weights[difficulty] ?? 0) > 0);
  }
}

function segment(
  id: string,
  name: string,
  fromMinute: number,
  untilMinute: number | undefined,
  strategy: SegmentStrategy
): PassSegment {
  return {
    id,
    name,
    fromMinute,
    untilMinute,
    strategy
  };
}

function targetMs(plan: PassPlan): number {
  return plan.targetMinutes * MS_PER_MINUTE;
}

function randomIndex(length: number, random: () => number): number {
  return Math.min(length - 1, Math.floor(random() * length));
}

function emptyUsedSongIds(): Record<Difficulty, string[]> {
  return {
    "9": [],
    "10": [],
    "11": [],
    "12-13": []
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
