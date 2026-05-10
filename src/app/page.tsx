"use client";

import {
  ArrowLeft,
  Check,
  Clock,
  FilePlus2,
  Pause,
  Pencil,
  Play,
  Plus,
  Save,
  SlidersHorizontal,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import songData from "../data/songs.json";
import {
  PASS_TEMPLATES,
  activeSegmentAt,
  advancePass,
  createProgressiveTopTemplate,
  createSongLibrary,
  getElapsedMs,
  getRemainingMs,
  hasReachedTarget,
  startPass
} from "../lib/passEngine";
import {
  deleteStoredPlan,
  loadStoredPlansWithSeed,
  upsertStoredPlan
} from "../lib/storage";
import { DIFFICULTIES, type Difficulty, type PassPlan, type PassSegment, type PassSession, type SegmentStrategy, type Song } from "../lib/types";

type AppView = "start" | "manage";
type ManageScreen = "home" | "list" | "editor";
type StrategyType = SegmentStrategy["type"];

type CustomSegmentDraft = {
  id: string;
  untilMinute?: number;
  strategyType: StrategyType;
  primary: Difficulty;
  secondary: Difficulty;
  sequence: string;
  weights: Record<Difficulty, number>;
};

const songs = songData.songs as Song[];
const library = createSongLibrary(songs);
const templates = PASS_TEMPLATES;
const initialPassPlans = [templates[0], templates[1], createProgressiveTopTemplate("11")];
const FIXED_WARMUP_SONG_COUNT = 4;
const targetMinuteRange = {
  min: 30,
  step: 15
};

const defaultWeights: Record<Difficulty, number> = {
  "9": 3,
  "10": 2,
  "11": 1,
  "12-13": 0
};

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatStrategy(strategy: SegmentStrategy) {
  switch (strategy.type) {
    case "single":
      return `Bara ${strategy.difficulty}`;
    case "alternate":
      return `Varannan ${strategy.difficulties.join("/")}`;
    case "sequence":
      return `Sekvens ${strategy.difficulties.join(" - ")}`;
    case "weighted":
      return DIFFICULTIES.map((difficulty) => {
        const weight = strategy.weights[difficulty] ?? 0;
        return weight > 0 ? `${difficulty} x${weight}` : undefined;
      })
        .filter(Boolean)
        .join(", ");
  }
}

function levelClass(difficulty: string) {
  return `level-pill level-${difficulty.replace("/", "-")}`;
}

function difficultyMeterClass(difficulty: string) {
  return `difficulty-meter difficulty-meter-${difficulty.replace("/", "-")}`;
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span className="itg-arrow-symbol" />
    </div>
  );
}

function FittedSongTitle({ title }: { title?: string }) {
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const titleElement = titleRef.current;
    const railElement = titleElement?.parentElement;
    if (!titleElement || !railElement) return;

    let frameId = 0;

    const fitTitle = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        titleElement.style.fontSize = "";
        const maxSize = Number.parseFloat(window.getComputedStyle(titleElement).fontSize);
        let nextSize = maxSize;
        const minSize = 14;

        while (titleElement.scrollWidth > titleElement.clientWidth && nextSize > minSize) {
          nextSize -= 1;
          titleElement.style.fontSize = `${nextSize}px`;
        }
      });
    };

    fitTitle();

    const resizeObserver = new ResizeObserver(fitTitle);
    resizeObserver.observe(railElement);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, [title]);

  return (
    <h1 className="song-title" ref={titleRef}>
      {title}
    </h1>
  );
}

function createDefaultDraft(): CustomSegmentDraft[] {
  return [
    {
      id: makeId("segment"),
      untilMinute: 35,
      strategyType: "single",
      primary: "9",
      secondary: "10",
      sequence: "9,10",
      weights: { ...defaultWeights }
    },
    {
      id: makeId("segment"),
      untilMinute: 45,
      strategyType: "alternate",
      primary: "10",
      secondary: "9",
      sequence: "10,9",
      weights: { ...defaultWeights }
    },
    {
      id: makeId("segment"),
      strategyType: "single",
      primary: "10",
      secondary: "9",
      sequence: "10",
      weights: { ...defaultWeights, "10": 3 }
    }
  ];
}

function strategyFromDraft(draft: CustomSegmentDraft): SegmentStrategy {
  if (draft.strategyType === "single") {
    return { type: "single", difficulty: draft.primary };
  }

  if (draft.strategyType === "alternate") {
    return { type: "alternate", difficulties: [draft.primary, draft.secondary] };
  }

  if (draft.strategyType === "sequence") {
    const difficulties = draft.sequence
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter((value): value is Difficulty => DIFFICULTIES.includes(value as Difficulty));
    return { type: "sequence", difficulties: difficulties.length > 0 ? difficulties : [draft.primary] };
  }

  return {
    type: "weighted",
    weights: draft.weights
  };
}

function draftsFromPlan(plan: PassPlan): CustomSegmentDraft[] {
  if (plan.segments.length === 0) {
    return createDefaultDraft();
  }

  return plan.segments.map((segment) => {
    const baseDraft = {
      id: makeId("segment"),
      untilMinute: segment.untilMinute,
      primary: "9" as Difficulty,
      secondary: "10" as Difficulty,
      sequence: "9,10",
      weights: { ...defaultWeights }
    };

    switch (segment.strategy.type) {
      case "single":
        return {
          ...baseDraft,
          strategyType: "single" as StrategyType,
          primary: segment.strategy.difficulty
        };
      case "alternate":
        return {
          ...baseDraft,
          strategyType: "alternate" as StrategyType,
          primary: segment.strategy.difficulties[0],
          secondary: segment.strategy.difficulties[1]
        };
      case "sequence":
        return {
          ...baseDraft,
          strategyType: "sequence" as StrategyType,
          primary: segment.strategy.difficulties[0] ?? baseDraft.primary,
          secondary: segment.strategy.difficulties[1] ?? baseDraft.secondary,
          sequence: segment.strategy.difficulties.join(",")
        };
      case "weighted":
        return {
          ...baseDraft,
          strategyType: "weighted" as StrategyType,
          weights: {
            ...defaultWeights,
            ...segment.strategy.weights
          }
        };
    }
  });
}

function customDraftToPlan({
  drafts,
  name,
  targetMinutes,
  warmupSongCount
}: {
  drafts: CustomSegmentDraft[];
  name: string;
  targetMinutes: number;
  warmupSongCount: number;
}): PassPlan {
  let fromMinute = 0;
  const segments: PassSegment[] = drafts.map((draft, index) => {
    const isLast = index === drafts.length - 1;
    const untilMinute = isLast ? undefined : Math.max(fromMinute + 1, Number(draft.untilMinute ?? fromMinute + 10));
    const segment: PassSegment = {
      id: `custom-${index + 1}`,
      name: `Segment ${index + 1}`,
      fromMinute,
      untilMinute,
      strategy: strategyFromDraft(draft)
    };
    if (untilMinute !== undefined) {
      fromMinute = untilMinute;
    }
    return segment;
  });

  return {
    version: 1,
    id: "custom-current",
    name: name.trim() || "Eget pass",
    targetMinutes,
    warmupSongCount,
    avoidRepeats: true,
    source: "custom",
    segments
  };
}

function clonePlanForRun(plan: PassPlan, overrides: { targetMinutes: number; warmupSongCount: number }): PassPlan {
  return {
    ...plan,
    id: plan.source === "saved" ? plan.id : `${plan.id}-run`,
    targetMinutes: overrides.targetMinutes,
    warmupSongCount: overrides.warmupSongCount,
    avoidRepeats: true,
    segments: plan.segments.map((segment) => ({ ...segment, strategy: { ...segment.strategy } }))
  };
}

export default function Home() {
  const [appView, setAppView] = useState<AppView>("start");
  const [manageScreen, setManageScreen] = useState<ManageScreen>("home");
  const [targetMinutes, setTargetMinutes] = useState(60);
  const warmupSongCount = FIXED_WARMUP_SONG_COUNT;
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [customName, setCustomName] = useState("Eget danspass");
  const [customDrafts, setCustomDrafts] = useState<CustomSegmentDraft[]>(() => createDefaultDraft());
  const [savedPlans, setSavedPlans] = useState<PassPlan[]>([]);
  const [session, setSession] = useState<PassSession | null>(null);
  const [finishedSession, setFinishedSession] = useState<PassSession | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pausedAtMs, setPausedAtMs] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    const plans = loadStoredPlansWithSeed(window.localStorage, initialPassPlans);
    setSavedPlans(plans);
    setSelectedPlanId(plans[0]?.id ?? "");
    setTargetMinutes(plans[0]?.targetMinutes ?? 60);
  }, []);

  useEffect(() => {
    if (savedPlans.length === 0) {
      if (selectedPlanId) {
        setSelectedPlanId("");
      }
      return;
    }

    if (!savedPlans.some((plan) => plan.id === selectedPlanId)) {
      setSelectedPlanId(savedPlans[0].id);
      setTargetMinutes(savedPlans[0].targetMinutes);
    }
  }, [savedPlans, selectedPlanId]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (pausedAtMs === null) {
        setNowMs(Date.now());
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [pausedAtMs]);

  const selectedPlan = useMemo(
    () => savedPlans.find((plan) => plan.id === selectedPlanId) ?? savedPlans[0] ?? null,
    [savedPlans, selectedPlanId]
  );

  const editorPlan = useMemo(() => {
    const draftPlan = customDraftToPlan({
      drafts: customDrafts,
      name: customName,
      targetMinutes,
      warmupSongCount
    });
    const existingPlan = editingPlanId
      ? savedPlans.find((plan) => plan.id === editingPlanId)
      : undefined;

    return {
      ...draftPlan,
      id: editingPlanId ?? draftPlan.id,
      source: editingPlanId ? "saved" : "custom",
      createdAt: existingPlan?.createdAt
    } satisfies PassPlan;
  }, [customDrafts, customName, editingPlanId, savedPlans, targetMinutes, warmupSongCount]);

  function selectStartPlan(plan: PassPlan) {
    setSelectedPlanId(plan.id);
    setTargetMinutes(plan.targetMinutes);
  }

  function startCurrentPass(plan: PassPlan) {
    const started = startPass(plan, library);
    setSession(started);
    setFinishedSession(null);
    setPausedAtMs(null);
    setNowMs(Date.now());
    setStatusMessage("");
  }

  function openNewEditor() {
    setEditingPlanId(null);
    setCustomName("Eget danspass");
    setTargetMinutes(60);
    setCustomDrafts(createDefaultDraft());
    setStatusMessage("");
    setManageScreen("editor");
  }

  function openExistingEditor(plan: PassPlan) {
    setEditingPlanId(plan.id);
    setCustomName(plan.name);
    setTargetMinutes(plan.targetMinutes);
    setCustomDrafts(draftsFromPlan(plan));
    setStatusMessage("");
    setManageScreen("editor");
  }

  function completeCurrentItem() {
    if (!session) return;
    const nextSession = advancePass(session, library);
    setNowMs(Date.now());
    if (nextSession.status === "finished") {
      setFinishedSession(nextSession);
      setSession(null);
      setStatusMessage("Passet är klart.");
    } else {
      setSession(nextSession);
    }
  }

  function togglePause() {
    if (!session) return;
    if (pausedAtMs === null) {
      const pausedNow = Date.now();
      setPausedAtMs(pausedNow);
      setNowMs(pausedNow);
      return;
    }

    const pausedDuration = Date.now() - pausedAtMs;
    setSession({
      ...session,
      startedAtMs: session.startedAtMs + pausedDuration
    });
    setPausedAtMs(null);
    setNowMs(Date.now());
  }

  function saveEditorPlan() {
    const savedId = editingPlanId ?? makeId("saved");
    const planToSave: PassPlan = {
      ...editorPlan,
      id: savedId,
      source: "saved"
    };
    const nextPlans = upsertStoredPlan(window.localStorage, planToSave);
    setSavedPlans(nextPlans);
    setEditingPlanId(savedId);
    setSelectedPlanId(savedId);
    setStatusMessage("Passet sparades lokalt i den här webbläsaren.");
  }

  function removeSavedPlan(planId: string) {
    const nextPlans = deleteStoredPlan(window.localStorage, planId);
    setSavedPlans(nextPlans);
    if (selectedPlanId === planId) {
      setSelectedPlanId(nextPlans[0]?.id ?? "");
    }
    if (editingPlanId === planId) {
      setEditingPlanId(null);
      setManageScreen("list");
    }
    setStatusMessage("Passet togs bort.");
  }

  if (session) {
    return (
      <SessionView
        session={session}
        nowMs={pausedAtMs ?? nowMs}
        paused={pausedAtMs !== null}
        onComplete={completeCurrentItem}
        onPause={togglePause}
        onExit={() => {
          setSession(null);
          setPausedAtMs(null);
        }}
      />
    );
  }

  if (appView === "start") {
    return (
      <StartView
        plans={savedPlans}
        targetMinutes={targetMinutes}
        maxTargetMinutes={Math.max(targetMinuteRange.min, selectedPlan?.targetMinutes ?? 60)}
        selectedPlanId={selectedPlanId}
        onTargetMinutesChange={setTargetMinutes}
        onPlanSelect={selectStartPlan}
        onStart={() => {
          if (!selectedPlan) return;
          startCurrentPass(clonePlanForRun(selectedPlan, { targetMinutes, warmupSongCount }));
        }}
        onManage={() => {
          setAppView("manage");
          setManageScreen("home");
        }}
        onCreatePass={() => {
          setAppView("manage");
          openNewEditor();
        }}
      />
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div>
            <h1>ITG Favourites</h1>
            <p>Timerstyrda danspass för dansmatta</p>
          </div>
        </div>

        <div className="section">
          <button className="ghost-button full-width-button" onClick={() => setAppView("start")}>
            Till startsidan
          </button>
        </div>
      </aside>

      <section className="main">
        <div className="workspace">
          {manageScreen === "home" ? (
            <ManageHome
              plansCount={savedPlans.length}
              onCreate={openNewEditor}
              onEdit={() => setManageScreen("list")}
            />
          ) : null}

          {manageScreen === "list" ? (
            <ManagePlanList
              plans={savedPlans}
              onBack={() => setManageScreen("home")}
              onCreate={openNewEditor}
              onDelete={removeSavedPlan}
              onEdit={openExistingEditor}
            />
          ) : null}

          {manageScreen === "editor" ? (
            <PassEditor
              mode={editingPlanId ? "edit" : "new"}
              plan={editorPlan}
              name={customName}
              targetMinutes={targetMinutes}
              drafts={customDrafts}
              statusMessage={statusMessage}
              onBack={() => setManageScreen(editingPlanId ? "list" : "home")}
              onDraftsChange={setCustomDrafts}
              onNameChange={setCustomName}
              onSave={saveEditorPlan}
              onStart={() => startCurrentPass(clonePlanForRun(editorPlan, { targetMinutes, warmupSongCount }))}
              onTargetMinutesChange={setTargetMinutes}
            />
          ) : null}

          {finishedSession ? <FinishedSummary session={finishedSession} /> : null}
        </div>
      </section>
    </main>
  );
}

function StartView({
  plans,
  targetMinutes,
  maxTargetMinutes,
  selectedPlanId,
  onTargetMinutesChange,
  onPlanSelect,
  onStart,
  onManage,
  onCreatePass
}: {
  plans: PassPlan[];
  targetMinutes: number;
  maxTargetMinutes: number;
  selectedPlanId: string;
  onTargetMinutesChange: (value: number) => void;
  onPlanSelect: (plan: PassPlan) => void;
  onStart: () => void;
  onManage: () => void;
  onCreatePass: () => void;
}) {
  return (
    <main className="start-page">
      <div className="start-shell">
        <header className="start-header">
          <div className="brand">
            <BrandMark />
            <div>
              <h1>ITG Favourites</h1>
              <p>Bygg ett danspass och starta direkt</p>
            </div>
          </div>
        </header>

        {plans.length > 0 ? (
          <>
            <section className="start-template-list" aria-label="Välj danspass">
              {plans.map((plan) => (
                <button
                  className="start-template-button"
                  data-active={selectedPlanId === plan.id}
                  key={plan.id}
                  onClick={() => onPlanSelect(plan)}
                >
                  <span>
                    <strong>{plan.name}</strong>
                    <small>{planShortDescription(plan)}</small>
                  </span>
                  <span className="template-meta">
                    {plan.segments
                      .flatMap((segment) => difficultiesInStrategy(segment.strategy))
                      .map((difficulty, index) => (
                        <span className={levelClass(difficulty)} key={`${plan.id}-${difficulty}-${index}`}>
                          {difficulty}
                        </span>
                      ))}
                  </span>
                </button>
              ))}
            </section>

            <TimeSlider value={targetMinutes} max={maxTargetMinutes} onChange={onTargetMinutesChange} />
          </>
        ) : (
          <section className="empty-state">
            Det finns inga sparade pass.
          </section>
        )}

        <section className="start-actions">
          <button className="primary-button start-button" disabled={plans.length === 0} onClick={onStart}>
            <Play size={22} /> Starta
          </button>
          {plans.length === 0 ? (
            <button className="ghost-button" onClick={onCreatePass}>
              <FilePlus2 size={18} /> Skapa nytt pass
            </button>
          ) : null}
          <button className="ghost-button" onClick={onManage}>
            <SlidersHorizontal size={18} /> Ändra/skapa nytt pass
          </button>
        </section>
      </div>
    </main>
  );
}

function TimeSlider({
  value,
  max,
  onChange
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <section className="time-slider" aria-label="Tid">
      <div className="time-slider-header">
        <span>Tid</span>
        <strong>{value} min</strong>
      </div>
      <input
        aria-label="Tid i minuter"
        max={max}
        min={targetMinuteRange.min}
        step={targetMinuteRange.step}
        type="range"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="time-slider-scale" aria-hidden="true">
        {Array.from(
          { length: (max - targetMinuteRange.min) / targetMinuteRange.step + 1 },
          (_, index) => targetMinuteRange.min + index * targetMinuteRange.step
        ).map((minute) => (
          <span key={minute}>{minute}</span>
        ))}
      </div>
    </section>
  );
}

function ManageHome({
  plansCount,
  onCreate,
  onEdit
}: {
  plansCount: number;
  onCreate: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="section">
      <div className="section-title">
        <h2>Passhantering</h2>
      </div>
      <div className="manage-choice-grid">
        <button className="manage-choice-card" onClick={onEdit}>
          <Pencil size={22} aria-hidden="true" />
          <span>
            <strong>Ändra befintligt pass</strong>
            <small>{plansCount === 1 ? "1 sparat pass" : `${plansCount} sparade pass`}</small>
          </span>
        </button>
        <button className="manage-choice-card" onClick={onCreate}>
          <FilePlus2 size={23} aria-hidden="true" />
          <span>
            <strong>Skapa nytt pass</strong>
            <small>Bygg upp namn, tid och segment</small>
          </span>
        </button>
      </div>
    </div>
  );
}

function ManagePlanList({
  plans,
  onBack,
  onCreate,
  onDelete,
  onEdit
}: {
  plans: PassPlan[];
  onBack: () => void;
  onCreate: () => void;
  onDelete: (planId: string) => void;
  onEdit: (plan: PassPlan) => void;
}) {
  return (
    <div className="section">
      <div className="section-title">
        <h2>Ändra befintligt pass</h2>
        <div className="button-row">
          <button className="ghost-button" onClick={onBack}>
            <ArrowLeft size={17} /> Tillbaka
          </button>
          <button className="ghost-button" onClick={onCreate}>
            <FilePlus2 size={17} /> Skapa nytt
          </button>
        </div>
      </div>

      {plans.length === 0 ? (
        <div className="empty-state">Det finns inga sparade pass.</div>
      ) : (
        <div className="saved-list">
          {plans.map((plan) => (
            <div className="saved-plan" key={plan.id}>
              <div>
                <strong>{plan.name}</strong>
                <p>{planShortDescription(plan)}</p>
              </div>
              <div className="button-row">
                <button className="small-button" onClick={() => onEdit(plan)}>
                  <Pencil size={15} /> Ändra
                </button>
                <button className="icon-button" aria-label="Radera pass" onClick={() => onDelete(plan.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PassEditor({
  mode,
  plan,
  name,
  targetMinutes,
  drafts,
  statusMessage,
  onBack,
  onDraftsChange,
  onNameChange,
  onSave,
  onStart,
  onTargetMinutesChange
}: {
  mode: "new" | "edit";
  plan: PassPlan;
  name: string;
  targetMinutes: number;
  drafts: CustomSegmentDraft[];
  statusMessage: string;
  onBack: () => void;
  onDraftsChange: (drafts: CustomSegmentDraft[]) => void;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onStart: () => void;
  onTargetMinutesChange: (value: number) => void;
}) {
  return (
    <>
      <div className="section">
        <div className="section-title">
          <div>
            <h2>{mode === "edit" ? "Ändra pass" : "Skapa nytt pass"}</h2>
          </div>
          <button className="ghost-button" onClick={onBack}>
            <ArrowLeft size={17} /> Tillbaka
          </button>
        </div>

        <div className="editor-fields">
          <div className="panel">
            <div className="section-title">
              <h3>Total tid</h3>
              <Clock size={18} aria-hidden="true" />
            </div>
            <PresetInput
              label="Tid"
              value={targetMinutes}
              presets={[30, 45, 60, 75]}
              minimum={1}
              onChange={onTargetMinutesChange}
            />
          </div>
          <CustomBuilder
            name={name}
            onNameChange={onNameChange}
            drafts={drafts}
            onDraftsChange={onDraftsChange}
          />
        </div>
      </div>

      <div className="section">
        <div className="section-title">
          <h2>Passplan</h2>
          <div className="button-row">
            <button className="ghost-button" onClick={onSave}>
              <Save size={17} /> Spara pass
            </button>
            <button className="primary-button" onClick={onStart}>
              <Play size={18} /> Starta pass
            </button>
          </div>
        </div>
        <PlanSummary plan={plan} />
        {statusMessage ? <p className="hint">{statusMessage}</p> : null}
      </div>
    </>
  );
}

function PresetInput({
  label,
  value,
  presets,
  minimum,
  showCustom = true,
  onChange
}: {
  label: string;
  value: number;
  presets: number[];
  minimum: number;
  showCustom?: boolean;
  onChange: (value: number) => void;
}) {
  const isCustom = !presets.includes(value);

  return (
    <div className="preset-control">
      <span>{label}</span>
      <div className="preset-row">
        <div className="preset-buttons">
          {presets.map((preset) => (
            <button
              className="preset-button"
              data-active={value === preset}
              key={preset}
              onClick={() => onChange(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
        {showCustom ? (
          <label className="custom-value">
            <span>Fritt</span>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              type="text"
              value={value}
              data-custom={isCustom}
              onChange={(event) => onChange(Math.max(minimum, Number(event.target.value)))}
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}

function CustomBuilder({
  name,
  onNameChange,
  drafts,
  onDraftsChange
}: {
  name: string;
  onNameChange: (name: string) => void;
  drafts: CustomSegmentDraft[];
  onDraftsChange: (drafts: CustomSegmentDraft[]) => void;
}) {
  function updateDraft(id: string, nextDraft: Partial<CustomSegmentDraft>) {
    onDraftsChange(drafts.map((draft) => (draft.id === id ? { ...draft, ...nextDraft } : draft)));
  }

  function addSegment() {
    const lastUntil = drafts.at(-2)?.untilMinute ?? 45;
    onDraftsChange([
      ...drafts.slice(0, -1),
      { ...drafts.at(-1)!, untilMinute: lastUntil + 10 },
      {
        id: makeId("segment"),
        strategyType: "single",
        primary: "10",
        secondary: "9",
        sequence: "10",
        weights: { ...defaultWeights }
      }
    ]);
  }

  function removeSegment(id: string) {
    if (drafts.length <= 1) return;
    onDraftsChange(drafts.filter((draft) => draft.id !== id));
  }

  return (
    <div className="panel">
      <label className="field">
        <span>Namn</span>
        <input value={name} onChange={(event) => onNameChange(event.target.value)} />
      </label>
      <div className="segments">
        {drafts.map((draft, index) => (
          <div className="segment-row" key={draft.id}>
            <label className="field">
              <span>{index === drafts.length - 1 ? "Till slut" : "Till minut"}</span>
              <input
                disabled={index === drafts.length - 1}
                inputMode="numeric"
                pattern="[0-9]*"
                type="text"
                value={index === drafts.length - 1 ? "" : draft.untilMinute ?? ""}
                onChange={(event) => updateDraft(draft.id, { untilMinute: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Strategi</span>
              <select
                value={draft.strategyType}
                onChange={(event) => updateDraft(draft.id, { strategyType: event.target.value as StrategyType })}
              >
                <option value="single">Bara en nivå</option>
                <option value="alternate">Varannan två nivåer</option>
                <option value="sequence">Egen sekvens</option>
                <option value="weighted">Viktad slumpmix</option>
              </select>
            </label>
            <StrategyFields draft={draft} onChange={(patch) => updateDraft(draft.id, patch)} />
            <button
              className="icon-button"
              aria-label="Ta bort segment"
              title="Ta bort segment"
              onClick={() => removeSegment(draft.id)}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </div>
      <div className="button-row" style={{ marginTop: 12 }}>
        <button className="ghost-button" onClick={addSegment}>
          <Plus size={17} /> Lägg till segment
        </button>
      </div>
    </div>
  );
}

function StrategyFields({
  draft,
  onChange
}: {
  draft: CustomSegmentDraft;
  onChange: (patch: Partial<CustomSegmentDraft>) => void;
}) {
  if (draft.strategyType === "sequence") {
    return (
      <label className="field">
        <span>Sekvens</span>
        <input
          value={draft.sequence}
          onChange={(event) => onChange({ sequence: event.target.value })}
          placeholder="9,10,9,11"
        />
      </label>
    );
  }

  if (draft.strategyType === "weighted") {
    return (
      <label className="field">
        <span>Viktning</span>
        <select
          value={dominantWeightLabel(draft.weights)}
          onChange={(event) => onChange({ weights: weightsFromPreset(event.target.value) })}
        >
          <option value="normal">Mest 9 och 10</option>
          <option value="hard">Mest 10 och 11</option>
          <option value="peak">Kort toppmix</option>
        </select>
      </label>
    );
  }

  return (
    <div className="form-grid">
      <label className="field">
        <span>{draft.strategyType === "single" ? "Nivå" : "Första"}</span>
        <select value={draft.primary} onChange={(event) => onChange({ primary: event.target.value as Difficulty })}>
          {DIFFICULTIES.map((difficulty) => (
            <option value={difficulty} key={difficulty}>
              {difficulty}
            </option>
          ))}
        </select>
      </label>
      {draft.strategyType === "alternate" ? (
        <label className="field">
          <span>Andra</span>
          <select value={draft.secondary} onChange={(event) => onChange({ secondary: event.target.value as Difficulty })}>
            {DIFFICULTIES.map((difficulty) => (
              <option value={difficulty} key={difficulty}>
                {difficulty}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function PlanSummary({ plan }: { plan: PassPlan }) {
  return (
    <div className="panel plan-summary">
      <div className="level-tags">
        <span className="pill">{plan.name}</span>
        <span className="pill">{plan.targetMinutes} minuter</span>
        <span className="pill">{plan.warmupSongCount} uppvärmningslåtar</span>
        <span className="pill">Dubblettskydd på</span>
      </div>
      <ul className="summary-list">
        {plan.segments.map((segment) => (
          <li key={segment.id}>
            <span>
              {segment.fromMinute}:00 - {segment.untilMinute === undefined ? "slut" : `${segment.untilMinute}:00`}
            </span>
            <strong>{formatStrategy(segment.strategy)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SessionView({
  session,
  nowMs,
  paused,
  onComplete,
  onPause,
  onExit
}: {
  session: PassSession;
  nowMs: number;
  paused: boolean;
  onComplete: () => void;
  onPause: () => void;
  onExit: () => void;
}) {
  const elapsedMs = getElapsedMs(session, nowMs);
  const remainingMs = getRemainingMs(session, nowMs);
  const targetReached = hasReachedTarget(session, nowMs);
  const current = session.currentItem;
  const activeSegment = activeSegmentAt(session.plan, elapsedMs / 60_000);
  const currentTitle = current?.type === "warmup" ? current.label : current?.song.title;
  const ordinalLabel = current?.type === "warmup" ? `Uppvärmning ${current.ordinal}` : `Låt ${current?.ordinal ?? 1}`;

  return (
    <main className="session">
      <div className="session-top">
        <div className="metric">
          <span>Gått</span>
          <strong>{formatClock(elapsedMs)}</strong>
        </div>
        <div className="metric">
          <span>Kvar till mål</span>
          <strong>{formatClock(remainingMs)}</strong>
        </div>
        <div className="metric">
          <span>Aktivt segment</span>
          <strong>{activeSegment.name}</strong>
          <p>{targetReached ? `${ordinalLabel} - målet uppnått` : ordinalLabel}</p>
        </div>
      </div>

      <section className="song-stage">
        <div className="song-stage-inner">
          <div className="song-meta-bar">
            {current?.type === "song" ? (
              <div className={difficultyMeterClass(current.difficulty)}>
                <strong>{current.difficulty}</strong>
              </div>
            ) : (
              <div className={`${difficultyMeterClass(current?.difficulty ?? "5")} warmup-meter`}>
                <strong>{current?.difficulty ?? "5"}</strong>
              </div>
            )}
            <div className="song-rail">
              <FittedSongTitle title={currentTitle} />
            </div>
          </div>
          {current?.type === "song" && current.song.artist ? (
            <p className="song-artist">{current.song.artist}</p>
          ) : null}
          {paused ? <p className="song-artist">Pausad</p> : null}
        </div>
      </section>

      <div className="session-next-action">
        <button className="primary-button" onClick={onComplete} disabled={paused}>
          <Check size={22} /> {targetReached ? "Klar - avsluta pass" : "Klar - nästa låt"}
        </button>
      </div>

      <div className="session-bottom">
        <div className="button-row">
          <button className="ghost-button" onClick={onPause}>
            {paused ? <Play size={18} /> : <Pause size={18} />}
            {paused ? "Fortsätt" : "Pausa"}
          </button>
          <button className="danger-button" onClick={onExit}>
            Avsluta
          </button>
        </div>
      </div>
    </main>
  );
}

function FinishedSummary({ session }: { session: PassSession }) {
  return (
    <div className="section">
      <div className="section-title">
        <h2>Senaste pass</h2>
        <Check size={18} aria-hidden="true" />
      </div>
      <div className="panel">
        <p className="hint">
          {session.history.length} moment slutförda på {formatClock((session.finishedAtMs ?? Date.now()) - session.startedAtMs)}.
        </p>
        <div className="history">
          {session.history.slice(-8).map((item) => (
            <div className="song-row" key={`${item.id}-${item.completedAtMs}`}>
              <span>{item.type === "warmup" ? item.label : item.song.title}</span>
              <span>{formatClock(item.elapsedMs)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function planShortDescription(plan: PassPlan) {
  const warmup =
    plan.warmupSongCount > 0 ? `${plan.warmupSongCount} uppvärmningslåtar. ` : "";
  const segments = plan.segments
    .map((segment) => `${segmentTimeLabel(segment)}: ${formatStrategy(segment.strategy)}`)
    .join(". ");
  return `${warmup}${segments}`;
}

function segmentTimeLabel(segment: PassSegment) {
  if (segment.untilMinute === undefined) {
    return segment.fromMinute === 0 ? "från start" : `efter ${segment.fromMinute} min`;
  }

  return `${segment.fromMinute}-${segment.untilMinute} min`;
}

function difficultiesInStrategy(strategy: SegmentStrategy): Difficulty[] {
  switch (strategy.type) {
    case "single":
      return [strategy.difficulty];
    case "alternate":
    case "sequence":
      return strategy.difficulties;
    case "weighted":
      return DIFFICULTIES.filter((difficulty) => (strategy.weights[difficulty] ?? 0) > 0);
  }
}

function dominantWeightLabel(weights: Record<Difficulty, number>) {
  if (weights["12-13"] > 0) return "peak";
  if (weights["11"] >= weights["9"]) return "hard";
  return "normal";
}

function weightsFromPreset(preset: string): Record<Difficulty, number> {
  if (preset === "hard") {
    return { "9": 0, "10": 3, "11": 2, "12-13": 0 };
  }
  if (preset === "peak") {
    return { "9": 0, "10": 1, "11": 2, "12-13": 1 };
  }
  return { ...defaultWeights };
}
