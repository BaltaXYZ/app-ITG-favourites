import { describe, expect, it } from "vitest";
import {
  PASS_TEMPLATES,
  advancePass,
  createProgressiveTopTemplate,
  createSongLibrary,
  difficultyForStrategy,
  startPass
} from "./passEngine";
import { parseStoredPlans, serializeStoredPlans } from "./storage";
import type { Difficulty, PassPlan, Song } from "./types";

const BASE_PLAN: PassPlan = {
  version: 1,
  id: "test-plan",
  name: "Testpass",
  targetMinutes: 60,
  warmupSongCount: 0,
  avoidRepeats: true,
  source: "custom",
  segments: [
    {
      id: "all",
      name: "Alla",
      fromMinute: 0,
      strategy: { type: "single", difficulty: "9" }
    }
  ]
};

describe("passEngine", () => {
  it("shows warmup tracks first and counts them against the target time", () => {
    const plan: PassPlan = {
      ...BASE_PLAN,
      targetMinutes: 10,
      warmupSongCount: 2
    };
    const session = startPass(plan, libraryWithCounts({ "9": 2 }), { nowMs: 0 });

    expect(session.currentItem).toMatchObject({
      type: "warmup",
      label: "Uppvärmningslåt 1",
      difficulty: "5"
    });

    const secondWarmup = advancePass(session, libraryWithCounts({ "9": 2 }), {
      nowMs: 5 * 60_000
    });

    expect(secondWarmup.status).toBe("active");
    expect(secondWarmup.currentItem).toMatchObject({
      type: "warmup",
      label: "Uppvärmningslåt 2",
      difficulty: "6"
    });

    const finished = advancePass(secondWarmup, libraryWithCounts({ "9": 2 }), {
      nowMs: 11 * 60_000
    });

    expect(finished.status).toBe("finished");
    expect(finished.currentItem).toBeUndefined();
    expect(finished.history).toHaveLength(2);
  });

  it("chooses the next real song only when the current item is completed", () => {
    const library = libraryWithCounts({ "9": 2 });
    const session = startPass(BASE_PLAN, library, { nowMs: 0, random: fixedRandom(0) });

    expect(currentSongTitle(session)).toBe("Song 9-1");
    expect(session.history).toHaveLength(0);

    const nextSession = advancePass(session, library, {
      nowMs: 30_000,
      random: fixedRandom(0)
    });

    expect(nextSession.history).toHaveLength(1);
    expect(currentSongTitle(nextSession)).toBe("Song 9-2");
  });

  it("avoids duplicate songs until the difficulty pool has been used", () => {
    const library = libraryWithCounts({ "9": 2 });
    const first = startPass(BASE_PLAN, library, { nowMs: 0, random: fixedRandom(0) });
    const second = advancePass(first, library, { nowMs: 10_000, random: fixedRandom(0) });
    const third = advancePass(second, library, { nowMs: 20_000, random: fixedRandom(0) });

    expect(currentSongTitle(first)).toBe("Song 9-1");
    expect(currentSongTitle(second)).toBe("Song 9-2");
    expect(currentSongTitle(third)).toBe("Song 9-1");
    expect(third.usedSongIdsByDifficulty["9"]).toEqual(["9-1"]);
  });

  it("alternates between two configured difficulties", () => {
    const plan = withStrategy({ type: "alternate", difficulties: ["9", "10"] });
    const library = libraryWithCounts({ "9": 3, "10": 3 });
    const first = startPass(plan, library, { nowMs: 0, random: fixedRandom(0) });
    const second = advancePass(first, library, { nowMs: 10_000, random: fixedRandom(0) });
    const third = advancePass(second, library, { nowMs: 20_000, random: fixedRandom(0) });

    expect(currentDifficulty(first)).toBe("9");
    expect(currentDifficulty(second)).toBe("10");
    expect(currentDifficulty(third)).toBe("9");
  });

  it("cycles through sequence strategies", () => {
    const plan = withStrategy({ type: "sequence", difficulties: ["9", "10", "11"] });
    const library = libraryWithCounts({ "9": 3, "10": 3, "11": 3 });
    const first = startPass(plan, library, { nowMs: 0, random: fixedRandom(0) });
    const second = advancePass(first, library, { nowMs: 10_000, random: fixedRandom(0) });
    const third = advancePass(second, library, { nowMs: 20_000, random: fixedRandom(0) });
    const fourth = advancePass(third, library, { nowMs: 30_000, random: fixedRandom(0) });

    expect([
      currentDifficulty(first),
      currentDifficulty(second),
      currentDifficulty(third),
      currentDifficulty(fourth)
    ]).toEqual(["9", "10", "11", "9"]);
  });

  it("supports weighted difficulty selection", () => {
    const selectedDifficulty = difficultyForStrategy(
      { type: "weighted", weights: { "9": 1, "10": 3 } },
      0,
      fixedRandom(0.9)
    );

    expect(selectedDifficulty).toBe("10");
  });

  it("finishes only after a completed item when elapsed time has reached the target", () => {
    const plan: PassPlan = {
      ...BASE_PLAN,
      targetMinutes: 1
    };
    const library = libraryWithCounts({ "9": 3 });
    const first = startPass(plan, library, { nowMs: 0, random: fixedRandom(0) });
    const stillActive = advancePass(first, library, {
      nowMs: 59_000,
      random: fixedRandom(0)
    });
    const finished = advancePass(stillActive, library, {
      nowMs: 61_000,
      random: fixedRandom(0)
    });

    expect(stillActive.status).toBe("active");
    expect(finished.status).toBe("finished");
    expect(finished.currentItem).toBeUndefined();
    expect(finished.history).toHaveLength(2);
  });

  it("defines the three planned templates", () => {
    expect(PASS_TEMPLATES.map((template) => template.name)).toEqual([
      "Pass 1: Stegrande 60 min",
      "Pass 2: Nior med avslut",
      "Pass 3: Progressiv topp"
    ]);
    expect(PASS_TEMPLATES[0].segments.map((segment) => segment.fromMinute)).toEqual([
      0, 35, 45, 57
    ]);
    expect(createProgressiveTopTemplate("12-13").segments.at(-1)?.strategy).toEqual({
      type: "single",
      difficulty: "12-13"
    });
  });

  it("serializes saved plans as plain localStorage-compatible JSON", () => {
    const rawValue = serializeStoredPlans([BASE_PLAN]);
    const parsedPlans = parseStoredPlans(rawValue);

    expect(JSON.parse(rawValue)).toMatchObject({ version: 1 });
    expect(parsedPlans).toEqual([BASE_PLAN]);
  });
});

function libraryWithCounts(counts: Partial<Record<Difficulty, number>>) {
  const songs = Object.entries(counts).flatMap(([difficulty, count]) =>
    makeSongs(difficulty as Difficulty, count ?? 0)
  );

  return createSongLibrary(songs);
}

function makeSongs(difficulty: Difficulty, count: number): Song[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${difficulty}-${index + 1}`,
    title: `Song ${difficulty}-${index + 1}`,
    difficulty
  }));
}

function withStrategy(strategy: PassPlan["segments"][number]["strategy"]): PassPlan {
  return {
    ...BASE_PLAN,
    segments: [
      {
        id: "strategy",
        name: "Strategi",
        fromMinute: 0,
        strategy
      }
    ]
  };
}

function fixedRandom(...values: number[]) {
  let index = 0;
  return () => values[index++ % values.length];
}

function currentSongTitle(session: ReturnType<typeof startPass>): string | undefined {
  return session.currentItem?.type === "song" ? session.currentItem.song.title : undefined;
}

function currentDifficulty(session: ReturnType<typeof startPass>): Difficulty | undefined {
  return session.currentItem?.type === "song" ? session.currentItem.difficulty : undefined;
}
