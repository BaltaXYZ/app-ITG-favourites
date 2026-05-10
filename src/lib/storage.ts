import type { PassPlan } from "./types";
import { validatePlan } from "./passEngine";

export const STORED_PASS_PLANS_KEY = "itg-favourites-pass-plans-v1";

export type StoredPassPlanCollection = {
  version: 1;
  plans: PassPlan[];
};

export type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function serializeStoredPlans(plans: PassPlan[]): string {
  return JSON.stringify({
    version: 1,
    plans: plans.map(normalizeStoredPlan)
  } satisfies StoredPassPlanCollection);
}

export function parseStoredPlans(rawValue: string | null): PassPlan[] {
  if (!rawValue) {
    return [];
  }

  const parsedValue: unknown = JSON.parse(rawValue);

  if (!isStoredPlanCollection(parsedValue)) {
    return [];
  }

  return parsedValue.plans.filter(isValidStoredPlan).map(normalizeStoredPlan);
}

export function loadStoredPlans(storage: BrowserStorage): PassPlan[] {
  return parseStoredPlans(storage.getItem(STORED_PASS_PLANS_KEY));
}

export function saveStoredPlans(storage: BrowserStorage, plans: PassPlan[]): void {
  storage.setItem(STORED_PASS_PLANS_KEY, serializeStoredPlans(plans));
}

export function upsertStoredPlan(storage: BrowserStorage, plan: PassPlan): PassPlan[] {
  validatePlan(plan);

  const nowIso = new Date().toISOString();
  const storedPlan: PassPlan = {
    ...normalizeStoredPlan(plan),
    source: "saved",
    updatedAt: nowIso,
    createdAt: plan.createdAt ?? nowIso
  };
  const plans = loadStoredPlans(storage);
  const nextPlans = [
    storedPlan,
    ...plans.filter((candidatePlan) => candidatePlan.id !== storedPlan.id)
  ];

  saveStoredPlans(storage, nextPlans);
  return nextPlans;
}

export function deleteStoredPlan(storage: BrowserStorage, planId: string): PassPlan[] {
  const nextPlans = loadStoredPlans(storage).filter((plan) => plan.id !== planId);
  saveStoredPlans(storage, nextPlans);
  return nextPlans;
}

export function clearStoredPlans(storage: BrowserStorage): void {
  storage.removeItem(STORED_PASS_PLANS_KEY);
}

function normalizeStoredPlan(plan: PassPlan): PassPlan {
  return {
    ...plan,
    version: 1,
    targetMinutes: Number(plan.targetMinutes),
    warmupSongCount: Number(plan.warmupSongCount),
    avoidRepeats: Boolean(plan.avoidRepeats),
    segments: plan.segments.map((segment) => ({
      ...segment,
      fromMinute: Number(segment.fromMinute),
      untilMinute:
        segment.untilMinute === undefined ? undefined : Number(segment.untilMinute)
    }))
  };
}

function isStoredPlanCollection(value: unknown): value is StoredPassPlanCollection {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "plans" in value &&
    Array.isArray(value.plans)
  );
}

function isValidStoredPlan(value: unknown): value is PassPlan {
  try {
    validatePlan(value as PassPlan);
    return true;
  } catch {
    return false;
  }
}
