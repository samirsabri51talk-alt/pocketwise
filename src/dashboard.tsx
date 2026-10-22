"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  LayoutDashboard,
  Wallet,
  Sparkles,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  Pencil,
  Trash2,
  Download,
  Upload,
  RefreshCw,
  Target,
  CalendarDays,
  ShieldCheck,
  PiggyBank,
  Search,
  ArrowRight,
  CircleHelp,
  Menu,
  LogOut,
} from "lucide-react";
import seed from "./seed.json";
import { readBudget, writeBudget, requestPersistence } from "./storage";
import {
  Budget,
  Entry,
  Adjustment,
  budgetSchema,
  entrySchema,
  categories,
  budgetDate,
  cashBalance,
  planningMonth,
  savingsBalance,
  forecast,
  lastDay,
  money,
  monthOf,
  round,
  suggestions,
  today,
  totals,
} from "./model";
import { type SupabaseClient } from "@supabase/supabase-js";
import { cloudConfigured, syncBudget, type SyncResult } from "./cloud";

const nav = [
  ["Monthly plan", CalendarDays],
  ["Overview", LayoutDashboard],
  ["Transactions", Wallet],
  ["Money coach", Sparkles],
  ["Settings", Settings],
] as const;
const dateLabel = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
const budgetMonthLabel = (month: string) =>
  new Date(month + "-01T12:00:00").toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
const label = (e: Entry) =>
  e.status === "planned"
    ? "Planned"
    : e.kind === "income"
      ? "Received"
      : e.kind === "saving"
        ? e.direction === "withdrawal"
          ? "Withdrawn"
          : "Saved"
        : "Paid";
const sum = (e: Entry[]) => e.reduce((a, x) => a + x.amount, 0);
const incomeStreams = [
  ["Private", "Private income", 9],
  ["Commission", "Commission", 20],
  ["Salary", "Salary", 0],
] as const;
const monthAhead = (month: string, offset: number) => {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1))
    .toISOString()
    .slice(0, 7);
};
const incomeDate = (month: string, category: string) =>
  category === "Private"
    ? month + "-09"
    : category === "Commission"
      ? monthAhead(month, -1) + "-20"
      : lastDay(monthAhead(month, -1));
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Dashboard({
  scope = "local",
  cloud = null,
  userId = null,
  onSignOut,
  onConfigureCloud,
}: {
  scope?: string;
  cloud?: SupabaseClient | null;
  userId?: string | null;
  onSignOut?: () => void;
  onConfigureCloud?: () => void;
}) {
  const [b, setB] = useState<Budget | null>(null),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [view, setView] = useState("Monthly plan"),
    [month, setMonth] = useState(() => monthAhead(monthOf(today()), 1)),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState<Entry | null>(null),
    [menu, setMenu] = useState(false),
    [loaded, setLoaded] = useState(false),
    [ask, setAsk] = useState(""),
    [answer, setAnswer] = useState(""),
    [thinking, setThinking] = useState(false),
    [cut, setCut] = useState(20),
    [delay, setDelay] = useState(14);
  const [syncState, setSyncState] = useState<
      SyncResult | "checking" | "error" | "local"
    >(userId ? "checking" : "local"),
    [syncError, setSyncError] = useState("");
  const lock = useRef(false),
    syncLock = useRef(false),
    file = useRef<HTMLInputElement>(null);
  async function load() {
    setError("");
    setBusy(true);
    try {
      let r = await readBudget(scope);
      if (!r.data) {
        const initial = budgetSchema.parse({ ...seed, openingDate: today() });
        try {
          const rev = await writeBudget(initial, 0, scope, Boolean(userId));
          r = {
            data: initial,
            revision: rev,
            sync: { remoteVersion: 0, syncedRevision: userId ? 1 : 0 },
          };
        } catch {
          r = await readBudget(scope);
          if (!r.data) throw new Error("Could not initialize device storage.");
        }
        setNotice(
          "Your budget is ready. Import a backup in Settings or add your first transaction.",
        );
      }
      setB(r.data);
      setRevision(r.revision);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function persist(next: Budget) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const validated = budgetSchema.parse(next);
      const rev = await writeBudget(validated, revision, scope);
      setB(validated);
      setRevision(rev);
      setNotice(
        userId
          ? "Saved on this device. Cloud sync will run when online."
          : "Saved on this device. No internet connection needed.",
      );
      return true;
    } catch (e) {
      setError((e as Error).message || "Could not save. Try again.");
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function runSync(
    strategy: "normal" | "upload" | "download" = "normal",
  ) {
    if (!userId || !cloud || !loaded || syncLock.current) return;
    syncLock.current = true;
    setSyncState("checking");
    setSyncError("");
    let uploaded = false;
    try {
      if (strategy === "download") {
        const copy = await readBudget(scope);
        if (copy.data)
          download(
            "pocketwise-device-before-cloud-" + today() + ".json",
            JSON.stringify(copy.data, null, 2),
          );
      }
      if (strategy === "upload") {
        const { data: copy, error: backupError } = await cloud
          .from("pocketwise_budgets")
          .select("data")
          .eq("user_id", userId)
          .maybeSingle();
        if (backupError) throw backupError;
        if (copy?.data)
          download(
            "pocketwise-cloud-before-device-" + today() + ".json",
            JSON.stringify(copy.data, null, 2),
          );
      }
      const result = await syncBudget(cloud, userId, scope, strategy);
      setSyncState(result);
      if (result === "downloaded") {
        const latest = await readBudget(scope);
        setB(latest.data);
        setRevision(latest.revision);
        setNotice(
          strategy === "download"
            ? "Cloud data downloaded. Previous device copy was exported."
            : "Cloud data downloaded to this device.",
        );
      }
      if (result === "uploaded") {
        uploaded = true;
        setNotice("Saved on this device and synced to your account.");
      }
    } catch (e) {
      setSyncState("error");
      setSyncError((e as Error).message);
    } finally {
      syncLock.current = false;
      if (uploaded) {
        const latest = await readBudget(scope);
        if (latest.revision > latest.sync.syncedRevision)
          queueMicrotask(() => void runSync());
      }
    }
  }
  useEffect(() => {
    if (userId && loaded) void runSync();
  }, [revision, userId, loaded]);
  useEffect(() => {
    const online = () => void runSync(),
      visible = () => {
        if (document.visibilityState === "visible") void runSync();
      };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [userId, loaded, revision]);
  useEffect(() => {
    if (!userId || !cloud || !loaded) return;
    const timer = window.setInterval(() => void runSync(), 2000);
    const channel = cloud
      .channel(`pocketwise-budget-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pocketwise_budgets",
          filter: `user_id=eq.${userId}`,
        },
        () => void runSync(),
      )
      .subscribe();
    return () => {
      window.clearInterval(timer);
      void cloud.removeChannel(channel);
    };
  }, [userId, cloud, loaded]);

  function add(kind: Entry["kind"] = "expense") {
    const date = month + "-01";
    setEditing({
      id: crypto.randomUUID(),
      name: "",
      kind,
      category:
        kind === "income"
          ? "Salary"
          : kind === "saving"
            ? "Emergency fund"
            : "Other",
      amount: 0,
      date,
      status: "planned",
      essential: true,
      note: "",
      direction: "deposit",
      fundingSource: kind === "saving" ? "Salary" : undefined,
      budgetMonth: month,
    });
  }
  function shift(n: number) {
    const [y, m] = month.split("-").map(Number);
    setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  }
  async function remove(e: Entry) {
    if (!b || !confirm(`Delete “${e.name}” (${money(e.amount)} EGP)?`)) return;
    await persist({ ...b, entries: b.entries.filter((x) => x.id !== e.id) });
  }
  async function complete(e: Entry) {
    setEditing({ ...e, status: e.status === "done" ? "planned" : "done" });
  }
  async function restore(f: File) {
    try {
      const data = budgetSchema.parse(JSON.parse(await f.text()));
      if (
        confirm(
          `Replace this device’s budget with this backup (${data.entries.length} entries)?`,
        )
      )
        await persist(data);
    } catch {
      setError(
        "This file is not a valid Pocketwise backup. Your existing budget is unchanged.",
      );
    }
  }
  async function repeatMonth() {
    if (!b) return;
    const [y, m] = month.split("-").map(Number);
    const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    const source = b.entries.filter((x) => planningMonth(x) === month);
    const copied = source
      .filter(
        (x) =>
          !b.entries.some(
            (t) =>
              planningMonth(t) === next &&
              t.name === x.name &&
              t.kind === x.kind,
          ),
      )
      .map((x) =>
        x.kind === "income"
          ? {
              ...x,
              id: crypto.randomUUID(),
              status: "planned" as const,
              budgetMonth: next,
              date: incomeDate(next, x.category),
            }
          : {
              ...x,
              id: crypto.randomUUID(),
              status: "planned" as const,
              budgetMonth: next,
              date:
                next +
                "-" +
                String(
                  Math.min(+x.date.slice(-2), +lastDay(next).slice(-2)),
                ).padStart(2, "0"),
            },
      );
    if (!copied.length) {
      setNotice(
        "No new items to copy. Matching entries already exist next month.",
      );
      return;
    }
    if (await persist({ ...b, entries: [...b.entries, ...copied] })) {
      setMonth(next);
      setNotice(
        `Copied ${copied.length} items as plans. Review amounts and dates.`,
      );
    }
  }
  if (!b)
    return (
      <main className="loading">
        <div className="brandmark">p.</div>
        <h1>Your money, in focus.</h1>
        <p>{error || "Opening your private budget…"}</p>
        {error && <button onClick={load}>Try again</button>}
      </main>
    );
  const entries = b.entries.filter((e) => planningMonth(e) === month),
    t = totals(entries),
    remaining = round(t.income - t.expenses - t.savings);
  const actual = b.entries.filter(
      (e) =>
        e.status === "done" && e.date >= b.openingDate && e.date <= today(),
    ),
    a = totals(actual),
    cash = cashBalance(b),
    totalSavings = savingsBalance(b);
  const reserved = round(
    sum(
      b.entries.filter(
        (e) =>
          e.status === "planned" &&
          e.kind !== "income" &&
          e.direction !== "withdrawal" &&
          e.date >= b.openingDate &&
          e.date <= lastDay(month),
      ),
    ),
  );
  const safe = Math.max(0, round(cash - reserved)),
    savedTotal = totalSavings;
  const flexible = sum(
    entries.filter((e) => e.kind === "expense" && !e.essential),
  );
  const groups = categories
    .map((c) => ({
      name: c,
      value: sum(
        entries.filter((e) => e.kind === "expense" && e.category === c),
      ),
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
  const scenario = forecast(b, month, delay, cut),
    baseline = forecast(b, month);
  const insights = suggestions(b, month),
    rows = entries
      .filter(
        (e) =>
          (filter === "all" || e.kind === filter || e.status === filter) &&
          `${e.name} ${e.category}`.toLowerCase().includes(query.toLowerCase()),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  const income = entries
    .filter((e) => e.kind === "income")
    .sort((a, b) => a.date.localeCompare(b.date));
  const days = +lastDay(month).slice(-2);
  let running = 0;
  const series = Array.from({ length: days }, (_, i) => {
    entries
      .filter((e) => +budgetDate(e, month).slice(-2) === i + 1)
      .forEach((e) => {
        running +=
          e.kind === "income" ||
          (e.kind === "saving" && e.direction === "withdrawal")
            ? e.amount
            : -e.amount;
      });
    return running;
  });
  const lo = Math.min(0, ...series),
    hi = Math.max(1, ...series),
    span = hi - lo;
  const points = series
    .map(
      (v, i) =>
        `${30 + (i / (days - 1)) * 670},${155 - ((v - lo) / span) * 125}`,
    )
    .join(" ");
  const monthTitle = new Date(month + "-01T12:00:00").toLocaleDateString(
    "en-GB",
    { month: "long", year: "numeric" },
  );
  async function askCoach() {
    if (!b || !ask.trim()) return;
    setThinking(true);
    const lower = ask.toLowerCase();
    const msg = /save|saving|goal/.test(lower)
      ? `Your savings balance is EGP ${money(totalSavings)}. Net transfers to savings this month are EGP ${money(t.saved)}. The plan has EGP ${money(remaining)} unallocated after income, expenses and net savings transfers. Review unpaid bills before adding more savings.`
      : /afford|spend|cash|balance/.test(lower)
        ? `Cash today: EGP ${money(cash)} = opening EGP ${money(b.opening)} + received EGP ${money(a.received)} - paid EGP ${money(a.paid)} - net saved EGP ${money(a.saved)} + cash corrections EGP ${money(b.adjustments.filter((x) => x.account === "cash" && x.date <= today()).reduce((s, x) => s + x.amount, 0))}. Unpaid outflows through ${dateLabel(lastDay(month))}: EGP ${money(reserved)}. Unreserved cash: EGP ${money(safe)}. Future income is excluded.`
        : insights.map((x) => `${x.title}\n${x.detail}`).join("\n\n");
    setAnswer("Calculated analysis • " + monthTitle + "\n\n" + msg);
    setThinking(false);
  }

  return (
    <div className="app">
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setView("Overview");
          }}
        >
          <span className="brandmark">p.</span>Pocketwise
          <span className="branddot">®</span>
        </a>
        <p className="navlabel">YOUR MONEY SPACE</p>
        <nav>
          {nav.map(([n, I]) => (
            <button
              key={n}
              className={view === n ? "active" : ""}
              onClick={() => {
                setView(n);
                setMenu(false);
              }}
            >
              <I size={19} />
              {n}
              {n === "Money coach" && <span className="mini">NEW</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="sun">✳</div>
          <h3>
            Small steps.
            <br />
            Better money habits.
          </h3>
          <p>
            A little clarity today.
            <br />A little more freedom tomorrow.
          </p>
        </div>
        <div className="profile">
          <span className="avatar">ME</span>
          <div>
            <strong>My personal budget</strong>
            <small>Offline workspace</small>
          </div>
          <ShieldCheck size={17} />
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="crumb">
            <button
              className="mobile-menu iconbutton"
              aria-label="Open navigation"
              onClick={() => setMenu(!menu)}
            >
              <Menu size={22} />
            </button>
            <span>Workspace</span>
            <span>/</span>
            <strong>{view}</strong>
          </div>
          <div className="topright">
            <span className={"sync " + (revision ? "" : "unsaved")}>
              <i />
              {busy
                ? "Saving…"
                : revision
                  ? "Saved on device"
                  : "Not saved yet"}
            </span>
            <button
              className="iconbutton"
              onClick={load}
              disabled={busy}
              aria-label="Reload device data"
            >
              <RefreshCw size={17} />
            </button>
            {onSignOut && (
              <button className="secondary logout" onClick={onSignOut}>
                <LogOut size={15} />
                Log out
              </button>
            )}
            <span className="avatar small">ME</span>
          </div>
        </header>
        <main className="content">
          <div className="pageheading">
            <div>
              <p className="eyebrow">MAKE ROOM FOR WHAT MATTERS</p>
              <h1>
                {view === "Overview"
                  ? "Your money, in focus."
                  : view === "Transactions"
                    ? "Every move, accounted for."
                    : view === "Money coach"
                      ? "A clearer next step."
                      : "Make it yours."}
              </h1>
              <p className="subtitle">
                {view === "Overview"
                  ? "Know what’s coming in, where it goes, and what stays with you."
                  : view === "Transactions"
                    ? "Plan ahead. Record what actually happened. Stay in control."
                    : view === "Money coach"
                      ? "Practical insights, grounded in your own numbers."
                      : "Your starting point, your goals, your data."}
              </p>
            </div>
            <div className="heading-actions">
              <div className="monthpicker">
                <button onClick={() => shift(-1)} aria-label="Previous month">
                  <ChevronLeft size={16} />
                </button>
                <input
                  aria-label="Selected month"
                  type="month"
                  value={month}
                  onChange={(e) => e.target.value && setMonth(e.target.value)}
                />
                <button onClick={() => shift(1)} aria-label="Next month">
                  <ChevronRight size={16} />
                </button>
              </div>
              <button className="primary" onClick={() => add()} disabled={busy}>
                <Plus size={18} /> Add transaction
              </button>
            </div>
          </div>
          {error && (
            <div className="banner error" role="alert">
              {error}
              <button onClick={load} disabled={busy}>
                Reload
              </button>
            </div>
          )}
          {notice && (
            <div className="banner" role="status">
              <span>{notice}</span>
              <button
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {onConfigureCloud && (
            <div className="cloud-strip">
              <span>
                <ShieldCheck size={16} />{" "}
                {cloudConfigured
                  ? "Local workspace · sign in to sync"
                  : "Local workspace · cloud setup available"}
              </span>
              <button className="secondary" onClick={onConfigureCloud}>
                {cloudConfigured ? "Sign in to sync" : "Connect Supabase"}
              </button>
            </div>
          )}
          {userId && (
            <div className="cloud-strip" role="status">
              <span>
                <ShieldCheck size={16} />{" "}
                {syncState === "checking"
                  ? "Checking cloud…"
                  : syncState === "offline"
                    ? "Offline · saved on this device"
                    : syncState === "conflict"
                      ? "Cloud and device both changed"
                      : syncState === "error"
                        ? "Cloud sync needs attention"
                        : syncState === "uploaded" ||
                            syncState === "downloaded" ||
                            syncState === "synced"
                          ? "Synced with your account"
                          : "Saved on this device"}
              </span>
              <small>{syncError || "Auto-sync every 2 seconds"}</small>
              {syncState === "conflict" ? (
                <div>
                  <button
                    className="secondary"
                    onClick={() => void runSync("download")}
                  >
                    Use cloud copy
                  </button>
                  <button
                    className="secondary"
                    onClick={() => void runSync("upload")}
                  >
                    Use this device
                  </button>
                </div>
              ) : (
                <button className="textbutton" onClick={() => void runSync()}>
                  Sync now
                </button>
              )}
              {onSignOut && (
                <button className="textbutton" onClick={onSignOut}>
                  Sign out
                </button>
              )}
            </div>
          )}
          {!revision && loaded && (
            <div className="importcard">
              <div>
                <strong>Your independent money space.</strong>
                <p>
                  Import a Pocketwise JSON backup in Settings. Set your opening
                  balance before recording actual transactions.
                </p>
              </div>
              <button
                className="primary"
                disabled={busy}
                onClick={() => persist(b)}
              >
                Save local plan <ArrowRight size={16} />
              </button>
            </div>
          )}
          {view === "Monthly plan" && (
            <MonthlyPlan
              month={month}
              entries={entries}
              totals={t}
              cash={cash}
              busy={busy}
              onAdd={add}
              onEdit={setEditing}
              onOpenTransactions={() => setView("Transactions")}
            />
          )}
          {view === "Overview" && (
            <>
              <section className="stats">
                <article className="stat highlight">
                  <div className="statlabel">
                    Cash available today <Wallet size={18} />
                  </div>
                  <div className="statvalue">
                    <span>EGP</span> {money(cash)}
                  </div>
                  <div className="statfoot">
                    <span className="lightpill">Actual cash</span>
                    <span>As of {dateLabel(today())}</span>
                  </div>
                </article>
                <article className="stat">
                  <div className="statlabel">
                    Monthly income <ArrowDownLeft size={19} />
                  </div>
                  <div className="statvalue">
                    <span>EGP</span> {money(t.income)}
                  </div>
                  <div className="statfoot">
                    <span className="dot green" />
                    EGP {money(t.received)} received{" "}
                    <span className="muted">
                      · EGP {money(round(t.income - t.received))} planned
                    </span>
                  </div>
                </article>
                <article className="stat">
                  <div className="statlabel">
                    Monthly spending <ArrowUpRight size={19} />
                  </div>
                  <div className="statvalue">
                    <span>EGP</span> {money(t.expenses)}
                  </div>
                  <div className="statfoot">
                    <span className="dot orange" />
                    EGP {money(t.paid)} paid{" "}
                    <span className="muted">
                      · EGP {money(round(t.expenses - t.paid))} planned
                    </span>
                  </div>
                </article>
                <article className="stat">
                  <div className="statlabel">
                    Monthly savings transfers <PiggyBank size={19} />
                  </div>
                  <div className="statvalue">
                    <span>EGP</span> {money(t.savings)}
                  </div>
                  <div className="statfoot">
                    <span className="dot purple" />
                    EGP {money(t.saved)} net transferred{" "}
                    <span className="muted">
                      · balance EGP {money(totalSavings)}
                    </span>
                  </div>
                </article>
              </section>
              <BalancePanel
                key={revision}
                budget={b}
                cash={cash}
                savings={totalSavings}
                actual={a}
                busy={busy}
                onSave={async (account, target, note) => {
                  const current = account === "cash" ? cash : totalSavings;
                  const difference = round(target - current);
                  if (!difference) {
                    setNotice(
                      "This balance already matches. No correction was added.",
                    );
                    return;
                  }
                  await persist({
                    ...b,
                    adjustments: [
                      ...b.adjustments,
                      {
                        id: crypto.randomUUID(),
                        account,
                        date: today(),
                        amount: difference,
                        note,
                      },
                    ],
                  });
                }}
                onUpdate={async (adjustment) => {
                  await persist({
                    ...b,
                    adjustments: b.adjustments.map((x) =>
                      x.id === adjustment.id ? adjustment : x,
                    ),
                  });
                }}
                onDelete={async (id) => {
                  await persist({
                    ...b,
                    adjustments: b.adjustments.filter((x) => x.id !== id),
                  });
                }}
              />
              <div className="grid-main">
                <section className="panel cashflow">
                  <div className="panelhead">
                    <div>
                      <h2>Your monthly cash flow</h2>
                      <p>Net movement from all entries · {monthTitle}</p>
                    </div>
                    <span className="tag">Plan + actual</span>
                  </div>
                  <div className="flowheadline">
                    <strong className={remaining < 0 ? "negative" : ""}>
                      EGP {money(remaining)}
                    </strong>
                    <span>
                      planned month-end movement (excludes opening cash)
                    </span>
                  </div>
                  <div className="chart">
                    <svg
                      viewBox="0 0 730 185"
                      role="img"
                      aria-label={`Cumulative planned monthly net cash flow. End of month ${remaining} EGP. Excludes opening balance.`}
                    >
                      <defs>
                        <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor="#a8c9a0"
                            stopOpacity=".4"
                          />
                          <stop
                            offset="100%"
                            stopColor="#a8c9a0"
                            stopOpacity="0"
                          />
                        </linearGradient>
                      </defs>
                      {[30, 70, 110, 155].map((y) => (
                        <line
                          key={y}
                          x1="30"
                          x2="700"
                          y1={y}
                          y2={y}
                          stroke="#e9ece8"
                          strokeDasharray="4 5"
                        />
                      ))}
                      <polygon
                        points={`30,155 ${points} 700,155`}
                        fill="url(#fill)"
                      />
                      <polyline
                        points={points}
                        fill="none"
                        stroke="#4c7b47"
                        strokeWidth="3"
                        strokeLinejoin="round"
                      />
                      {[1, 9, 20, days].map((d) => (
                        <text
                          key={d}
                          x={30 + ((d - 1) / (days - 1)) * 670}
                          y="180"
                          textAnchor="middle"
                          fill="#8a9288"
                          fontSize="11"
                        >
                          {d}{" "}
                          {new Date(month + "-01T12:00:00").toLocaleDateString(
                            "en",
                            { month: "short" },
                          )}
                        </text>
                      ))}
                    </svg>
                  </div>
                  <div className="chartfooter">
                    <span>
                      <i className="dot green" />
                      Cumulative net movement
                    </span>
                    <small>Opening cash excluded</small>
                  </div>
                </section>
                <section className="panel income-panel">
                  <div className="panelhead">
                    <div>
                      <h2>Payday planner</h2>
                      <p>Income funding {monthTitle}</p>
                    </div>
                    <CalendarDays size={20} />
                  </div>
                  <div className="paydays">
                    {incomeStreams.map(([name, title], i) => {
                      const e = income.find((e) => e.category === name);
                      const paymentDate = e?.date || incomeDate(month, name);
                      return (
                        <button
                          key={name}
                          className="payday"
                          onClick={() =>
                            e
                              ? setEditing(e)
                              : setEditing({
                                  id: crypto.randomUUID(),
                                  kind: "income",
                                  category: name,
                                  name: title,
                                  amount: 0,
                                  date: paymentDate,
                                  status: "planned",
                                  essential: true,
                                  note: "",
                                  budgetMonth: month,
                                })
                          }
                        >
                          <span className={"datebox date" + i}>
                            <b>{+paymentDate.slice(-2)}</b>
                            <small>
                              {new Date(
                                paymentDate + "T12:00:00",
                              ).toLocaleDateString("en", { month: "short" })}
                            </small>
                          </span>
                          <span className="payname">
                            <strong>{title}</strong>
                            <small>
                              {name === "Private"
                                ? "Paid this month"
                                : `Paid before ${monthTitle}`}
                            </small>
                          </span>
                          <strong>{e ? "EGP " + money(e.amount) : "—"}</strong>
                          <ChevronRight size={15} />
                        </button>
                      );
                    })}
                  </div>
                  <div className="income-total">
                    <span>Total expected + received</span>
                    <strong>EGP {money(t.income)}</strong>
                  </div>
                </section>
              </div>
              <IncomePlan
                key={month + "-" + revision}
                budget={b}
                startMonth={month}
                busy={busy}
                onSave={async (entries) => {
                  if (await persist({ ...b, entries }))
                    setNotice(
                      `${monthTitle} income plan saved. Add expenses and savings transfers for this month as needed.`,
                    );
                }}
              />
              <div className="grid-lower">
                <section className="panel">
                  <div className="panelhead">
                    <div>
                      <h2>Where your money goes</h2>
                      <p>Spending by category</p>
                    </div>
                    <span className="tag">EGP</span>
                  </div>
                  <div className="category-list">
                    {groups.length ? (
                      groups.slice(0, 5).map((g, i) => (
                        <div key={g.name} className="category">
                          <div>
                            <span>
                              <i
                                style={{
                                  background: [
                                    "#66885b",
                                    "#a7bb92",
                                    "#c9b99a",
                                    "#e1b193",
                                    "#b1adc1",
                                  ][i],
                                }}
                              />
                              {g.name}
                            </span>
                            <strong>{money(g.value)}</strong>
                          </div>
                          <div className="bar">
                            <i
                              style={{
                                width:
                                  Math.max(2, (g.value / t.expenses) * 100) +
                                  "%",
                                background: [
                                  "#66885b",
                                  "#a7bb92",
                                  "#c9b99a",
                                  "#e1b193",
                                  "#b1adc1",
                                ][i],
                              }}
                            />
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="empty">
                        Add expenses to see your spending mix.
                      </p>
                    )}
                  </div>
                  <div className="panelbottom">
                    <span>Flexible spending</span>
                    <strong>EGP {money(flexible)}</strong>
                  </div>
                </section>
                <section className="panel goal">
                  <div className="panelhead">
                    <div>
                      <h2>A little more peace of mind</h2>
                      <p>Your savings goal</p>
                    </div>
                    <Target size={21} />
                  </div>
                  <div className="goalvisual">
                    <div
                      className="goalring"
                      style={{
                        background: `conic-gradient(#66885b ${Math.max(0, Math.min(100, (savedTotal / b.target) * 100))}%, #e9eee4 0)`,
                      }}
                    >
                      <div>
                        <PiggyBank size={29} />
                        <strong>
                          {Math.round((savedTotal / b.target) * 100)}%
                        </strong>
                      </div>
                    </div>
                    <div>
                      <span className="eyebrow">TOTAL SAVINGS BALANCE</span>
                      <h3>EGP {money(savedTotal)}</h3>
                      <p>of EGP {money(b.target)} target</p>
                    </div>
                  </div>
                  <p className="goalcopy">
                    Transfers to savings reduce cash. Withdrawals return money
                    to cash.
                  </p>
                  <button
                    className="secondary full"
                    onClick={() => add("saving")}
                  >
                    <Plus size={16} /> Add savings transfer
                  </button>
                </section>
                <section className="coach-card">
                  <div className="coachbadge">
                    <Sparkles size={17} /> MONEY COACH <span>FREE</span>
                  </div>
                  <h2>{insights[0]?.title || "Build your next good habit"}</h2>
                  <p>
                    {insights[0]?.detail ||
                      "Start with a clear picture of your income and spending."}
                  </p>
                  <button onClick={() => setView("Money coach")}>
                    Explore your insights <ArrowRight size={18} />
                  </button>
                  <small>Based on your budget · Free analysis</small>
                </section>
              </div>
              <section className="panel">
                <div className="panelhead">
                  <div>
                    <h2>On your radar</h2>
                    <p>Upcoming plans and recent activity</p>
                  </div>
                  <button
                    className="textbutton"
                    onClick={() => setView("Transactions")}
                  >
                    View all transactions <ArrowRight size={16} />
                  </button>
                </div>
                {renderRows(rows.slice(0, 5))}
              </section>
              <p className="footnote">
                <ShieldCheck size={14} /> Data stays on this device. Export
                backups regularly. Actual cash uses completed entries through
                today.
              </p>
            </>
          )}
          {view === "Transactions" && (
            <section className="panel">
              <div className="transaction-toolbar">
                <div className="filters">
                  {[
                    ["all", "All"],
                    ["income", "Income"],
                    ["expense", "Expenses"],
                    ["saving", "Savings"],
                    ["planned", "Planned"],
                    ["done", "Completed"],
                  ].map(([v, n]) => (
                    <button
                      key={v}
                      className={filter === v ? "selected" : ""}
                      onClick={() => setFilter(v)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <label className="search">
                  <Search size={16} />
                  <input
                    placeholder="Find a transaction"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              {renderRows(rows)}
              <div className="panelbottom">
                <span>
                  {rows.length} entries · {monthTitle}
                </span>
                <button
                  className="textbutton"
                  disabled={busy}
                  onClick={repeatMonth}
                >
                  Copy plans to next month <ArrowRight size={15} />
                </button>
              </div>
              <div className="explain">
                Imported expense dates are estimates. When recording a payment
                or receipt, use the actual date and amount. Transfers to savings
                are tracked separately from spending.
              </div>
            </section>
          )}
          {view === "Money coach" && (
            <>
              <div className="coach-intro">
                <Sparkles size={25} />
                <div>
                  <h2>Turn your numbers into a next step.</h2>
                  <p>
                    Understand the timing, protect essentials, and test
                    practical changes. Every insight shows the numbers behind
                    it.
                  </p>
                </div>
              </div>
              <div className="insightgrid">
                {insights.map((x, i) => (
                  <article className={"panel insight " + x.tone} key={i}>
                    <span className="insightnumber">0{i + 1}</span>
                    <h2>{x.title}</h2>
                    <p>{x.detail}</p>
                  </article>
                ))}
              </div>
              <section className="panel scenario">
                <div className="panelhead">
                  <div>
                    <h2>What if life changes the plan?</h2>
                    <p>
                      Try a scenario without changing your saved transactions
                    </p>
                  </div>
                  <Target size={21} />
                </div>
                <div className="scenario-body">
                  <div className="scenario-controls">
                    <label>
                      Planned flexible spending cut <strong>{cut}%</strong>
                      <input
                        type="range"
                        min="0"
                        max="50"
                        step="5"
                        value={cut}
                        onChange={(e) => setCut(+e.target.value)}
                      />
                    </label>
                    <label>
                      Planned commission delay <strong>{delay} days</strong>
                      <input
                        type="range"
                        min="0"
                        max="30"
                        step="1"
                        value={delay}
                        onChange={(e) => setDelay(+e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="scenario-results">
                    <div>
                      <span>Baseline month-end cash</span>
                      <strong>EGP {money(baseline.closing)}</strong>
                    </div>
                    <div>
                      <span>Scenario month-end cash</span>
                      <strong
                        className={scenario.closing < 0 ? "negative" : ""}
                      >
                        EGP {money(scenario.closing)}
                      </strong>
                    </div>
                    <div>
                      <span>Extra buffer needed</span>
                      <strong className={scenario.min < 0 ? "negative" : ""}>
                        EGP {money(Math.max(0, -scenario.min))}
                      </strong>
                    </div>
                  </div>
                </div>
                <p className="explain">
                  Includes recorded opening cash, prior completed entries, and
                  this month's plans. Delayed commission may move into the
                  following month. Completed transactions stay fixed. Earlier
                  unpaid income is excluded. Same-day income and bills are
                  netted; confirm their actual timing.
                </p>
              </section>
              <section className="panel askpanel">
                <div className="panelhead">
                  <div>
                    <h2>Quick budget checks</h2>
                    <p>
                      Choose a question and see the calculation behind the
                      answer
                    </p>
                  </div>
                  <Sparkles size={22} />
                </div>
                <div className="promptchips">
                  {[
                    "Where can I cut spending?",
                    "How much can I safely spend?",
                    "How can I save more?",
                  ].map((q) => (
                    <button key={q} onClick={() => setAsk(q)}>
                      {q}
                    </button>
                  ))}
                </div>
                <div className="askinput">
                  <select
                    aria-label="Budget check"
                    value={ask}
                    onChange={(e) => setAsk(e.target.value)}
                  >
                    <option value="">Choose a budget check</option>
                    <option>Where can I cut spending?</option>
                    <option>How much can I safely spend?</option>
                    <option>How can I save more?</option>
                  </select>
                  <button
                    className="primary"
                    disabled={thinking || !ask.trim()}
                    onClick={askCoach}
                  >
                    {thinking ? "Calculating…" : "Calculate"}
                    <ArrowRight size={16} />
                  </button>
                </div>
                {answer && (
                  <div className="answer" role="status">
                    {answer}
                  </div>
                )}
                <p className="hint">
                  Suggestions are budgeting scenarios, not guarantees. Check
                  your balances and upcoming obligations before acting.
                </p>
              </section>
              <p className="footnote">
                Budgeting approach:{" "}
                <a
                  href="https://www.consumerfinance.gov/archive/blog/budgeting-how-to-create-a-budget-and-stick-with-it/"
                  target="_blank"
                  rel="noreferrer"
                >
                  CFPB budgeting guidance ↗
                </a>
              </p>
            </>
          )}
          {view === "Settings" && (
            <div className="settingsgrid">
              <section className="panel">
                <div className="panelhead">
                  <div>
                    <h2>Your financial starting point</h2>
                    <p>All amounts are in Egyptian pounds (EGP)</p>
                  </div>
                  <Wallet size={21} />
                </div>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    await persist({
                      ...b,
                      opening: Number(f.get("opening")),
                      openingSavings: Number(f.get("openingSavings")),
                      openingDate: String(f.get("openingDate")),
                      target: Number(f.get("target")),
                    });
                  }}
                >
                  <label>
                    Opening cash balance
                    <input
                      name="opening"
                      type="number"
                      step="0.01"
                      defaultValue={b.opening}
                      required
                    />
                  </label>
                  <label>
                    Opening savings balance
                    <input
                      name="openingSavings"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={b.openingSavings}
                      required
                    />
                  </label>
                  <label>
                    Opening balance date
                    <input
                      name="openingDate"
                      type="date"
                      max={today()}
                      defaultValue={b.openingDate}
                      required
                    />
                  </label>
                  <p className="hint">
                    Enter cash and savings at the start of this date. Completed
                    entries from this date onward change the balances.
                    Transactions before it are assumed included in these opening
                    amounts.
                  </p>
                  <label>
                    Savings target
                    <input
                      name="target"
                      type="number"
                      min="1"
                      max="1000000000"
                      step="0.01"
                      defaultValue={b.target}
                      required
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    Save settings <Check size={16} />
                  </button>
                </form>
              </section>
              <section className="panel">
                <div className="panelhead">
                  <div>
                    <h2>Monthly spending limits</h2>
                    <p>Optional caps, shared across months</p>
                  </div>
                  <Target size={21} />
                </div>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget),
                      caps: Record<string, number> = {};
                    categories.forEach((c) => {
                      const n = Number(f.get(c));
                      if (n > 0) caps[c] = n;
                    });
                    await persist({ ...b, caps });
                  }}
                >
                  <div className="capgrid">
                    {categories.map((c) => (
                      <label key={c}>
                        {c}
                        <input
                          name={c}
                          type="number"
                          min="0"
                          max="1000000000"
                          step="0.01"
                          placeholder="No limit"
                          defaultValue={b.caps[c] || ""}
                        />
                      </label>
                    ))}
                  </div>
                  <button className="primary" disabled={busy}>
                    Save limits <Check size={16} />
                  </button>
                </form>
              </section>
              <section className="panel">
                <div className="panelhead">
                  <div>
                    <h2>Your data stays yours</h2>
                    <p>Download a backup and move your data between devices</p>
                  </div>
                  <ShieldCheck size={21} />
                </div>
                <div className="backup-actions">
                  <button
                    className="secondary"
                    onClick={async () => {
                      try {
                        setNotice(
                          (await requestPersistence())
                            ? "Persistent storage granted. Keep exporting backups."
                            : "Persistent storage was not granted by this browser. Keep regular backups.",
                        );
                      } catch {
                        setError(
                          "Could not request persistent storage. You can still export backups.",
                        );
                      }
                    }}
                  >
                    <ShieldCheck size={17} /> Protect local storage
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      download(
                        "pocketwise-backup-" + today() + ".json",
                        JSON.stringify(b, null, 2),
                      )
                    }
                  >
                    <Download size={17} /> Export backup
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      const csv = [
                        [
                          "Name",
                          "Kind",
                          "Category",
                          "Amount EGP",
                          "Date",
                          "Status",
                          "Essential",
                          "Note",
                        ],
                        ...b.entries.map((e) => [
                          e.name,
                          e.kind,
                          e.category,
                          e.amount,
                          e.date,
                          e.status,
                          e.essential,
                          e.note,
                        ]),
                      ]
                        .map((r) =>
                          r
                            .map(
                              (v) =>
                                '"' +
                                String(v)
                                  .replace(/^[=+@-]/, "'$&")
                                  .replaceAll('"', '""') +
                                '"',
                            )
                            .join(","),
                        )
                        .join("\r\n");
                      download("pocketwise-transactions.csv", csv, "text/csv");
                    }}
                  >
                    <Download size={17} /> Export CSV
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      download(
                        "pocketwise-review-" + month + ".txt",
                        `Personal budget review. Identify missing data, cash-flow risks, avoidable expenses, realistic savings opportunities and three prioritized next steps. Treat plans separately from actuals. Currency: EGP. Month: ${month}.

Totals: ${JSON.stringify(t)}
Opening cash: ${b.opening} on ${b.openingDate}
Actual cash today: ${cash}
Emergency target: ${b.target}

Transactions:
${entries.map((e) => `${e.date} | ${e.name} | ${e.category} | ${e.kind} | EGP ${e.amount} | ${e.status} | ${e.essential ? "essential" : "flexible"}`).join("\n")}

Calculated observations:
${insights.map((x) => x.title + ": " + x.detail).join("\n")}`,
                        "text/plain",
                      )
                    }
                  >
                    <Download size={17} /> Export review
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => file.current?.click()}
                  >
                    <Upload size={17} /> Restore backup
                  </button>
                  <input
                    ref={file}
                    type="file"
                    accept=".json"
                    hidden
                    onChange={(e) => {
                      if (e.target.files?.[0]) restore(e.target.files[0]);
                      e.target.value = "";
                    }}
                  />
                </div>
                <div className="explain">
                  <strong>Offline storage</strong>
                  <p>
                    Your records are stored in IndexedDB on this device. No
                    account, server, analytics, or ChatGPT connection is used.
                    Every confirmed transaction is saved locally. Different
                    browsers and devices have separate budgets.
                  </p>
                  <p>
                    Deleting browser data, removing the app, device loss, or
                    storage eviction may remove records. Export a JSON backup
                    regularly. Backups contain financial data in plain text;
                    keep them private. Device storage is not password-encrypted
                    by this app.
                  </p>
                  <strong>Export review</strong>
                  <p>
                    Download a readable monthly report for your own review.
                    Nothing is sent anywhere automatically.
                  </p>
                  <strong>On your iPhone</strong>
                  <p>
                    Open the independent HTTPS site in Safari once, add it to
                    your Home Screen, then launch the icon while online and wait
                    for Ready offline. After that, recording and analysis work
                    without internet. A file opened in the Files app is not an
                    installed web app.
                  </p>
                </div>
              </section>
              <section className="panel">
                <div className="panelhead">
                  <div>
                    <h2>About your imported plan</h2>
                    <p>Optional workbook import</p>
                  </div>
                  <CircleHelp size={21} />
                </div>
                <div className="explain">
                  <p>
                    Commission: 20th · Salary: month end · Private income: 9th.
                    The supplied workbook backup contains plans with no assumed
                    payment history. Import it locally using Restore backup.
                  </p>
                  <p>
                    Personal & Transport is a calculated remaining budget in the
                    source, so it is not imported as an expense. Record actual
                    transport and personal purchases separately.
                  </p>
                  <p>
                    The workbook reports October cash of EGP 2,000 but
                    calculates EGP 1,950. No adjustment was invented. Reconcile
                    it using your opening cash and actual transactions.
                  </p>
                  <p>
                    Future income blanks remain unknown. Household bills and
                    savings are estimates you can edit. November internet is
                    prepaid in the workbook and has no new charge.
                  </p>
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
      {editing && (
        <EntryDialog
          entry={editing}
          busy={busy}
          error={error}
          close={() => setEditing(null)}
          save={async (e, repeat) => {
            const saved = e;
            const list = b.entries.filter((x) => x.id !== saved.id);
            list.push(saved);
            if (repeat) {
              const [y, m] = saved.date.slice(0, 7).split("-").map(Number);
              for (let i = 1; i < repeat; i++) {
                const mo = new Date(Date.UTC(y, m - 1 + i, 1))
                  .toISOString()
                  .slice(0, 7);
                const copy =
                  saved.kind === "income"
                    ? {
                        ...saved,
                        id: crypto.randomUUID(),
                        date: incomeDate(mo, saved.category),
                        budgetMonth: mo,
                        status: "planned" as const,
                      }
                    : {
                        ...saved,
                        id: crypto.randomUUID(),
                        date:
                          mo +
                          "-" +
                          String(
                            Math.min(
                              +saved.date.slice(-2),
                              +lastDay(mo).slice(-2),
                            ),
                          ).padStart(2, "0"),
                        budgetMonth: mo,
                        status: "planned" as const,
                      };
                list.push(copy);
              }
            }
            if (await persist({ ...b, entries: list })) {
              setEditing(null);
              setMonth(planningMonth(saved));
            }
          }}
        />
      )}
    </div>
  );
  function renderRows(list: Entry[]) {
    return (
      <div className="transaction-list">
        {list.length ? (
          <>
            <div className="tablehead">
              <span>Transaction</span>
              <span>Budget month</span>
              <span>Status</span>
              <span>Amount</span>
              <span />
            </div>
            {list.map((e) => (
              <div className="transaction" key={e.id}>
                <div className="transaction-name">
                  <span className={"transaction-icon " + e.kind}>
                    {e.kind === "income" ? (
                      <ArrowDownLeft size={18} />
                    ) : e.kind === "saving" ? (
                      <PiggyBank size={18} />
                    ) : (
                      <ArrowUpRight size={18} />
                    )}
                  </span>
                  <div>
                    <strong>{e.name}</strong>
                    <small>
                      {e.category}
                      {e.kind === "expense" && !e.essential
                        ? " · Flexible"
                        : ""}
                      {e.kind === "saving" && e.direction === "withdrawal"
                        ? " · To cash"
                        : ""}
                      {e.kind === "saving" &&
                      e.direction !== "withdrawal" &&
                      e.fundingSource
                        ? " · From " + e.fundingSource
                        : ""}
                    </small>
                  </div>
                </div>
                <span className="transaction-date">
                  {budgetMonthLabel(planningMonth(e))}
                </span>
                <span className={"status " + e.status}>{label(e)}</span>
                <strong className={"amount " + e.kind}>
                  {e.kind === "income" ||
                  (e.kind === "saving" && e.direction === "withdrawal")
                    ? "+"
                    : "−"}{" "}
                  {money(e.amount)}
                  <small>EGP</small>
                </strong>
                <div className="rowactions">
                  <button
                    title={
                      e.status === "planned"
                        ? "Record actual payment or receipt"
                        : "Change to planned"
                    }
                    aria-label={"Change status: " + e.name}
                    disabled={busy}
                    onClick={() => complete(e)}
                  >
                    <Check size={15} />
                  </button>
                  <button
                    title="Edit"
                    aria-label={"Edit " + e.name}
                    onClick={() => setEditing(e)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    title="Delete"
                    aria-label={"Delete " + e.name}
                    disabled={busy}
                    onClick={() => remove(e)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className="empty">
            <Wallet size={26} />
            <h3>A fresh page for your money.</h3>
            <p>Add an entry or choose another month.</p>
            <button className="secondary" onClick={() => add()}>
              <Plus size={16} /> Add transaction
            </button>
          </div>
        )}
      </div>
    );
  }
}

function IncomePlan({
  budget,
  startMonth,
  busy,
  onSave,
}: {
  budget: Budget;
  startMonth: string;
  busy: boolean;
  onSave: (entries: Entry[]) => Promise<void>;
}) {
  const months = [startMonth];
  const entryFor = (
    month: string,
    category: string,
    status: "planned" | "done",
  ) =>
    budget.entries.find(
      (e) =>
        planningMonth(e) === month &&
        e.kind === "income" &&
        e.category === category &&
        e.status === status,
    );
  return (
    <section className="panel" style={{ marginBottom: 23 }}>
      <div className="panelhead">
        <div>
          <h2>Monthly income plan</h2>
          <p>
            All amounts entered here fund the selected month, even if Salary or
            Commission were paid late in the previous month.
          </p>
        </div>
        <CalendarDays size={20} />
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          let next = [...budget.entries];
          for (const month of months) {
            for (const [category, name] of incomeStreams) {
              const done = entryFor(month, category, "done");
              if (done) continue;
              const value = String(
                form.get(`${month}-${category}`) || "",
              ).trim();
              const existing = entryFor(month, category, "planned");
              if (!value || Number(value) <= 0) {
                if (existing) next = next.filter((e) => e.id !== existing.id);
                continue;
              }
              const amount = Number(value);
              if (!Number.isFinite(amount) || amount > 1e9) return;
              if (existing)
                next = next.map((e) =>
                  e.id === existing.id
                    ? {
                        ...e,
                        amount,
                        date: incomeDate(month, category),
                        budgetMonth: month,
                      }
                    : e,
                );
              else
                next.push({
                  id: crypto.randomUUID(),
                  kind: "income",
                  category,
                  name,
                  amount,
                  date: incomeDate(month, category),
                  status: "planned",
                  essential: true,
                  note: "Monthly income plan",
                  budgetMonth: month,
                });
            }
          }
          await onSave(next);
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
            gap: 12,
            marginBottom: 18,
          }}
        >
          {months.map((month) => (
            <section
              key={month}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 13,
              }}
            >
              <strong
                style={{ display: "block", fontSize: 12, marginBottom: 10 }}
              >
                {new Date(month + "-01T12:00:00").toLocaleDateString("en-GB", {
                  month: "long",
                  year: "numeric",
                })}
              </strong>
              {incomeStreams.map(([category, name]) => {
                const done = entryFor(month, category, "done"),
                  planned = entryFor(month, category, "planned");
                return (
                  <label key={category} style={{ marginBottom: 10 }}>
                    {name}
                    <input
                      name={`${month}-${category}`}
                      type="number"
                      min="0"
                      max="1000000000"
                      step="0.01"
                      inputMode="decimal"
                      disabled={Boolean(done)}
                      defaultValue={done?.amount ?? planned?.amount ?? ""}
                      placeholder={done ? "Received" : "EGP"}
                    />
                    {done && (
                      <small className="hint">
                        Received · kept in this budget month
                      </small>
                    )}
                  </label>
                );
              })}
            </section>
          ))}
        </div>
        <p className="hint">
          Use “Add transaction” to plan this month’s expenses and savings
          transfers. Actual cash left after paid items carries into the next
          month automatically.
        </p>
        <button className="primary" disabled={busy}>
          Save monthly income plan <Check size={16} />
        </button>
      </form>
    </section>
  );
}

function MonthlyPlan({
  month,
  entries,
  totals: monthly,
  cash,
  busy,
  onAdd,
  onEdit,
  onOpenTransactions,
}: {
  month: string;
  entries: Entry[];
  totals: ReturnType<typeof totals>;
  cash: number;
  busy: boolean;
  onAdd: (kind: Entry["kind"]) => void;
  onEdit: (entry: Entry) => void;
  onOpenTransactions: () => void;
}) {
  const title = new Date(month + "-01T12:00:00").toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
  const planned = entries
    .filter((e) => e.status === "planned")
    .sort((a, b) => a.date.localeCompare(b.date));
  return (
    <>
      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="panelhead">
          <div>
            <p className="eyebrow">ONE MONTH AT A TIME</p>
            <h2>Plan {title}</h2>
            <p>
              Choose the month above first. Everything below belongs only to{" "}
              {title}.
            </p>
          </div>
          <CalendarDays size={22} />
        </div>
        <div className="balance-grid">
          <div>
            <strong>Planned income · EGP {money(monthly.income)}</strong>
            <p>
              Received: EGP {money(monthly.received)} · planned: EGP{" "}
              {money(round(monthly.income - monthly.received))}
            </p>
          </div>
          <div>
            <strong>
              Planned outgoings · EGP{" "}
              {money(round(monthly.expenses + monthly.savings))}
            </strong>
            <p>
              Expenses: EGP {money(monthly.expenses)} · savings: EGP{" "}
              {money(monthly.savings)}
            </p>
          </div>
          <div>
            <strong>Actual cash today · EGP {money(cash)}</strong>
            <p>
              Paid, unspent money carries forward automatically into the next
              month.
            </p>
          </div>
        </div>
        <div className="backup-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => onAdd("income")}
          >
            <Plus size={16} /> Plan income
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => onAdd("expense")}
          >
            <Plus size={16} /> Plan expense
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => onAdd("saving")}
          >
            <Plus size={16} /> Plan savings
          </button>
        </div>
      </section>
      <section className="panel">
        <div className="panelhead">
          <div>
            <h2>{title} plan</h2>
            <p>
              {planned.length
                ? `${planned.length} planned item${planned.length === 1 ? "" : "s"} · edit amounts or categories any time`
                : "Start by adding the income, expenses and savings you expect this month."}
            </p>
          </div>
          <button className="textbutton" onClick={onOpenTransactions}>
            View all <ArrowRight size={15} />
          </button>
        </div>
        {planned.length ? (
          <div className="transaction-list">
            {planned.map((entry) => (
              <button
                key={entry.id}
                className="transaction"
                style={{ width: "100%", textAlign: "left" }}
                onClick={() => onEdit(entry)}
              >
                <div className="transaction-name">
                  <span className={"transaction-icon " + entry.kind}>
                    {entry.kind === "income" ? (
                      <ArrowDownLeft size={18} />
                    ) : entry.kind === "saving" ? (
                      <PiggyBank size={18} />
                    ) : (
                      <ArrowUpRight size={18} />
                    )}
                  </span>
                  <div>
                    <strong>{entry.name}</strong>
                    <small>{entry.category}</small>
                  </div>
                </div>
                <span className="transaction-date">
                  {budgetMonthLabel(planningMonth(entry))}
                </span>
                <span className="status planned">Planned</span>
                <strong className={"amount " + entry.kind}>
                  {entry.kind === "income" ||
                  (entry.kind === "saving" && entry.direction === "withdrawal")
                    ? "+"
                    : "−"}{" "}
                  {money(entry.amount)}
                  <small>EGP</small>
                </strong>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty">
            <CalendarDays size={26} />
            <h3>{title} is ready to plan.</h3>
            <p>
              Add the first income, expense or savings transfer for this month.
            </p>
          </div>
        )}
        <p className="hint" style={{ marginTop: 14 }}>
          When the month ends, choose the next month above. Do not add leftover
          cash again: completed cash is already carried forward. Use Correct a
          balance only when your real balance differs.
        </p>
      </section>
    </>
  );
}

function BalancePanel({
  budget,
  cash,
  savings,
  actual,
  busy,
  onSave,
  onUpdate,
  onDelete,
}: {
  budget: Budget;
  cash: number;
  savings: number;
  actual: ReturnType<typeof totals>;
  busy: boolean;
  onSave: (
    account: "cash" | "savings",
    target: number,
    note: string,
  ) => Promise<void>;
  onUpdate: (a: Adjustment) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [account, setAccount] = useState<"cash" | "savings">("cash"),
    [target, setTarget] = useState(String(cash)),
    [note, setNote] = useState(""),
    [show, setShow] = useState(false);
  const cashCorrections = round(
    budget.adjustments
      .filter((x) => x.account === "cash" && x.date <= today())
      .reduce((s, x) => s + x.amount, 0),
  );
  const savingsCorrections = round(
    budget.adjustments
      .filter((x) => x.account === "savings" && x.date <= today())
      .reduce((s, x) => s + x.amount, 0),
  );
  return (
    <section className="panel balance-panel">
      <div className="panelhead">
        <div>
          <h2>How your balances are calculated</h2>
          <p>
            Only completed entries change today's balances. Plans affect
            forecasts.
          </p>
        </div>
        <button className="secondary" onClick={() => setShow(!show)}>
          <Pencil size={16} /> {show ? "Hide corrections" : "Correct a balance"}
        </button>
      </div>
      <div className="balance-grid">
        <div>
          <strong>Cash today · EGP {money(cash)}</strong>
          <p>
            Opening {money(budget.opening)} + received {money(actual.received)}{" "}
            − paid {money(actual.paid)} − net savings transfers{" "}
            {money(actual.saved)} + corrections {money(cashCorrections)}
          </p>
        </div>
        <div>
          <strong>Savings today · EGP {money(savings)}</strong>
          <p>
            Opening {money(budget.openingSavings)} + net savings transfers{" "}
            {money(actual.saved)} + corrections {money(savingsCorrections)}
          </p>
        </div>
      </div>
      <p className="hint">
        The opening balances apply at the start of{" "}
        {dateLabel(budget.openingDate)}. Earlier completed transactions appear
        in their months but are already part of your opening balance.
      </p>
      {show && (
        <>
          <form
            className="balance-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const n = Number(target);
              if (!Number.isFinite(n) || Math.abs(n) > 1e9 || !note.trim())
                return;
              await onSave(account, n, note.trim());
            }}
          >
            <label>
              Account
              <select
                value={account}
                onChange={(e) => {
                  const a = e.target.value as "cash" | "savings";
                  setAccount(a);
                  setTarget(String(a === "cash" ? cash : savings));
                }}
              >
                <option value="cash">Cash</option>
                <option value="savings">Savings</option>
              </select>
            </label>
            <label>
              Actual balance now (EGP)
              <input
                type="number"
                step="0.01"
                required
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </label>
            <label>
              Reason for correction
              <input
                required
                maxLength={400}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Bank balance checked"
              />
            </label>
            <button className="primary" disabled={busy}>
              Save correction
            </button>
          </form>
          <p className="hint">
            The difference is saved as a dated correction, so your transaction
            history remains intact. Edit or remove any correction below.
          </p>
          {[...budget.adjustments].reverse().map((x) => (
            <AdjustmentEditor
              key={x.id}
              adjustment={x}
              busy={busy}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </>
      )}
    </section>
  );
}
function AdjustmentEditor({
  adjustment,
  busy,
  onUpdate,
  onDelete,
}: {
  adjustment: Adjustment;
  busy: boolean;
  onUpdate: (a: Adjustment) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(adjustment.amount)),
    [note, setNote] = useState(adjustment.note),
    [date, setDate] = useState(adjustment.date);
  return (
    <form
      className="adjustment-row"
      onSubmit={async (e) => {
        e.preventDefault();
        await onUpdate({
          ...adjustment,
          date,
          amount: Number(amount),
          note: note.trim(),
        });
      }}
    >
      <span>{adjustment.account}</span>
      <input
        aria-label="Correction date"
        type="date"
        max={today()}
        required
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <input
        aria-label="Correction amount"
        type="number"
        step="0.01"
        required
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <input
        aria-label="Correction reason"
        required
        maxLength={400}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button type="submit" className="secondary" disabled={busy}>
        Save
      </button>
      <button
        type="button"
        className="iconbutton"
        aria-label="Delete correction"
        disabled={busy}
        onClick={() => {
          if (confirm("Delete this balance correction?"))
            onDelete(adjustment.id);
        }}
      >
        <Trash2 size={16} />
      </button>
    </form>
  );
}

function EntryDialog({
  entry,
  busy,
  error,
  close,
  save,
}: {
  entry: Entry;
  busy: boolean;
  error: string;
  close: () => void;
  save: (e: Entry, repeat: number) => Promise<void>;
}) {
  const [e, setE] = useState(entry),
    [repeat, setRepeat] = useState(0),
    [err, setErr] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function change(k: keyof Entry, v: unknown) {
    setE((p) => ({ ...p, [k]: v }));
  }
  const selectedMonth = e.budgetMonth || monthOf(e.date),
    selectedMonthLabel = new Date(
      selectedMonth + "-01T12:00:00",
    ).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return (
    <dialog ref={dialog} onCancel={close} className="entrydialog">
      <div className="dialoghead">
        <div>
          <p className="eyebrow">MAKE IT COUNT</p>
          <h2>{entry.name ? "Edit transaction" : "Add a transaction"}</h2>
        </div>
        <button
          className="iconbutton"
          aria-label="Close dialog"
          disabled={busy}
          onClick={close}
        >
          <X size={22} />
        </button>
      </div>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          const saved = {
            ...e,
            budgetMonth: selectedMonth,
            date: e.status === "done" ? today() : selectedMonth + "-01",
            fundingSource:
              e.kind === "saving" && e.direction !== "withdrawal"
                ? e.fundingSource || "Salary"
                : undefined,
          };
          const parsed = entrySchema.safeParse(saved);
          if (!parsed.success) {
            setErr(
              "Enter a name and a positive amount with up to two decimals.",
            );
            return;
          }
          setErr("");
          await save(parsed.data, repeat);
        }}
      >
        <div className="kindtabs">
          {(["expense", "income", "saving"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={e.kind === k ? "selected" : ""}
              onClick={() => {
                setE({
                  ...e,
                  kind: k,
                  category:
                    k === "income"
                      ? "Salary"
                      : k === "saving"
                        ? "Emergency fund"
                        : "Other",
                });
              }}
            >
              {k === "saving" ? "Savings" : k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
        {e.kind === "saving" && (
          <>
            <label>
              Transfer direction
              <select
                value={e.direction || "deposit"}
                onChange={(ev) => change("direction", ev.target.value)}
              >
                <option value="deposit">Move cash into savings</option>
                <option value="withdrawal">Move savings back to cash</option>
              </select>
            </label>
            {(e.direction || "deposit") === "deposit" && (
              <label>
                Savings funded by
                <select
                  value={e.fundingSource || "Salary"}
                  onChange={(ev) => change("fundingSource", ev.target.value)}
                >
                  <option>Salary</option>
                  <option>Commission</option>
                  <option>Private income</option>
                  <option>Extra / unexpected</option>
                  <option>Other</option>
                </select>
              </label>
            )}
          </>
        )}
        <label>
          Name
          <input
            autoFocus
            required
            maxLength={100}
            value={e.name}
            onChange={(ev) => change("name", ev.target.value)}
            placeholder="e.g. Groceries, Salary, Coffee"
          />
        </label>
        <label>
          Amount (EGP)
          <input
            required
            type="number"
            min="0.01"
            max="1000000000"
            step="0.01"
            inputMode="decimal"
            value={e.amount || ""}
            onChange={(ev) => change("amount", Number(ev.target.value))}
          />
        </label>
        <div className="formrow">
          <label>
            Category <span className="muted">choose or type your own</span>
            <input
              list="entry-category-options"
              required
              maxLength={60}
              value={e.category}
              onChange={(ev) => change("category", ev.target.value)}
              placeholder="Choose or type a category"
            />
            <datalist id="entry-category-options">
              {(e.kind === "income"
                ? ["Salary", "Commission", "Private", "Other income"]
                : e.kind === "saving"
                  ? ["Emergency fund", "Other savings"]
                  : categories
              ).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </datalist>
          </label>
          <label>
            Status
            <select
              value={e.status}
              onChange={(ev) => change("status", ev.target.value)}
            >
              <option value="planned">Planned</option>
              <option value="done">
                {e.kind === "income"
                  ? "Received"
                  : e.kind === "saving"
                    ? "Saved"
                    : "Paid"}
              </option>
            </select>
          </label>
        </div>
        <p className="hint entry-hint">
          This item belongs only to the {selectedMonthLabel} budget. There is no
          transaction date to choose here.
        </p>
        {e.kind === "expense" && (
          <label className="checklabel">
            <input
              type="checkbox"
              checked={e.essential}
              onChange={(ev) => change("essential", ev.target.checked)}
            />{" "}
            Essential expense <span>(uncheck for flexible spending)</span>
          </label>
        )}
        <label>
          Note <span className="muted">optional</span>
          <textarea
            maxLength={400}
            rows={2}
            value={e.note}
            onChange={(ev) => change("note", ev.target.value)}
          />
        </label>
        {!entry.name && (
          <label>
            Repeat monthly
            <select
              value={repeat}
              onChange={(ev) => setRepeat(Number(ev.target.value))}
            >
              <option value={0}>Just this entry</option>
              <option value={3}>3 months total</option>
              <option value={6}>6 months total</option>
              <option value={12}>12 months total</option>
            </select>
          </label>
        )}
        {(err || error) && (
          <p className="negative" role="alert">
            {err || error}
          </p>
        )}
        <div className="dialogfooter">
          <button
            type="button"
            className="secondary"
            onClick={close}
            disabled={busy}
          >
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save transaction"}
            <Check size={17} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
