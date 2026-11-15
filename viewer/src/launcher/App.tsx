import { useCallback, useEffect, useRef, useState } from "react";
import { connectMessage } from "./api";
import { CheckScreen, type CheckState } from "./CheckScreen";
import { Footer, Header, Stepper } from "./Chrome";
import {
  fetchCapabilities,
  fetchRemembered,
  forgetConnection,
  listDatabases,
  testConnection,
} from "./client";
import { ConnectScreen } from "./ConnectScreen";
import { initialForm, toConnection, type FormState } from "./form";
import type { Capabilities, RememberedConnection } from "./model";
import { PickScreen, type DatabaseCheckState, type PickState } from "./PickScreen";
import { startSession } from "./session";

type Screen = "connect" | "check" | "pick";

type Boot =
  | { readonly kind: "loading" }
  | { readonly kind: "problem"; readonly message: string; readonly fix: string | null }
  | { readonly kind: "ready"; readonly token: string; readonly caps: Capabilities };

const STEP: Record<Screen, 1 | 2 | 3> = { connect: 1, check: 2, pick: 3 };

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
    setScreen(next);
    setMoved(true);
  }, []);

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

  const checkDatabase = (database: string) => {
    const body = toConnection(form, caps, database);
    if (body === null) return;
    const mine = generation.current;
    setDbCheck({ kind: "running", database });
    void testConnection(token, body, false).then((outcome) => {
      if (mine !== generation.current) return;
      setDbCheck(
        outcome.ok
          ? { kind: "done", database, result: outcome.value }
          : { kind: "failed", database, failure: outcome.failure },
      );
    });
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

  return (
    <>
      <Header />
      <Stepper current={STEP[screen]} />
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
          onEdit={() => {
            go("connect");
          }}
        />
      ) : null}
      {screen === "pick" ? (
        <PickScreen
          form={form}
          state={pick}
          dbCheck={dbCheck}
          onExtract={checkDatabase}
          onSelect={() => {
            generation.current += 1;
            setDbCheck({ kind: "idle" });
          }}
          includeSystem={includeSystem}
          onIncludeSystem={(include) => {
            setIncludeSystem(include);
            loadDatabases(include);
          }}
          onRetry={() => {
            loadDatabases(includeSystem);
          }}
          onEdit={() => {
            go("connect");
          }}
          onBack={() => {
            go("check");
          }}
        />
      ) : null}
      <Footer />
    </>
  );
}
