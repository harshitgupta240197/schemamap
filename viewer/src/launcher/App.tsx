import { useCallback, useEffect, useRef, useState } from "react";
import { connectMessage } from "./api";
import { CheckScreen, type CheckState } from "./CheckScreen";
import { Footer, Header, Stepper } from "./Chrome";
import {
  cancelJob,
  fetchCapabilities,
  fetchJob,
  fetchMaps,
  fetchRemembered,
  forgetConnection,
  listDatabases,
  quitServer,
  startJob,
  testConnection,
} from "./client";
import { ConnectScreen } from "./ConnectScreen";
import { DoneScreen } from "./DoneScreen";
import { ExtractScreen, type ExtractState } from "./ExtractScreen";
import {
  endpointLabel,
  GROUP_LABELS,
  initialForm,
  selectedMode,
  toConnection,
  type FormState,
} from "./form";
import { rerunTarget } from "./maps";
import type { Capabilities, MapEntry, RememberedConnection } from "./model";
import { PickScreen, type DatabaseCheckState, type PickState } from "./PickScreen";
import { QuitScreen } from "./QuitScreen";
import { RecentScreen } from "./RecentScreen";
import { RerunDialog } from "./RerunDialog";
import { startSession } from "./session";

type Screen = "connect" | "check" | "pick" | "extract" | "done" | "recent" | "quit";

/** The extract the page is following: where it runs and what it is called. */
interface Run {
  readonly id: string | null;
  readonly database: string;
  readonly where: string;
}

interface DoneState {
  readonly mapId: string;
  readonly database: string;
  readonly where: string;
  readonly entry: MapEntry | null;
}

const POLL_MS = 500;
/** A status read that fails this many times in a row ends the extract view with an error. */
const POLL_FAILURES = 4;

type Boot =
  | { readonly kind: "loading" }
  | { readonly kind: "problem"; readonly message: string; readonly fix: string | null }
  | { readonly kind: "ready"; readonly token: string; readonly caps: Capabilities };

const STEP: Partial<Record<Screen, 1 | 2 | 3 | 4 | 5>> = {
  connect: 1,
  check: 2,
  pick: 3,
  extract: 4,
  done: 5,
};

/** sessionStorage, or a store that keeps nothing when site data is blocked. */
function sessionStore(): Pick<Storage, "getItem" | "setItem"> {
  try {
    return window.sessionStorage;
  } catch {
    return { getItem: () => null, setItem: () => undefined };
  }
}

/** The launcher: start the session, then Connect → Check → Choose database. */
export function App() {
  const [boot, setBoot] = useState<Boot>({ kind: "loading" });
  const [remembered, setRemembered] = useState<RememberedConnection[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [screen, setScreen] = useState<Screen>("connect");
  const [moved, setMoved] = useState(false);
  const [check, setCheck] = useState<CheckState>({ kind: "running" });
  const [pick, setPick] = useState<PickState>({ kind: "loading" });
  const [dbCheck, setDbCheck] = useState<DatabaseCheckState>({ kind: "idle" });
  const [includeSystem, setIncludeSystem] = useState(false);
  const [forgetError, setForgetError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [extract, setExtract] = useState<ExtractState | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [done, setDone] = useState<DoneState | null>(null);
  const [rerun, setRerun] = useState<MapEntry | null>(null);
  const [quitError, setQuitError] = useState<string | null>(null);
  const screenRef = useRef<Screen>("connect");
  const sessionToken = boot.kind === "ready" ? boot.token : null;
  // Answers that arrive after the person moved on are dropped.
  const generation = useRef(0);

  useEffect(() => {
    const alive = { current: true };
    void (async () => {
      const session = await startSession(window.location, sessionStore(), window.history);
      if (session.kind !== "ready") {
        const message = await connectMessage(session);
        if (alive.current) setBoot({ kind: "problem", message, fix: null });
        return;
      }
      const [caps, saved] = await Promise.all([
        fetchCapabilities(session.token),
        fetchRemembered(session.token),
      ]);
      if (!alive.current) return;
      if (!caps.ok) {
        setBoot({ kind: "problem", message: caps.failure.message, fix: caps.failure.fix });
        return;
      }
      setForm(initialForm(caps.value));
      if (saved.ok) setRemembered(saved.value);
      setBoot({ kind: "ready", token: session.token, caps: caps.value });
    })();
    return () => {
      alive.current = false;
    };
  }, []);

  const go = useCallback((next: Screen) => {
    generation.current += 1;
    screenRef.current = next;
    setScreen(next);
    setMoved(true);
  }, []);

  // Follow the running extract until it ends. The password is long gone by now: the job holds
  // it, and this page only polls the job's id.
  useEffect(() => {
    if (sessionToken === null || run?.id == null) return;
    const { id, database, where } = run;
    const live = { current: true };
    const gone = () => !live.current;
    let timer: number | undefined;
    let failures = 0;
    const tick = async () => {
      const outcome = await fetchJob(sessionToken, id);
      if (gone()) return;
      if (!outcome.ok) {
        failures += 1;
        if (failures < POLL_FAILURES) {
          timer = window.setTimeout(() => void tick(), POLL_MS);
          return;
        }
        setRun({ id: null, database, where });
        setExtract({
          kind: "failed",
          database,
          job: null,
          message: outcome.failure.message,
          fix: outcome.failure.fix,
        });
        return;
      }
      failures = 0;
      const job = outcome.value;
      if (job.state === "running") {
        setExtract((current) => ({
          kind: "running",
          database,
          job,
          cancelling: current?.kind === "running" && current.cancelling,
        }));
        timer = window.setTimeout(() => void tick(), POLL_MS);
        return;
      }
      if (job.state === "done" && job.mapId !== null) {
        const mapId = job.mapId;
        const maps = await fetchMaps(sessionToken);
        if (gone()) return;
        const entry = maps.ok ? (maps.value.find((item) => item.id === mapId) ?? null) : null;
        setRun({ id: null, database, where });
        setDone({ mapId, database, where, entry });
        setExtract(null);
        if (screenRef.current === "extract") go("done");
      } else if (job.state === "cancelled") {
        setRun({ id: null, database, where });
        setExtract(null);
        if (screenRef.current === "extract") go("pick");
      } else {
        setRun({ id: null, database, where });
        setExtract({
          kind: "failed",
          database,
          job,
          message: job.error?.message ?? "The extract stopped before it could finish.",
          fix: job.error?.fix ?? null,
        });
      }
    };
    void tick();
    return () => {
      live.current = false;
      window.clearTimeout(timer);
    };
  }, [sessionToken, run, go]);

  if (boot.kind !== "ready" || form === null) {
    return (
      <>
        <Header />
        <main className="lc-main">
          <section className="lc-card lc-card--state">
            <p className="lc-running" role="status">
              {boot.kind === "problem" ? null : <span className="lc-spinner" aria-hidden="true" />}
              {boot.kind === "problem" ? boot.message : "Connecting…"}
            </p>
            {boot.kind === "problem" && boot.fix !== null ? (
              <p className="lc-fix">
                <strong>How to fix: </strong>
                {boot.fix}
              </p>
            ) : null}
          </section>
        </main>
        <Footer />
      </>
    );
  }

  const { token, caps } = boot;

  const runCheck = () => {
    const body = toConnection(form, caps);
    if (body === null) return;
    go("check");
    setCheck({ kind: "running" });
    const mine = generation.current;
    void testConnection(token, body, form.remember).then(async (outcome) => {
      if (mine !== generation.current) return;
      if (!outcome.ok) {
        setCheck({ kind: "failed", failure: outcome.failure });
        return;
      }
      setCheck({ kind: "done", result: outcome.value });
      if (form.remember && outcome.value.connected) {
        const saved = await fetchRemembered(token);
        if (saved.ok) setRemembered(saved.value);
      }
    });
  };

  const loadDatabases = (system: boolean) => {
    const body = toConnection(form, caps);
    if (body === null) return;
    const mine = generation.current;
    setPick({ kind: "loading" });
    void listDatabases(token, body, system).then((outcome) => {
      if (mine !== generation.current) return;
      setPick(
        outcome.ok
          ? { kind: "ready", names: outcome.value }
          : { kind: "failed", failure: outcome.failure },
      );
    });
  };

  /**
   * Start the extract job for `target`. The password goes out in this one request and is wiped
   * from the page's state straight away; nothing here keeps a copy.
   */
  const startExtract = (target: FormState, database: string) => {
    const body = toConnection(target, caps, database);
    if (body === null) return;
    const where = endpointLabel(target.server.trim(), target.port.trim());
    setForm((current) => (current === null ? current : { ...current, password: "" }));
    setDbCheck({ kind: "idle" });
    setDone(null);
    setRun({ id: null, database, where });
    setExtract({ kind: "starting", database });
    go("extract");
    void startJob(token, body, target.remember).then((outcome) => {
      if (!outcome.ok) {
        setExtract({
          kind: "failed",
          database,
          job: null,
          message: outcome.failure.message,
          fix: outcome.failure.fix,
        });
        return;
      }
      setRun({ id: outcome.value, database, where });
    });
  };

  const checkDatabase = (database: string) => {
    const body = toConnection(form, caps, database);
    if (body === null) return;
    const mine = generation.current;
    setDbCheck({ kind: "running", database });
    void testConnection(token, body, false).then((outcome) => {
      if (mine !== generation.current) return;
      if (outcome.ok && !outcome.value.checks.some((check) => check.status === "fail")) {
        startExtract(form, database);
        return;
      }
      setDbCheck(
        outcome.ok
          ? { kind: "done", database, result: outcome.value }
          : { kind: "failed", database, failure: outcome.failure },
      );
    });
  };

  const cancelExtract = () => {
    if (run?.id == null) return;
    setExtract((current) =>
      current?.kind === "running" ? { ...current, cancelling: true } : current,
    );
    void cancelJob(token, run.id);
  };

  const wipePassword = () => {
    setForm((current) => (current === null ? current : { ...current, password: "" }));
  };

  const editConnection = () => {
    wipePassword();
    go("connect");
  };

  const quit = () => {
    wipePassword();
    setQuitError(null);
    void quitServer(token).then((outcome) => {
      // The server may close before the answer is read: that also means it stopped.
      if (outcome.ok || outcome.failure.status === 0) {
        setRun(null);
        setExtract(null);
        go("quit");
      } else {
        setQuitError(outcome.failure.message);
      }
    });
  };

  const rerunPlan = rerun === null ? null : rerunTarget(rerun, form, remembered, caps);

  const askRerun = (map: MapEntry) => {
    if (rerunTarget(map, form, remembered, caps) !== null) {
      setRerun(map);
      return;
    }
    setForm({ ...form, server: map.server ?? form.server, password: "" });
    go("connect");
  };

  const openPicker = () => {
    setDbCheck({ kind: "idle" });
    go("pick");
    loadDatabases(includeSystem);
  };

  const forget = (entry: RememberedConnection) => {
    setForgetError(null);
    void forgetConnection(token, entry.id).then((outcome) => {
      if (outcome.ok) {
        setRemembered((current) => current.filter((item) => item.id !== entry.id));
      } else {
        setForgetError(outcome.failure.message);
      }
    });
  };

  const step = STEP[screen];
  const needsPassword = selectedMode(form, caps)?.needsPassword === true;
  const hereWhere = endpointLabel(form.server.trim(), form.port.trim());

  return (
    <>
      <Header
        {...(screen === "quit"
          ? {}
          : {
              nav: {
                onRecent: () => {
                  go("recent");
                },
                onQuit: quit,
                recentCurrent: screen === "recent",
              },
            })}
      />
      {quitError === null ? null : (
        <p className="lc-note lc-note--warn lc-note--bar" role="alert">
          Schema Map could not stop: {quitError}
        </p>
      )}
      {step === undefined ? null : <Stepper current={step} />}
      {screen === "connect" ? (
        <ConnectScreen
          caps={caps}
          form={form}
          onChange={setForm}
          remembered={remembered}
          onForget={forget}
          onSubmit={runCheck}
          focusHeading={moved}
          forgetError={forgetError}
        />
      ) : null}
      {screen === "check" ? (
        <CheckScreen
          form={form}
          state={check}
          onAgain={runCheck}
          onChoose={openPicker}
          onEdit={editConnection}
        />
      ) : null}
      {screen === "pick" ? (
        <PickScreen
          form={form}
          state={pick}
          dbCheck={dbCheck}
          onExtract={checkDatabase}
          selected={selected}
          onSelect={(name) => {
            generation.current += 1;
            setDbCheck({ kind: "idle" });
            setSelected(name);
          }}
          askPassword={needsPassword && form.password === ""}
          password={form.password}
          onPassword={(password) => {
            setForm({ ...form, password });
          }}
          includeSystem={includeSystem}
          onIncludeSystem={(include) => {
            setIncludeSystem(include);
            loadDatabases(include);
          }}
          onRetry={() => {
            loadDatabases(includeSystem);
          }}
          onEdit={editConnection}
          onBack={() => {
            go("check");
          }}
        />
      ) : null}
      {screen === "extract" && extract !== null ? (
        <ExtractScreen
          state={extract}
          where={run?.where ?? hereWhere}
          onCancel={cancelExtract}
          onTryAgain={() => {
            setExtract(null);
            go("pick");
          }}
          onChooseAnother={() => {
            setExtract(null);
            setSelected(null);
            go("pick");
          }}
          onEdit={() => {
            setExtract(null);
            editConnection();
          }}
        />
      ) : null}
      {screen === "done" && done !== null ? (
        <DoneScreen
          token={token}
          mapId={done.mapId}
          database={done.database}
          where={done.where}
          entry={done.entry}
          onAnother={() => {
            setSelected(null);
            go("pick");
          }}
          onRecent={() => {
            go("recent");
          }}
        />
      ) : null}
      {screen === "recent" ? (
        <RecentScreen
          token={token}
          onNewConnection={() => {
            go("connect");
          }}
          onRerun={askRerun}
        />
      ) : null}
      {screen === "quit" ? <QuitScreen /> : null}
      {rerun !== null && rerunPlan !== null ? (
        <RerunDialog
          database={rerun.database}
          summary={rerunSummary(rerunPlan, caps)}
          needsPassword={selectedMode(rerunPlan, caps)?.needsPassword === true}
          onClose={() => {
            setRerun(null);
          }}
          onSubmit={(password) => {
            setRerun(null);
            startExtract({ ...rerunPlan, password }, rerun.database);
          }}
        />
      ) : null}
      <Footer />
    </>
  );
}

/** "localhost, 14333 · SQL Server login · schemamap_reader". */
function rerunSummary(plan: FormState, caps: Capabilities): string {
  const mode = selectedMode(plan, caps);
  const parts = [
    endpointLabel(plan.server.trim(), plan.port.trim()),
    mode?.group === undefined ? "" : GROUP_LABELS[mode.group],
    plan.user.trim(),
  ];
  return parts.filter((part) => part !== "").join(" · ");
}
