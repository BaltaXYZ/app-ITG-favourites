"use client";

import {
  Activity,
  BookOpen,
  Check,
  Clock,
  ListMusic,
  Pause,
  Play,
  Plus,
  Save,
  Shuffle,
  SlidersHorizontal,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import songData from "../data/songs.json";
import {
  PASS_TEMPLATES,
  activeSegmentAt,
  advancePass,
  countSongsByDifficulty,
  createProgressiveTopTemplate,
  createSongLibrary,
  getElapsedMs,
  getRemainingMs,
  hasReachedTarget,
  startPass
} from "../lib/passEngine";
import {
  deleteStoredPlan,
  loadStoredPlans,
  upsertStoredPlan
} from "../lib/storage";
import { DIFFICULTIES, type Difficulty, type PassPlan, type PassSegment, type PassSession, type SegmentStrategy, type Song } from "../lib/types";

type BuilderMode = "templates" | "custom";
type AppView = "start" | "advanced";
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
const counts = countSongsByDifficulty(songs);
const templates = PASS_TEMPLATES;
const targetMinutePresets = [30, 45, 60, 75];
const warmupSongPresets = [0, 2, 4, 6];

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

function levelClass(difficulty: Difficulty) {
  return `level-pill level-${difficulty.replace("/", "-")}`;
}

function difficultyMeterClass(difficulty: Difficulty) {
  return `difficulty-meter difficulty-meter-${difficulty.replace("/", "-")}`;
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
  const [builderMode, setBuilderMode] = useState<BuilderMode>("templates");
  const [targetMinutes, setTargetMinutes] = useState(60);
  const [warmupSongCount, setWarmupSongCount] = useState(4);
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0].id);
  const [progressiveFinal, setProgressiveFinal] = useState<"11" | "12-13">("11");
  const [customName, setCustomName] = useState("Eget danspass");
  const [customDrafts, setCustomDrafts] = useState<CustomSegmentDraft[]>(() => createDefaultDraft());
  const [savedPlans, setSavedPlans] = useState<PassPlan[]>([]);
  const [session, setSession] = useState<PassSession | null>(null);
  const [finishedSession, setFinishedSession] = useState<PassSession | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pausedAtMs, setPausedAtMs] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    setSavedPlans(loadStoredPlans(window.localStorage));
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (pausedAtMs === null) {
        setNowMs(Date.now());
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [pausedAtMs]);

  const selectedTemplate = useMemo(() => {
    if (selectedTemplateId.startsWith("template-progressiv")) {
      return createProgressiveTopTemplate(progressiveFinal);
    }
    return templates.find((template) => template.id === selectedTemplateId) ?? templates[0];
  }, [progressiveFinal, selectedTemplateId]);

  const activePlan = useMemo(() => {
    const basePlan =
      builderMode === "templates"
        ? selectedTemplate
        : customDraftToPlan({
            drafts: customDrafts,
            name: customName,
            targetMinutes,
            warmupSongCount
          });
    return clonePlanForRun(basePlan, { targetMinutes, warmupSongCount });
  }, [builderMode, customDrafts, customName, selectedTemplate, targetMinutes, warmupSongCount]);

  function applyTemplate(plan: PassPlan) {
    setBuilderMode("templates");
    setSelectedTemplateId(plan.id);
    setTargetMinutes(plan.targetMinutes);
    setWarmupSongCount(plan.warmupSongCount);
  }

  function selectTemplate(plan: PassPlan) {
    setBuilderMode("templates");
    setSelectedTemplateId(plan.id);
  }

  function startCurrentPass(plan = activePlan) {
    const started = startPass(plan, library);
    setSession(started);
    setFinishedSession(null);
    setPausedAtMs(null);
    setNowMs(Date.now());
    setStatusMessage("");
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

  function saveCustomPlan() {
    const planToSave: PassPlan = {
      ...activePlan,
      id: activePlan.id === "custom-current" ? makeId("saved") : activePlan.id,
      source: "saved"
    };
    const nextPlans = upsertStoredPlan(window.localStorage, planToSave);
    setSavedPlans(nextPlans);
    setStatusMessage("Upplägget sparades lokalt i den här webbläsaren.");
  }

  function removeSavedPlan(planId: string) {
    setSavedPlans(deleteStoredPlan(window.localStorage, planId));
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
        targetMinutes={targetMinutes}
        warmupSongCount={warmupSongCount}
        selectedTemplate={selectedTemplate}
        selectedTemplateId={selectedTemplateId}
        onTargetMinutesChange={setTargetMinutes}
        onWarmupSongCountChange={setWarmupSongCount}
        onTemplateSelect={selectTemplate}
        onStart={() => startCurrentPass(clonePlanForRun(selectedTemplate, { targetMinutes, warmupSongCount }))}
        onAdvanced={() => setAppView("advanced")}
      />
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <Activity size={26} />
          </div>
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

        <div className="section">
          <div className="section-title">
            <h2>Passinställningar</h2>
            <Clock size={18} aria-hidden="true" />
          </div>
          <PresetInput
            label="Tid"
            value={targetMinutes}
            presets={targetMinutePresets}
            minimum={1}
            onChange={setTargetMinutes}
          />
          <PresetInput
            label="Antal uppvärmningslåtar"
            value={warmupSongCount}
            presets={warmupSongPresets}
            minimum={0}
            onChange={setWarmupSongCount}
          />
        </div>

        <div className="section">
          <div className="section-title">
            <h2>Låtdata</h2>
            <ListMusic size={18} aria-hidden="true" />
          </div>
          <div className="level-tags">
            {DIFFICULTIES.map((difficulty) => (
              <span className={levelClass(difficulty)} key={difficulty}>
                {difficulty}: {counts[difficulty]}
              </span>
            ))}
          </div>
        </div>

        <HelpSection />
      </aside>

      <section className="main">
        <div className="workspace">
          <div className="section">
            <div className="section-title">
              <div>
                <h2>Bygg danspass</h2>
                <p className="hint">
                  Välj en mall eller bygg egna tidssegment. Appen skapar inte hela listan i förväg,
                  utan väljer nästa låt när du klickar klart.
                </p>
              </div>
              <div className="mode-tabs" role="tablist" aria-label="Välj byggläge">
                <button
                  className="tab-button"
                  data-active={builderMode === "templates"}
                  onClick={() => setBuilderMode("templates")}
                >
                  <Shuffle size={17} /> Mallar
                </button>
                <button
                  className="tab-button"
                  data-active={builderMode === "custom"}
                  onClick={() => setBuilderMode("custom")}
                >
                  <Plus size={17} /> Eget upplägg
                </button>
              </div>
            </div>

            {builderMode === "templates" ? (
              <TemplateBuilder
                selectedTemplateId={selectedTemplateId}
                progressiveFinal={progressiveFinal}
                onProgressiveFinalChange={setProgressiveFinal}
                onSelect={applyTemplate}
              />
            ) : (
              <CustomBuilder
                name={customName}
                onNameChange={setCustomName}
                drafts={customDrafts}
                onDraftsChange={setCustomDrafts}
              />
            )}
          </div>

          <div className="section">
            <div className="section-title">
              <h2>Passplan</h2>
              <div className="button-row">
                <button className="ghost-button" onClick={saveCustomPlan}>
                  <Save size={17} /> Spara upplägg
                </button>
                <button className="primary-button" onClick={() => startCurrentPass()}>
                  <Play size={18} /> Starta pass
                </button>
              </div>
            </div>
            <PlanSummary plan={activePlan} />
            {statusMessage ? <p className="hint">{statusMessage}</p> : null}
          </div>

          <SavedPlans
            plans={savedPlans}
            onStart={(plan) => {
              setBuilderMode("custom");
              setTargetMinutes(plan.targetMinutes);
              setWarmupSongCount(plan.warmupSongCount);
              startCurrentPass(plan);
            }}
            onDelete={removeSavedPlan}
          />

          {finishedSession ? <FinishedSummary session={finishedSession} /> : null}
        </div>
      </section>
    </main>
  );
}

function StartView({
  targetMinutes,
  warmupSongCount,
  selectedTemplate,
  selectedTemplateId,
  onTargetMinutesChange,
  onWarmupSongCountChange,
  onTemplateSelect,
  onStart,
  onAdvanced
}: {
  targetMinutes: number;
  warmupSongCount: number;
  selectedTemplate: PassPlan;
  selectedTemplateId: string;
  onTargetMinutesChange: (value: number) => void;
  onWarmupSongCountChange: (value: number) => void;
  onTemplateSelect: (template: PassPlan) => void;
  onStart: () => void;
  onAdvanced: () => void;
}) {
  const startTemplates = [templates[0], templates[1], createProgressiveTopTemplate("11")];

  return (
    <main className="start-page">
      <div className="start-shell">
        <header className="start-header">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <Activity size={26} />
            </div>
            <div>
              <h1>ITG Favourites</h1>
              <p>Bygg ett danspass och starta direkt</p>
            </div>
          </div>
        </header>

        <section className="start-controls" aria-label="Passinställningar">
          <PresetInput
            label="Tid"
            value={targetMinutes}
            presets={targetMinutePresets}
            minimum={1}
            showCustom={false}
            onChange={onTargetMinutesChange}
          />
          <PresetInput
            label="Antal uppvärmningslåtar"
            value={warmupSongCount}
            presets={warmupSongPresets}
            minimum={0}
            showCustom={false}
            onChange={onWarmupSongCountChange}
          />
        </section>

        <section className="start-template-list" aria-label="Välj danspassupplägg">
          {startTemplates.map((template) => (
            <button
              className="start-template-button"
              data-active={selectedTemplateId === template.id}
              key={template.id}
              onClick={() => onTemplateSelect(template)}
            >
              <span>
                <strong>{template.name}</strong>
                <small>{templateShortDescription(template)}</small>
              </span>
              <span className="template-meta">
                {template.segments
                  .flatMap((segment) => difficultiesInStrategy(segment.strategy))
                  .map((difficulty, index) => (
                    <span className={levelClass(difficulty)} key={`${template.id}-${difficulty}-${index}`}>
                      {difficulty}
                    </span>
                  ))}
              </span>
            </button>
          ))}
        </section>

        <section className="start-actions">
          <button className="primary-button start-button" onClick={onStart}>
            <Play size={22} /> Starta
          </button>
          <button className="ghost-button" onClick={onAdvanced}>
            <SlidersHorizontal size={18} /> Avancerade inställningar
          </button>
        </section>
      </div>
    </main>
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

function TemplateBuilder({
  selectedTemplateId,
  progressiveFinal,
  onProgressiveFinalChange,
  onSelect
}: {
  selectedTemplateId: string;
  progressiveFinal: "11" | "12-13";
  onProgressiveFinalChange: (difficulty: "11" | "12-13") => void;
  onSelect: (template: PassPlan) => void;
}) {
  const visibleTemplates = [templates[0], templates[1], createProgressiveTopTemplate(progressiveFinal)];

  return (
    <div className="template-list">
      {visibleTemplates.map((template) => (
        <article className="template-card" data-active={selectedTemplateId === template.id} key={template.id}>
          <div>
            <h3>{template.name}</h3>
            <p>{templateDescription(template)}</p>
          </div>
          <div className="template-meta">
            <span className="pill">{template.targetMinutes} min</span>
            <span className="pill">{template.warmupSongCount} uppvärmning</span>
            {template.segments.flatMap((segment) => difficultiesInStrategy(segment.strategy)).map((difficulty, index) => (
              <span className={levelClass(difficulty)} key={`${template.id}-${difficulty}-${index}`}>
                {difficulty}
              </span>
            ))}
          </div>
          {template.name.startsWith("Pass 3") ? (
            <label className="field">
              <span>Avslut</span>
              <select
                value={progressiveFinal}
                onChange={(event) => onProgressiveFinalChange(event.target.value as "11" | "12-13")}
              >
                <option value="11">Svårighetsgrad 11</option>
                <option value="12-13">Svårighetsgrad 12-13</option>
              </select>
            </label>
          ) : null}
          <div className="template-actions">
            <button className="ghost-button" onClick={() => onSelect(template)}>
              Välj mall
            </button>
          </div>
        </article>
      ))}
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

function SavedPlans({
  plans,
  onStart,
  onDelete
}: {
  plans: PassPlan[];
  onStart: (plan: PassPlan) => void;
  onDelete: (planId: string) => void;
}) {
  return (
    <div className="section">
      <div className="section-title">
        <h2>Sparade upplägg</h2>
        <Save size={18} aria-hidden="true" />
      </div>
      {plans.length === 0 ? (
        <div className="empty-state">Inga sparade upplägg i den här webbläsaren ännu.</div>
      ) : (
        <div className="saved-list">
          {plans.map((plan) => (
            <div className="saved-plan" key={plan.id}>
              <div>
                <strong>{plan.name}</strong>
                <p>
                  {plan.targetMinutes} min, {plan.warmupSongCount} uppvärmning
                </p>
              </div>
              <div className="button-row">
                <button className="small-button" onClick={() => onStart(plan)}>
                  <Play size={15} /> Starta
                </button>
                <button className="icon-button" aria-label="Radera sparat upplägg" onClick={() => onDelete(plan.id)}>
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

function HelpSection() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="section help">
      <button
        className="ghost-button info-toggle"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <BookOpen size={18} aria-hidden="true" />
        {isOpen ? "Stäng information" : "Information"}
      </button>
      {isOpen ? (
        <div className="help-panel">
          <h2>Så används appen</h2>
          <p>Välj mål­tid och antal uppvärmningslåtar. Uppvärmningen räknas in i total­tiden.</p>
          <p>Efter start visas en låt i taget. När låten är klar klickar du `Klar - nästa låt`.</p>
          <p>Om mål­tiden har passerats när du klickar klart avslutas passet. Därför kan passet bli lite längre än vald tid.</p>
          <p>Svårigheter väljs live från tidssegmenten, och appen undviker dubbletter tills en låtpool tar slut.</p>
        </div>
      ) : null}
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
        </div>
      </div>

      <section className="song-stage">
        <div className="song-stage-inner">
          <div className="song-meta-bar">
            {current?.type === "song" ? (
              <div className={difficultyMeterClass(current.difficulty)}>
                <span>Svårighet</span>
                <strong>{current.difficulty}</strong>
              </div>
            ) : (
              <div className="difficulty-meter warmup-meter">
                <span>Moment</span>
                <strong>Värm upp</strong>
              </div>
            )}
            <div className="song-rail">
              <span>{targetReached ? "Målet är uppnått - klicka klart för att avsluta" : `Låt ${current?.ordinal ?? 1}`}</span>
            </div>
          </div>
          <h1 className="song-title">
            {current?.type === "warmup" ? current.label : current?.song.title}
          </h1>
          {current?.type === "song" && current.song.artist ? (
            <p className="song-artist">{current.song.artist}</p>
          ) : null}
          {paused ? <p className="song-artist">Pausad</p> : null}
        </div>
      </section>

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
        <button className="primary-button" onClick={onComplete} disabled={paused}>
          <Check size={22} /> {targetReached ? "Klar - avsluta pass" : "Klar - nästa låt"}
        </button>
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

function templateDescription(template: PassPlan) {
  return template.segments
    .map((segment) => {
      const until = segment.untilMinute === undefined ? "slut" : `${segment.untilMinute} min`;
      return `${formatStrategy(segment.strategy)} till ${until}`;
    })
    .join(". ");
}

function templateShortDescription(template: PassPlan) {
  const warmup =
    template.warmupSongCount > 0 ? `${template.warmupSongCount} uppvärmningslåtar. ` : "";
  const segments = template.segments
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
