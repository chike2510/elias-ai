"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, Check, CircleDollarSign, House, Plus, ShoppingBasket, Sparkles, Trash2, TrainFront } from "lucide-react";
import StandaloneAppShell from "./StandaloneAppShell";
import { getBudgetSummary, type BudgetEntry } from "@/lib/standaloneExperiences.mjs";

const entriesKey = "elias-idea-budget-entries-v1";
const budgetsKey = "elias-idea-budget-limits-v1";
const savingsKey = "elias-idea-budget-savings-v1";
const starterBudgets: Record<string, number> = { Groceries: 520, Home: 280, Transport: 180, Everyday: 260 };
const demoEntries: BudgetEntry[] = [
  { id: "t1", name: "Market & produce", amount: 46.8, category: "Groceries", date: "2026-10-04" },
  { id: "t2", name: "Bus pass", amount: 28, category: "Transport", date: "2026-10-03" },
  { id: "t3", name: "Household supplies", amount: 32.4, category: "Home", date: "2026-10-02" },
  { id: "t4", name: "Lunch with Sam", amount: 19.5, category: "Everyday", date: "2026-10-01" },
  { id: "t5", name: "Corner shop", amount: 12.75, category: "Groceries", date: "2026-09-30" },
];
const categoryIcons: Record<string, typeof ShoppingBasket> = { Groceries: ShoppingBasket, Home: House, Transport: TrainFront, Everyday: Sparkles };
const formatMoney = (amount: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);

type Savings = { current: number; goal: number };

export default function BudgetTracker() {
  const [entries, setEntries] = useState<BudgetEntry[]>(demoEntries);
  const [budgets, setBudgets] = useState(starterBudgets);
  const [savings, setSavings] = useState<Savings>({ current: 640, goal: 1200 });
  const [ready, setReady] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Groceries");
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const savedEntries = localStorage.getItem(entriesKey);
      const savedBudgets = localStorage.getItem(budgetsKey);
      const savedSavings = localStorage.getItem(savingsKey);
      if (savedEntries) setEntries(JSON.parse(savedEntries) as BudgetEntry[]);
      if (savedBudgets) setBudgets(JSON.parse(savedBudgets) as Record<string, number>);
      if (savedSavings) setSavings(JSON.parse(savedSavings) as Savings);
    } catch { setMessage("Saved demo data could not be loaded; a fresh sample is ready."); }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(entriesKey, JSON.stringify(entries));
    localStorage.setItem(budgetsKey, JSON.stringify(budgets));
    localStorage.setItem(savingsKey, JSON.stringify(savings));
  }, [entries, budgets, savings, ready]);

  const summary = useMemo(() => getBudgetSummary(entries, budgets), [entries, budgets]);
  const savingsPercent = savings.goal > 0 ? Math.min(100, Math.round((savings.current / savings.goal) * 100)) : 0;
  const latest = useMemo(() => [...entries].sort((a, b) => b.date.localeCompare(a.date)), [entries]);

  function addEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number(amount);
    if (!name.trim() || !Number.isFinite(parsed) || parsed <= 0) return;
    const entry: BudgetEntry = { id: `tx-${Date.now()}`, name: name.trim(), amount: Math.round(parsed * 100) / 100, category, date: new Date().toISOString().slice(0, 10) };
    setEntries((current) => [entry, ...current]);
    setName(""); setAmount(""); setShowForm(false);
    setMessage("Expense added to this device's budget.");
  }

  function removeEntry(id: string) {
    setEntries((current) => current.filter((entry) => entry.id !== id));
    setMessage("Expense removed.");
  }

  function updateBudget(categoryName: string, value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setBudgets((current) => ({ ...current, [categoryName]: parsed }));
  }

  return (
    <StandaloneAppShell active="/budget">
      <div className="idea-page budget-page">
        <div className="idea-page-heading budget-heading"><div><p className="idea-eyebrow">03 / MONEY, WITHOUT THE NOISE</p><h1>Know where it <em>went.</em></h1><p>A quieter monthly check-in: add spending by hand, set a few guardrails, and keep your bank login out of the picture.</p></div><div className="budget-month-chip"><CalendarDays size={15} /> Local demo · USD</div></div>
        <div className="budget-summary-grid">
          <article className="budget-summary-card budget-summary-feature"><span className="budget-summary-label">Spent this month</span><strong>{formatMoney(summary.spent)}</strong><div className="budget-summary-foot"><span>{formatMoney(summary.remaining)} left of {formatMoney(summary.planned)}</span><span>{summary.percent}%</span></div><div className="budget-meter"><span style={{ width: `${summary.percent}%` }} /></div></article>
          <article className="budget-summary-card"><span className="budget-summary-label">Monthly plan</span><strong>{formatMoney(summary.planned)}</strong><span className="budget-small-foot">Across {Object.keys(budgets).length} simple buckets</span></article>
          <article className="budget-summary-card budget-savings-card"><span className="budget-summary-label">Savings pot</span><strong>{formatMoney(savings.current)}</strong><div className="savings-meter"><span style={{ width: `${savingsPercent}%` }} /></div><div className="budget-summary-foot"><span>{savingsPercent}% of {formatMoney(savings.goal)}</span><button type="button" onClick={() => setSavings((current) => ({ ...current, current: current.current + 25 }))}>+ $25 saved</button></div></article>
        </div>

        <div className="budget-layout">
          <section className="idea-panel budget-category-panel"><div className="idea-panel-heading"><div><p className="idea-eyebrow">YOUR GUARDRAILS</p><h2>Category check-in</h2></div><span className="budget-edit-note">Limits are editable</span></div>
            <div className="budget-category-list">{summary.categories.map((item) => {
              const Icon = categoryIcons[item.category] || CircleDollarSign;
              return <article className="budget-category-row" key={item.category}><div className="budget-category-icon"><Icon size={17} /></div><div className="budget-category-main"><div className="budget-category-head"><div><strong>{item.category}</strong><span>{formatMoney(item.amount)} spent</span></div><label className="budget-limit-field"><span>of</span><span className="sr-only">Monthly {item.category} limit in dollars</span><span>$</span><input type="number" min="0" step="10" value={budgets[item.category] ?? 0} onChange={(event) => updateBudget(item.category, event.target.value)} /></label></div><div className={`budget-category-meter${item.remaining < 0 ? " is-over" : ""}`}><span style={{ width: `${item.percent}%` }} /></div><small>{item.remaining >= 0 ? `${formatMoney(item.remaining)} remaining` : `${formatMoney(Math.abs(item.remaining))} over this limit`}</small></div></article>;
            })}</div>
            <div className="budget-honesty"><CircleDollarSign size={17} /><p>Manual tracking only. No bank connections, financial advice, or account credentials.</p></div>
          </section>

          <section className="idea-panel budget-transactions"><div className="idea-panel-heading"><div><p className="idea-eyebrow">THE LITTLE THINGS ADD UP</p><h2>Recent spending</h2></div><button type="button" className="idea-button idea-button-primary" onClick={() => setShowForm((value) => !value)}><Plus size={15} /> Add expense</button></div>
            {showForm && <form className="budget-add-form" onSubmit={addEntry}><label className="idea-label">What was it?<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Weekly market" maxLength={60} required /></label><label className="idea-label">Amount<input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label><label className="idea-label">Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{Object.keys(budgets).map((item) => <option key={item}>{item}</option>)}</select></label><button className="idea-button idea-button-primary" type="submit"><Check size={14} /> Save expense</button></form>}
            <div className="budget-transaction-list">{latest.slice(0, 7).map((entry) => {
              const Icon = categoryIcons[entry.category] || CircleDollarSign;
              return <article className="budget-transaction" key={entry.id}><div className="budget-transaction-icon"><Icon size={16} /></div><div className="budget-transaction-copy"><strong>{entry.name}</strong><span>{entry.category} · {new Date(`${entry.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div><b>−{formatMoney(entry.amount)}</b><button type="button" className="budget-remove" aria-label={`Remove ${entry.name}`} onClick={() => removeEntry(entry.id)}><Trash2 size={14} /></button></article>;
            })}</div>
            {latest.length === 0 && <p className="idea-muted-note">Add an expense to see it here.</p>}
            <div className="budget-next-step"><ArrowDownRight size={16} /><span>Small, regular check-ins beat a perfect spreadsheet.</span><ArrowUpRight size={14} /></div>
          </section>
        </div>
        {message && <p className="idea-status" role="status">{message}</p>}
      </div>
    </StandaloneAppShell>
  );
}
