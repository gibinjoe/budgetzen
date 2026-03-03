// localStorage shim for window.storage
window.storage = {
  async get(key) {
    const val = localStorage.getItem(key);
    return val ? { key, value: val } : (() => { throw new Error("not found"); })();
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { key, value };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { key, deleted: true };
  },
};

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ─── Helpers ────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10);
const fmt = (n) => { const a = Math.abs(n); const s = a.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); return n < 0 ? `-$${s}` : `$${s}`; };
const today = () => new Date().toISOString().slice(0, 10);
const monthKey = (d) => d.slice(0, 7);
const monthLabel = (mk) => { const [y, m] = mk.split("-"); return new Date(y, m - 1).toLocaleDateString("en-US", { month: "short", year: "numeric" }); };
const prevMonth = (mk) => { const [y, m] = mk.split("-").map(Number); const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const nextMonth = (mk) => { const [y, m] = mk.split("-").map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
const FLAG_COLORS = { none: "transparent", red: "#ef4444", orange: "#f97316", yellow: "#eab308", green: "#22c55e", blue: "#3b82f6", purple: "#8b5cf6" };

// Build a clean transaction object (Bug #1,#3 fix: no junk fields)
function buildTxn({ id, date, payee, categoryId, accountId, amount, type, memo, isTransfer, transferToAccountId, cleared, reconciled, flag, splits, isStartingBal, transferPairId }) {
  const t = { id: id || uid(), date, payee: payee || "", categoryId: categoryId || "", accountId, amount: Math.abs(parseFloat(amount) || 0), type: type || "outflow", memo: memo || "", isTransfer: !!isTransfer, transferToAccountId: transferToAccountId || "", cleared: !!cleared, reconciled: !!reconciled, flag: flag || "none" };
  if (splits && splits.length > 0) t.splits = splits;
  if (isStartingBal) t.isStartingBal = true;
  if (transferPairId) t.transferPairId = transferPairId;
  return t;
}

const CC_GROUP_ID = "grp_cc";
const DEFAULT_GROUPS = [
  { id: CC_GROUP_ID, name: "Credit Card Payments", isCCGroup: true, categories: [] },
  { id: "grp1", name: "Immediate Obligations", categories: [
    { id: "cat1", name: "Rent / Mortgage" }, { id: "cat2", name: "Electric" }, { id: "cat3", name: "Water" },
    { id: "cat4", name: "Internet" }, { id: "cat5", name: "Groceries" }
  ]},
  { id: "grp2", name: "True Expenses", categories: [
    { id: "cat6", name: "Auto Maintenance" }, { id: "cat7", name: "Home Maintenance" },
    { id: "cat8", name: "Medical" }, { id: "cat9", name: "Clothing" }, { id: "cat10", name: "Gifts" }
  ]},
  { id: "grp3", name: "Debt Payments", categories: [{ id: "cat11", name: "Student Loan" }] },
  { id: "grp4", name: "Quality of Life", categories: [
    { id: "cat13", name: "Dining Out" }, { id: "cat14", name: "Entertainment" },
    { id: "cat15", name: "Hobbies" }, { id: "cat16", name: "Vacation" }
  ]},
  { id: "grp5", name: "Savings Goals", categories: [
    { id: "cat17", name: "Emergency Fund" }, { id: "cat18", name: "Rainy Day Fund" }
  ]},
];
const DEFAULT_ACCOUNTS = [
  { id: "acc1", name: "Checking", type: "checking", onBudget: true },
  { id: "acc2", name: "Savings", type: "savings", onBudget: true },
];

// ─── Icons ──────────────────────────────────────────────────────────
const I = {
  Budget: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>,
  Accounts: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>,
  Reports: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>,
  Plus: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>,
  ChevL: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>,
  ChevR: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>,
  ChevD: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>,
  Trash: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>,
  X: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>,
  Check: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>,
  Transfer: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>,
  Menu: () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>,
  Search: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>,
  Edit: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>,
  Move: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>,
  Target: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  Lock: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  Wand: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8l1.4 1.4M10.8 11.8l-1.4 1.4M17.8 6.2l1.4-1.4M10.8 6.2l-1.4-1.4"/><path d="M9 18l6-6"/><path d="M3 22l6-6"/></svg>,
  Split: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>,
  Clock: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
  Repeat: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>,
  CC: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>,
  Export: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Import: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
};

// ─── Storage ────────────────────────────────────────────────────────
const SK = "ynab-v4";
async function load() { try { const r = await window.storage.get(SK); return r ? JSON.parse(r.value) : null; } catch { return null; } }
async function save(d) { try { await window.storage.set(SK, JSON.stringify(d)); } catch (e) { console.error(e); } }

// ═══════════════════════════════════════════════════════════════════
//  APP
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("budget");
  const [selAcc, setSelAcc] = useState(null);
  const [curMonth, setCurMonth] = useState(monthKey(today()));
  const [groups, setGroups] = useState(DEFAULT_GROUPS);
  const [accounts, setAccounts] = useState(DEFAULT_ACCOUNTS);
  const [txns, setTxns] = useState([]);
  const [assigns, setAssigns] = useState({});
  const [targets, setTargets] = useState({});
  const [scheduled, setScheduled] = useState([]);
  const [modal, setModal] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [sidebar, setSidebar] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [reportTab, setReportTab] = useState("spending");
  const editRef = useRef(null);
  const fileInputRef = useRef(null);

  // Load
  useEffect(() => { (async () => { const d = await load(); if (d) { d.groups && setGroups(d.groups); d.accounts && setAccounts(d.accounts); d.txns && setTxns(d.txns); d.assigns && setAssigns(d.assigns); d.targets && setTargets(d.targets); d.scheduled && setScheduled(d.scheduled); } setLoaded(true); })(); }, []);

  // Save
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => save({ groups, accounts, txns, assigns, targets, scheduled }), 500); return () => clearTimeout(t); }, [groups, accounts, txns, assigns, targets, scheduled, loaded]);

  // Process scheduled transactions (Bug #10 fix: strip schedule fields)
  useEffect(() => {
    if (!loaded || scheduled.length === 0) return;
    const todayStr = today();
    const newTxns = [];
    const updatedScheduled = scheduled.map(s => {
      let nextDate = s.nextDate;
      let count = 0;
      while (nextDate <= todayStr && count < 12) {
        newTxns.push(buildTxn({ date: nextDate, payee: s.payee, categoryId: s.categoryId, accountId: s.accountId, amount: s.amount, type: s.type, memo: s.memo || "Scheduled", isTransfer: false, cleared: false, flag: "none" }));
        if (s.frequency === "monthly") { const [y,m,d] = nextDate.split("-").map(Number); const nd = new Date(y, m, d); nextDate = nd.toISOString().slice(0,10); }
        else if (s.frequency === "weekly") { const nd = new Date(nextDate); nd.setDate(nd.getDate()+7); nextDate = nd.toISOString().slice(0,10); }
        else if (s.frequency === "biweekly") { const nd = new Date(nextDate); nd.setDate(nd.getDate()+14); nextDate = nd.toISOString().slice(0,10); }
        else if (s.frequency === "yearly") { const [y2,m2,d2] = nextDate.split("-").map(Number); nextDate = `${y2+1}-${String(m2).padStart(2,"0")}-${String(d2).padStart(2,"0")}`; }
        else break;
        count++;
      }
      return { ...s, nextDate };
    });
    if (newTxns.length > 0) { setTxns(prev => [...newTxns, ...prev]); setScheduled(updatedScheduled); }
  }, [loaded]);

  // Ensure CC payment categories exist
  useEffect(() => { if (!loaded) return; setGroups(prev => { const cg = prev.find(g => g.isCCGroup); if (!cg) return prev; const linked = new Set(cg.categories.map(c => c.linkedAccountId)); const ccAs = accounts.filter(a => a.type === "credit" && a.onBudget); const nc = []; ccAs.forEach(a => { if (!linked.has(a.id)) nc.push({ id: `ccpay_${a.id}`, name: a.name, linkedAccountId: a.id }); }); if (!nc.length) return prev; return prev.map(g => g.isCCGroup ? { ...g, categories: [...g.categories, ...nc] } : g); }); }, [accounts, loaded]);

  // Derived
  const budgetAccs = useMemo(() => accounts.filter(a => a.onBudget), [accounts]);
  const trackingAccs = useMemo(() => accounts.filter(a => !a.onBudget), [accounts]);
  const allCats = useMemo(() => { const c = []; groups.forEach(g => g.categories.forEach(cat => c.push({ ...cat, groupId: g.id, groupName: g.name, isCC: !!g.isCCGroup }))); return c; }, [groups]);
  const budgetCats = useMemo(() => allCats.filter(c => !c.isCC), [allCats]);
  const catMap = useMemo(() => { const m = {}; allCats.forEach(c => m[c.id] = c); return m; }, [allCats]);
  const accMap = useMemo(() => { const m = {}; accounts.forEach(a => m[a.id] = a); return m; }, [accounts]);
  const ccPayCat = useMemo(() => { const m = {}; const cg = groups.find(g => g.isCCGroup); if (cg) cg.categories.forEach(c => { if (c.linkedAccountId) m[c.linkedAccountId] = c.id; }); return m; }, [groups]);
  const ccAccForCat = useMemo(() => { const m = {}; Object.entries(ccPayCat).forEach(([aId, cId]) => m[cId] = aId); return m; }, [ccPayCat]);
  const payeeList = useMemo(() => { const s = new Set(); txns.forEach(t => { if (t.payee && !t.isTransfer) s.add(t.payee); }); return [...s].sort(); }, [txns]);

  // Budget calcs
  const getBudgeted = useCallback((cId, mk) => assigns[`${mk}_${cId}`] || 0, [assigns]);

  // Activity: sum of category transactions, excluding transfers and starting balances
  const getActivity = useCallback((cId, mk) => {
    return txns.filter(t => t.categoryId === cId && monthKey(t.date) === mk && !t.isTransfer && !t.isStartingBal)
      .reduce((s, t) => s + (t.type === "inflow" ? t.amount : -t.amount), 0);
  }, [txns]);

  const allMonthsTo = useCallback((mk) => {
    const ms = new Set([mk]);
    txns.forEach(t => ms.add(monthKey(t.date)));
    Object.keys(assigns).forEach(k => ms.add(k.split("_")[0]));
    return [...ms].filter(m => m <= mk).sort();
  }, [txns, assigns]);

  // Bug #5 fix: CC auto-move caps at spending category available
  const getAvailable = useCallback((cId, toMk) => {
    let total = 0;
    const months = allMonthsTo(toMk);
    months.forEach(mk => {
      total += (assigns[`${mk}_${cId}`] || 0);
      total += txns.filter(t => t.categoryId === cId && monthKey(t.date) === mk && !t.isTransfer && !t.isStartingBal)
        .reduce((s, t) => s + (t.type === "inflow" ? t.amount : -t.amount), 0);
    });
    // CC payment categories: add auto-moved funds, capped at what was available in spending cat
    const linkedAcc = ccAccForCat[cId];
    if (linkedAcc) {
      // Calculate available for each spending category up to each month, then cap the move
      months.forEach(mk => {
        // CC spending: outflows on the CC account assigned to budget categories
        const ccOutflows = txns.filter(t => t.accountId === linkedAcc && monthKey(t.date) === mk && t.type === "outflow" && !t.isTransfer && !t.isStartingBal && t.categoryId && t.categoryId !== cId);
        ccOutflows.forEach(t => {
          // Calculate spending category's available BEFORE this transaction
          let catAvail = 0;
          months.filter(m => m <= mk).forEach(m2 => {
            catAvail += (assigns[`${m2}_${t.categoryId}`] || 0);
            catAvail += txns.filter(tx => tx.categoryId === t.categoryId && monthKey(tx.date) === m2 && !tx.isTransfer && !tx.isStartingBal)
              .reduce((s2, tx) => s2 + (tx.type === "inflow" ? tx.amount : -tx.amount), 0);
          });
          // Move min(spend, max(0, catAvail + spend)) — catAvail already includes this spend as negative
          const catAvailBefore = catAvail + t.amount; // add back this spend to get "before" amount
          total += Math.min(t.amount, Math.max(0, catAvailBefore));
        });
        // CC payments (transfers IN to CC) reduce payment available
        txns.filter(t => t.isTransfer && t.accountId === linkedAcc && t.type === "inflow" && monthKey(t.date) === mk)
          .forEach(t => { total -= t.amount; });
      });
    }
    return total;
  }, [assigns, txns, allMonthsTo, ccAccForCat]);

  // Ready to Assign: total income - total budgeted (excludes starting balances and tracking)
  const rta = useMemo(() => {
    const months = allMonthsTo(curMonth);
    let income = 0, budgeted = 0;
    months.forEach(mk => {
      txns.filter(t => {
        const a = accMap[t.accountId];
        return a && a.onBudget && monthKey(t.date) === mk && t.type === "inflow" && !t.isTransfer && !t.isStartingBal;
      }).forEach(t => income += t.amount);
      allCats.forEach(c => { budgeted += (assigns[`${mk}_${c.id}`] || 0); });
    });
    return income - budgeted;
  }, [txns, assigns, allCats, curMonth, accMap, allMonthsTo]);

  // Account balance (includes everything)
  const getAccBal = useCallback((aId) => txns.filter(t => t.accountId === aId).reduce((s, t) => s + (t.type === "inflow" ? t.amount : -t.amount), 0), [txns]);
  const getClearedBal = useCallback((aId) => txns.filter(t => t.accountId === aId && t.cleared).reduce((s, t) => s + (t.type === "inflow" ? t.amount : -t.amount), 0), [txns]);
  const getUnclearedBal = useCallback((aId) => txns.filter(t => t.accountId === aId && !t.cleared).reduce((s, t) => s + (t.type === "inflow" ? t.amount : -t.amount), 0), [txns]);

  // Age of Money
  const ageOfMoney = useMemo(() => {
    const inflows = txns.filter(t => t.type === "inflow" && !t.isTransfer && !t.isStartingBal && accMap[t.accountId]?.onBudget).sort((a, b) => a.date.localeCompare(b.date));
    const outflows = txns.filter(t => t.type === "outflow" && !t.isTransfer && !t.isStartingBal && accMap[t.accountId]?.onBudget).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
    if (inflows.length === 0 || outflows.length === 0) return null;
    let inflowPool = inflows.map(t => ({ date: t.date, remaining: t.amount }));
    const ages = [];
    outflows.forEach(out => {
      let needed = out.amount;
      for (let i = 0; i < inflowPool.length && needed > 0; i++) {
        if (inflowPool[i].remaining > 0) {
          const take = Math.min(needed, inflowPool[i].remaining);
          inflowPool[i].remaining -= take;
          needed -= take;
          ages.push(daysBetween(inflowPool[i].date, out.date));
        }
      }
    });
    return ages.length > 0 ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : null;
  }, [txns, accMap]);

  // ── Handlers ──────────────────────────────────────────────────────

  // Bug #1,#3 fix: addTxn uses buildTxn for clean data
  const addTxn = (t) => {
    const main = buildTxn(t);
    const txs = [main];
    if (main.isTransfer && main.transferToAccountId) {
      const pairId = uid();
      main.transferPairId = pairId;
      txs.push(buildTxn({
        date: main.date, payee: `Transfer: ${accMap[main.accountId]?.name || ""}`,
        categoryId: "", accountId: main.transferToAccountId, amount: main.amount,
        type: main.type === "outflow" ? "inflow" : "outflow", memo: main.memo,
        isTransfer: true, transferToAccountId: main.accountId, cleared: main.cleared,
        flag: "none", transferPairId: pairId,
      }));
    }
    setTxns(p => [...txs, ...p]);
  };

  // Bug #8 fix: updateTxn also updates mirror for transfers
  const updateTxn = (id, updates) => {
    setTxns(p => {
      const orig = p.find(t => t.id === id);
      if (!orig) return p;
      return p.map(t => {
        if (t.id === id) return { ...t, ...updates };
        // Update mirror transaction if this is a transfer pair
        if (orig.transferPairId && t.transferPairId === orig.transferPairId && t.id !== id) {
          const mirrorUpdates = {};
          if (updates.date) mirrorUpdates.date = updates.date;
          if (updates.amount !== undefined) mirrorUpdates.amount = updates.amount;
          if (updates.memo !== undefined) mirrorUpdates.memo = updates.memo;
          if (Object.keys(mirrorUpdates).length > 0) return { ...t, ...mirrorUpdates };
        }
        return t;
      });
    });
  };

  const delTxn = (id) => {
    setTxns(p => {
      const orig = p.find(t => t.id === id);
      if (orig?.transferPairId) return p.filter(t => t.transferPairId !== orig.transferPairId);
      return p.filter(t => t.id !== id);
    });
  };

  const toggleCleared = (id) => setTxns(p => p.map(t => t.id === id ? { ...t, cleared: !t.cleared } : t));

  // Bug #4 fix: addAcc first, then starting balance
  const addAccount = (a) => {
    const newAcc = { id: a.id, name: a.name, type: a.type, onBudget: a.onBudget };
    setAccounts(p => [...p, newAcc]);
    if (a.startingBal && a.startingBal !== 0) {
      const startTxn = buildTxn({
        date: today(), payee: "Starting Balance", categoryId: "", accountId: a.id,
        amount: Math.abs(a.startingBal), type: a.startingBal > 0 ? "inflow" : "outflow",
        memo: "Starting Balance", cleared: true, reconciled: true, isStartingBal: true,
      });
      setTxns(p => [startTxn, ...p]);
    }
  };

  const delAcc = (id) => { setAccounts(p => p.filter(a => a.id !== id)); setTxns(p => p.filter(t => t.accountId !== id)); setGroups(p => p.map(g => g.isCCGroup ? { ...g, categories: g.categories.filter(c => c.linkedAccountId !== id) } : g)); if (selAcc === id) setSelAcc(null); };

  const addGroup = (n) => setGroups(p => [...p, { id: uid(), name: n, categories: [] }]);
  const renameGroup = (gId, n) => setGroups(p => p.map(g => g.id === gId ? { ...g, name: n } : g));
  const delGroup = (gId) => { if (gId === CC_GROUP_ID) return; setGroups(p => p.filter(g => g.id !== gId)); };
  const addCat = (gId, n) => setGroups(p => p.map(g => g.id === gId ? { ...g, categories: [...g.categories, { id: uid(), name: n }] } : g));
  const renameCat = (gId, cId, n) => setGroups(p => p.map(g => g.id === gId ? { ...g, categories: g.categories.map(c => c.id === cId ? { ...c, name: n } : c) } : g));
  const delCat = (gId, cId) => setGroups(p => p.map(g => g.id === gId ? { ...g, categories: g.categories.filter(c => c.id !== cId) } : g));

  const setTarget = (cId, t) => setTargets(p => ({ ...p, [cId]: t }));
  const delTarget = (cId) => setTargets(p => { const n = { ...p }; delete n[cId]; return n; });

  const autoAssign = () => {
    let remaining = rta;
    if (remaining <= 0) return;
    const newAssigns = { ...assigns };
    allCats.filter(c => !c.isCC).forEach(c => {
      if (remaining <= 0) return;
      const t = targets[c.id];
      if (!t) return;
      const current = newAssigns[`${curMonth}_${c.id}`] || 0;
      let needed = 0;
      if (t.type === "monthly") needed = Math.max(0, t.amount - current);
      else if (t.type === "savings" && t.targetDate) {
        const avail = getAvailable(c.id, curMonth);
        const monthsLeft = Math.max(1, Math.round((new Date(t.targetDate) - new Date(curMonth + "-01")) / (30 * 86400000)));
        needed = Math.max(0, Math.ceil((t.amount - avail) / monthsLeft) - current);
      }
      const assign = Math.min(needed, remaining);
      if (assign > 0) { newAssigns[`${curMonth}_${c.id}`] = current + assign; remaining -= assign; }
    });
    setAssigns(newAssigns);
  };

  // Bug #7 fix: reconcile adjustment flagged as starting balance equivalent (won't affect budget)
  const reconcile = (accId, bankBal) => {
    const cleared = getClearedBal(accId);
    if (Math.abs(cleared - bankBal) > 0.005) {
      const diff = bankBal - cleared;
      const adj = buildTxn({
        date: today(), payee: "Reconciliation Adjustment", categoryId: "", accountId: accId,
        amount: Math.abs(diff), type: diff > 0 ? "inflow" : "outflow",
        memo: "Balance adjustment", cleared: true, reconciled: true, isStartingBal: true,
      });
      setTxns(p => [adj, ...p]);
    }
    setTxns(p => p.map(t => t.accountId === accId && t.cleared ? { ...t, reconciled: true } : t));
  };

  const moveMoney = (fromCatId, toCatId, amount) => {
    const fromKey = `${curMonth}_${fromCatId}`;
    const toKey = `${curMonth}_${toCatId}`;
    setAssigns(p => ({ ...p, [fromKey]: (p[fromKey] || 0) - amount, [toKey]: (p[toKey] || 0) + amount }));
  };

  const startEditBudget = (cId) => { const v = getBudgeted(cId, curMonth); setEditing({ cId, value: v === 0 ? "" : v.toFixed(2) }); setTimeout(() => editRef.current?.focus(), 50); };
  const commitEdit = () => { if (!editing) return; setBudgeted(editing.cId, curMonth, parseFloat(editing.value) || 0); setEditing(null); };
  const setBudgeted = (cId, mk, amt) => setAssigns(p => ({ ...p, [`${mk}_${cId}`]: amt }));

  const resetAll = async () => { if (!confirm("Reset all data?")) return; setGroups(DEFAULT_GROUPS); setAccounts(DEFAULT_ACCOUNTS); setTxns([]); setAssigns({}); setTargets({}); setScheduled([]); try { await window.storage.delete(SK); } catch {} };

  const exportData = () => {
    const data = { version: 4, exportedAt: new Date().toISOString(), groups, accounts, txns, assigns, targets, scheduled };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budgetzen-backup-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.groups || !data.accounts) { alert("Invalid backup file: missing required data."); return; }
        if (!confirm(`Import backup from ${data.exportedAt ? new Date(data.exportedAt).toLocaleDateString() : "unknown date"}?\n\nThis will replace ALL current data.`)) return;
        if (data.groups) setGroups(data.groups);
        if (data.accounts) setAccounts(data.accounts);
        if (data.txns) setTxns(data.txns);
        if (data.assigns) setAssigns(data.assigns);
        if (data.targets) setTargets(data.targets);
        if (data.scheduled) setScheduled(data.scheduled);
      } catch (err) {
        alert("Failed to read backup file. Make sure it's a valid BudgetZen JSON export.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  if (!loaded) return <div style={S.loading}><div style={S.spinner}/></div>;

  const totalBudget = budgetAccs.reduce((s, a) => s + getAccBal(a.id), 0);
  const totalTracking = trackingAccs.reduce((s, a) => s + getAccBal(a.id), 0);

  return (
    <div style={S.app}><style>{CSS}</style>
      {/* Sidebar */}
      <div className={`sb ${sidebar?"open":""}`} style={S.sb}>
        <div style={S.sbHead}>
          <div style={S.logo}><div style={S.logoI}>$</div><span style={S.logoT}>BudgetZen</span></div>
          <button className="sb-close" style={S.sbClose} onClick={()=>setSidebar(false)}><I.X/></button>
        </div>
        {ageOfMoney !== null && <div style={S.aom}><I.Clock/> Age of Money: <strong>{ageOfMoney} days</strong></div>}
        <nav style={S.nav}>
          {[{k:"budget",i:<I.Budget/>,l:"Budget"},{k:"accounts",i:<I.Accounts/>,l:"All Accounts"},{k:"reports",i:<I.Reports/>,l:"Reports"}].map(x=>
            <button key={x.k} style={{...S.navI,...(view===x.k&&!selAcc?S.navA:{})}} onClick={()=>{setView(x.k);setSelAcc(null);setSidebar(false)}}>{x.i}<span>{x.l}</span></button>
          )}
        </nav>
        <div style={S.sbSec}>
          <div style={S.sbSecH}><span style={S.sbSecT}>Budget</span><button style={S.addB} onClick={()=>setModal({type:"account",data:{onBudget:true}})}><I.Plus/></button></div>
          {budgetAccs.map(a=>{const b=getAccBal(a.id);return(
            <button key={a.id} style={{...S.accI,...(selAcc===a.id?S.accA:{})}} onClick={()=>{setView("accounts");setSelAcc(a.id);setSidebar(false)}}>
              <span style={S.dot(a.type)}/><span style={S.accN}>{a.name}{a.type==="credit"&&<span style={S.ccB}>CC</span>}</span>
              <span style={{...S.accBal,color:b<0?"#ef4444":"#94a3b8"}}>{fmt(b)}</span>
            </button>)})}
          <div style={S.totR}><span>Total</span><span style={{color:totalBudget<0?"#ef4444":"#e2e8f0"}}>{fmt(totalBudget)}</span></div>
        </div>
        <div style={S.sbSec}>
          <div style={S.sbSecH}><span style={S.sbSecT}>Tracking</span><button style={S.addB} onClick={()=>setModal({type:"account",data:{onBudget:false}})}><I.Plus/></button></div>
          {trackingAccs.length===0&&<div style={{padding:"2px 12px",fontSize:11,color:"#475569",fontStyle:"italic"}}>None yet</div>}
          {trackingAccs.map(a=>{const b=getAccBal(a.id);return(
            <button key={a.id} style={{...S.accI,...(selAcc===a.id?S.accA:{})}} onClick={()=>{setView("accounts");setSelAcc(a.id);setSidebar(false)}}>
              <span style={{...S.dot(a.type),opacity:.5}}/><span style={{...S.accN,color:"#64748b"}}>{a.name}</span>
              <span style={{...S.accBal,color:"#64748b"}}>{fmt(b)}</span>
            </button>)})}
          {trackingAccs.length>0&&<div style={{...S.totR,color:"#64748b"}}><span>Total</span><span>{fmt(totalTracking)}</span></div>}
        </div>
        <div style={S.sbBottom}>
          <button style={S.sbBtn} onClick={exportData}><I.Export/> Export Backup</button>
          <button style={S.sbBtn} onClick={()=>fileInputRef.current?.click()}><I.Import/> Import Backup</button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={importData} style={{display:"none"}}/>
          <button style={{...S.sbBtn,color:"#64748b",borderColor:"#33415580"}} onClick={resetAll}>Reset All Data</button>
        </div>
      </div>
      {sidebar&&<div style={S.overlay} onClick={()=>setSidebar(false)}/>}

      {/* Main */}
      <div style={S.main}>
        <div className="topbar" style={S.topBar}>
          <button className="menu-btn" style={S.menuB} onClick={()=>setSidebar(true)}><I.Menu/></button>
          <h1 style={S.pageT}>{view==="budget"?"Budget":view==="reports"?"Reports":selAcc?accMap[selAcc]?.name:"All Accounts"}
            {selAcc&&accMap[selAcc]&&!accMap[selAcc].onBudget&&<span style={S.trackBadge}>Tracking</span>}
          </h1>
          {view==="budget"&&<div style={S.mNav}><button style={S.mBtn} onClick={()=>setCurMonth(prevMonth(curMonth))}><I.ChevL/></button><span style={S.mLbl}>{monthLabel(curMonth)}</span><button style={S.mBtn} onClick={()=>setCurMonth(nextMonth(curMonth))}><I.ChevR/></button></div>}
          {view==="accounts"&&<button style={S.priBtn} onClick={()=>setModal({type:"txn",data:{accountId:selAcc||budgetAccs[0]?.id||accounts[0]?.id}})}><I.Plus/> Transaction</button>}
        </div>
        <div className="content" style={S.content}>
          {view==="budget"&&<BudgetView {...{groups,curMonth,getBudgeted,getActivity,getAvailable,rta,collapsed,targets,
            toggle:gId=>setCollapsed(p=>({...p,[gId]:!p[gId]})),editing,startEditBudget,commitEdit,setEditing,editRef,
            onAddGroup:()=>setModal({type:"grpForm"}),onAddCat:gId=>setModal({type:"catForm",data:{gId}}),
            onDelCat:delCat,onDelGroup:delGroup,
            onRenameCat:(gId,cId)=>setModal({type:"rename",data:{gId,cId,current:catMap[cId]?.name||""}}),
            onRenameGroup:gId=>setModal({type:"renameGrp",data:{gId,current:groups.find(g=>g.id===gId)?.name||""}}),
            onAddTxn:()=>setModal({type:"txn",data:{accountId:budgetAccs[0]?.id||accounts[0]?.id,defaultType:"inflow"}}),
            onSetTarget:cId=>setModal({type:"target",data:{cId,current:targets[cId]}}),
            onMoveMoney:()=>setModal({type:"move"}),autoAssign}} />}
          {view==="accounts"&&<AccountsView {...{txns,accounts,selAcc,catMap,accMap,search,setSearch,
            onDel:delTxn,onToggleCleared:toggleCleared,
            onEdit:t=>setModal({type:"editTxn",data:t}),
            onAdd:()=>setModal({type:"txn",data:{accountId:selAcc||budgetAccs[0]?.id||accounts[0]?.id}}),
            onDelAcc:delAcc,onReconcile:accId=>setModal({type:"reconcile",data:{accId}}),
            getClearedBal,getUnclearedBal,getAccBal,
            onFlag:(id,f)=>updateTxn(id,{flag:f}),onAddScheduled:()=>setModal({type:"scheduled"})}} />}
          {view==="reports"&&<ReportsView {...{txns,catMap,curMonth,setCurMonth,accMap,accounts,reportTab,setReportTab}} />}
        </div>
      </div>

      {/* Modals */}
      {modal&&<Modal onClose={()=>setModal(null)}>
        {modal.type==="txn"&&<TxnForm accounts={accounts} budgetCats={budgetCats} accMap={accMap} payeeList={payeeList}
          defaultAccId={modal.data?.accountId} defaultType={modal.data?.defaultType}
          onSave={t=>{addTxn(t);setModal(null)}} onCancel={()=>setModal(null)} />}
        {modal.type==="editTxn"&&<TxnForm accounts={accounts} budgetCats={budgetCats} accMap={accMap} payeeList={payeeList}
          editTxn={modal.data} onSave={t=>{updateTxn(modal.data.id,t);setModal(null)}} onCancel={()=>setModal(null)} />}
        {modal.type==="account"&&<AccForm defaultOnBudget={modal.data?.onBudget??true} onSave={a=>{addAccount(a);setModal(null)}} onCancel={()=>setModal(null)} />}
        {modal.type==="grpForm"&&<SimpleForm title="Add Category Group" label="Group Name" placeholder="e.g. Monthly Bills" onSave={n=>{addGroup(n);setModal(null)}} onCancel={()=>setModal(null)} />}
        {modal.type==="catForm"&&<SimpleForm title="Add Category" label="Category Name" placeholder="e.g. Phone Bill" onSave={n=>{addCat(modal.data.gId,n);setModal(null)}} onCancel={()=>setModal(null)} />}
        {modal.type==="rename"&&<SimpleForm title="Rename Category" label="New Name" initial={modal.data.current} onSave={n=>{renameCat(modal.data.gId,modal.data.cId,n);setModal(null)}} onCancel={()=>setModal(null)} />}
        {modal.type==="renameGrp"&&<SimpleForm title="Rename Group" label="New Name" initial={modal.data.current} onSave={n=>{renameGroup(modal.data.gId,n);setModal(null)}} onCancel={()=>setModal(null)} />}
        {modal.type==="target"&&<TargetForm catId={modal.data.cId} current={modal.data.current} onSave={t=>{setTarget(modal.data.cId,t);setModal(null)}} onDelete={()=>{delTarget(modal.data.cId);setModal(null)}} onCancel={()=>setModal(null)} />}
        {modal.type==="move"&&<MoveForm cats={budgetCats} getAvailable={getAvailable} curMonth={curMonth} onSave={(from,to,amt)=>{moveMoney(from,to,amt);setModal(null)}} onCancel={()=>setModal(null)} />}
        {modal.type==="reconcile"&&<ReconcileForm accId={modal.data.accId} accMap={accMap} clearedBal={getClearedBal(modal.data.accId)} onReconcile={(accId,bal)=>{reconcile(accId,bal);setModal(null)}} onCancel={()=>setModal(null)} />}
        {modal.type==="scheduled"&&<ScheduledForm accounts={accounts} budgetCats={budgetCats} accMap={accMap} onSave={s=>{setScheduled(p=>[...p,{...s,id:uid()}]);setModal(null)}} onCancel={()=>setModal(null)} />}
      </Modal>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  BUDGET VIEW
// ═══════════════════════════════════════════════════════════════════
function BudgetView({groups,curMonth,getBudgeted,getActivity,getAvailable,rta,collapsed,targets,
  toggle,editing,startEditBudget,commitEdit,setEditing,editRef,onAddGroup,onAddCat,onDelCat,
  onDelGroup,onRenameCat,onRenameGroup,onAddTxn,onSetTarget,onMoveMoney,autoAssign}) {
  const rtaC = rta>0?"#22c55e":rta<0?"#ef4444":"#94a3b8";
  return (<div>
    <div style={{...S.rtaB,borderColor:rtaC}}>
      <div style={S.rtaL}><span style={S.rtaLbl}>Ready to Assign</span><span style={{...S.rtaAmt,color:rtaC}}>{fmt(rta)}</span></div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button style={S.secBtn} onClick={autoAssign}><I.Wand/> Auto-Assign</button>
        <button style={S.secBtn} onClick={onMoveMoney}><I.Move/> Move Money</button>
        <button style={S.secBtn} onClick={onAddTxn}><I.Plus/> Add Income</button>
      </div>
    </div>
    <div style={S.bTable}>
      <div style={S.bHead}><div style={S.bColC}>Category</div><div className="bcn" style={S.bColN}>Assigned</div><div className="bcn" style={S.bColN}>Activity</div><div className="bcn" style={S.bColN}>Available</div></div>
      {groups.map(g=>{
        if(g.isCCGroup&&g.categories.length===0)return null;
        const col=collapsed[g.id];
        const gB=g.categories.reduce((s,c)=>s+getBudgeted(c.id,curMonth),0);
        const gAct=g.categories.reduce((s,c)=>s+getActivity(c.id,curMonth),0);
        const gAv=g.categories.reduce((s,c)=>s+getAvailable(c.id,curMonth),0);
        return(<div key={g.id}>
          <div style={S.grpR}>
            <div style={S.grpN} onClick={()=>toggle(g.id)}>
              <span style={{display:"flex",transform:col?"rotate(-90deg)":"rotate(0)",transition:"transform .2s"}}><I.ChevD/></span>
              {g.isCCGroup&&<span style={{color:"#f97316",display:"flex"}}><I.CC/></span>}
              <span style={S.grpLbl}>{g.name}</span>
              {!g.isCCGroup&&<>
                <button style={S.tBtn} onClick={e=>{e.stopPropagation();onAddCat(g.id)}} title="Add category"><I.Plus/></button>
                <button style={S.tBtn} onClick={e=>{e.stopPropagation();onRenameGroup(g.id)}} title="Rename"><I.Edit/></button>
                <button style={S.tBtnD} onClick={e=>{e.stopPropagation();if(confirm(`Delete "${g.name}"?`))onDelGroup(g.id)}}><I.Trash/></button>
              </>}
            </div>
            <div className="bcn" style={S.bColN}><span style={S.grpNum}>{fmt(gB)}</span></div>
            <div className="bcn" style={S.bColN}><span style={S.grpNum}>{fmt(gAct)}</span></div>
            <div className="bcn" style={S.bColN}><span style={{...S.grpNum,color:gAv<0?"#ef4444":gAv>0?"#22c55e":"#94a3b8"}}>{fmt(gAv)}</span></div>
          </div>
          {!col&&g.categories.map(cat=>{
            const b=getBudgeted(cat.id,curMonth),act=getActivity(cat.id,curMonth),av=getAvailable(cat.id,curMonth);
            const isE=editing?.cId===cat.id;
            const tgt=targets[cat.id];
            const isCCp=g.isCCGroup;
            const pct=tgt?(tgt.type==="monthly"?Math.min(100,((b||0)/tgt.amount)*100):Math.min(100,(Math.max(0,av)/tgt.amount)*100)):0;
            const underfunded=tgt&&((tgt.type==="monthly"&&(b||0)<tgt.amount)||(tgt.type==="savings"&&av<tgt.amount));
            return(<div key={cat.id} className="cat-row" style={S.catR}>
              <div style={S.catN}>
                {isCCp&&<span style={{color:"#f97316",display:"flex",marginRight:2}}><I.CC/></span>}
                <span style={{flex:1}}>{cat.name}{isCCp?" Payment":""}</span>
                {tgt&&<div style={S.progWrap}><div style={{...S.progBar,width:`${pct}%`,background:underfunded?"#f97316":"#22c55e"}}/></div>}
                {!isCCp&&<>
                  <button style={S.tBtn} onClick={()=>onSetTarget(cat.id)} title="Set target"><I.Target/></button>
                  <button style={S.tBtn} onClick={()=>onRenameCat(g.id,cat.id)} title="Rename"><I.Edit/></button>
                  <button style={S.tBtnD} onClick={()=>{if(confirm(`Delete "${cat.name}"?`))onDelCat(g.id,cat.id)}}><I.Trash/></button>
                </>}
              </div>
              <div className="bcn" style={S.bColN}>
                {isE?<input ref={editRef} type="number" step="0.01" value={editing.value}
                  onChange={e=>setEditing(p=>({...p,value:e.target.value}))} onBlur={commitEdit}
                  onKeyDown={e=>{if(e.key==="Enter")commitEdit();if(e.key==="Escape")setEditing(null)}} style={S.bInput}/>
                :<span style={{...S.bCell,...(underfunded?{color:"#f97316"}:{})}} onClick={()=>startEditBudget(cat.id)}>
                  {b===0?<span style={{color:"#475569"}}>—</span>:fmt(b)}</span>}
              </div>
              <div className="bcn" style={S.bColN}><span style={{color:act<0?"#f97316":act>0?"#22c55e":"#64748b"}}>{act===0?"—":fmt(act)}</span></div>
              <div className="bcn" style={S.bColN}><span style={{...S.avPill,background:av<0?"#dc262622":av>0?"#22c55e18":"transparent",color:av<0?"#ef4444":av>0?"#22c55e":"#64748b"}}>{fmt(av)}</span></div>
            </div>);
          })}
        </div>);
      })}
      <button style={S.addGrpBtn} onClick={onAddGroup}><I.Plus/> Add Category Group</button>
    </div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════
//  ACCOUNTS VIEW
// ═══════════════════════════════════════════════════════════════════
function AccountsView({txns,accounts,selAcc,catMap,accMap,search,setSearch,onDel,onToggleCleared,onEdit,onAdd,onDelAcc,onReconcile,getClearedBal,getUnclearedBal,getAccBal,onFlag,onAddScheduled}) {
  const filtered=selAcc?txns.filter(t=>t.accountId===selAcc):txns;
  const searched=search?filtered.filter(t=>[t.payee,t.memo,catMap[t.categoryId]?.name].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase())):filtered;
  const sorted=[...searched].sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id));

  // Running balance for selected account
  const runBals=useMemo(()=>{
    if(!selAcc)return {};
    const m={};
    const all=[...txns.filter(t=>t.accountId===selAcc)].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
    let bal=0;all.forEach(t=>{bal+=(t.type==="inflow"?t.amount:-t.amount);m[t.id]=bal;});
    return m;
  },[txns,selAcc]);

  return(<div>
    {selAcc&&<div style={S.accHead}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span style={S.accType}>{accMap[selAcc]?.type}</span>
        {accMap[selAcc]?.onBudget===false&&<span style={S.trackPill}>Tracking</span>}
        <span style={{fontSize:12,color:"#64748b"}}>Cleared: {fmt(getClearedBal(selAcc))} · Uncleared: {fmt(getUnclearedBal(selAcc))} · Balance: <strong style={{color:"#e2e8f0"}}>{fmt(getAccBal(selAcc))}</strong></span>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        <button style={S.secBtn} onClick={()=>onReconcile(selAcc)}><I.Lock/> Reconcile</button>
        <button style={S.secBtn} onClick={onAddScheduled}><I.Repeat/> Scheduled</button>
        <button style={S.danBtn} onClick={()=>{if(confirm("Delete account and all its transactions?"))onDelAcc(selAcc)}}><I.Trash/></button>
      </div>
    </div>}
    <div style={{marginBottom:12,display:"flex",gap:8}}>
      <div style={S.searchBox}><I.Search/><input style={S.searchIn} placeholder="Search transactions..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <button style={S.priBtn} onClick={onAdd}><I.Plus/> Add</button>
    </div>
    {sorted.length===0?<div style={S.empty}><p style={S.emptyT}>No transactions{search?" matching search":""}</p></div>
    :<div style={S.txT}>
      <div style={S.txH}><div style={S.txD}>Date</div><div style={{width:22}}></div><div style={S.txP}>Payee</div><div className="tx-cat" style={S.txC}>Category</div>
        {!selAcc&&<div className="tx-acc" style={S.txAc}>Account</div>}<div className="tx-memo" style={S.txM}>Memo</div>
        <div style={S.txAmt}>Amount</div>{selAcc&&<div className="tx-run" style={S.txRun}>Balance</div>}<div style={{width:60}}></div></div>
      {sorted.map(tx=>{
        const catDisplay = tx.isTransfer ? "Transfer"
          : tx.isStartingBal ? <span style={{color:"#64748b",fontStyle:"italic"}}>Starting Balance</span>
          : !tx.categoryId && tx.type==="inflow" ? <span style={{color:"#4ade80"}}>Ready to Assign</span>
          : tx.splits ? <span style={{color:"#8b5cf6"}}><I.Split/> Split ({tx.splits.length})</span>
          : catMap[tx.categoryId]?.name || <span style={{color:"#475569"}}>—</span>;
        return(<div key={tx.id} style={{...S.txR,...(tx.flag&&tx.flag!=="none"?{borderLeft:`3px solid ${FLAG_COLORS[tx.flag]}`}:{})}}>
          <div style={S.txD}>{tx.date}</div>
          <div style={{width:22,display:"flex",justifyContent:"center"}}>
            <button onClick={()=>onToggleCleared(tx.id)} style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center"}} title={tx.reconciled?"Reconciled":tx.cleared?"Cleared":"Uncleared"}>
              {tx.reconciled?<span style={{color:"#22c55e"}}><I.Lock/></span>:tx.cleared?<span style={{color:"#22c55e",fontSize:13,fontWeight:700}}>C</span>:<span style={{color:"#475569",fontSize:13,fontWeight:700}}>c</span>}
            </button>
          </div>
          <div style={S.txP}>{tx.isTransfer&&<span style={{color:"#6366f1",display:"flex",flexShrink:0}}><I.Transfer/></span>}{tx.payee}</div>
          <div className="tx-cat" style={S.txC}>{catDisplay}</div>
          {!selAcc&&<div className="tx-acc" style={S.txAc}>{accMap[tx.accountId]?.name||"—"}</div>}
          <div className="tx-memo" style={S.txM}>{tx.memo||""}</div>
          <div style={{...S.txAmt,color:tx.type==="inflow"?"#22c55e":"#e2e8f0"}}>{tx.type==="inflow"?"+":"-"}{fmt(tx.amount)}</div>
          {selAcc&&<div className="tx-run" style={{...S.txRun,color:(runBals[tx.id]||0)<0?"#ef4444":"#94a3b8"}}>{fmt(runBals[tx.id]||0)}</div>}
          <div style={{width:60,display:"flex",gap:2,justifyContent:"flex-end",alignItems:"center"}}>
            <select value={tx.flag||"none"} onChange={e=>onFlag(tx.id,e.target.value)} style={S.flagSel} title="Flag">
              {Object.keys(FLAG_COLORS).map(f=><option key={f} value={f}>{f==="none"?"⚑":f==="red"?"🔴":f==="orange"?"🟠":f==="yellow"?"🟡":f==="green"?"🟢":f==="blue"?"🔵":"🟣"}</option>)}
            </select>
            <button style={S.iBtn} onClick={()=>onEdit(tx)} title="Edit"><I.Edit/></button>
            <button style={S.iBtn} onClick={()=>{if(confirm("Delete transaction?"))onDel(tx.id)}} title="Delete"><I.Trash/></button>
          </div>
        </div>);})}
    </div>}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════
//  REPORTS
// ═══════════════════════════════════════════════════════════════════
function ReportsView({txns,catMap,curMonth,setCurMonth,accMap,accounts,reportTab,setReportTab}) {
  const tabs=["spending","income_expense","net_worth"];
  const colors=["#6366f1","#8b5cf6","#ec4899","#f43f5e","#f97316","#eab308","#22c55e","#14b8a6","#06b6d4","#3b82f6"];

  const spending=useMemo(()=>{
    const m={};
    txns.filter(t=>{const a=accMap[t.accountId];return a&&a.onBudget&&monthKey(t.date)===curMonth&&t.type==="outflow"&&!t.isTransfer&&!t.isStartingBal;})
      .forEach(t=>{const c=catMap[t.categoryId]?.name||"Uncategorized";m[c]=(m[c]||0)+t.amount;});
    return Object.entries(m).sort((a,b)=>b[1]-a[1]);
  },[txns,accMap,catMap,curMonth]);
  const spTotal=spending.reduce((s,[,v])=>s+v,0);
  const spMax=spending[0]?.[1]||1;

  const months6=useMemo(()=>{const ms=[];let mk=curMonth;for(let i=0;i<6;i++){ms.unshift(mk);mk=prevMonth(mk);}return ms;},[curMonth]);

  const ive=useMemo(()=>months6.map(mk=>{
    let inc=0,exp=0;
    txns.filter(t=>{const a=accMap[t.accountId];return a&&a.onBudget&&monthKey(t.date)===mk&&!t.isTransfer&&!t.isStartingBal;})
      .forEach(t=>{if(t.type==="inflow")inc+=t.amount;else exp+=t.amount;});
    return{mk,inc,exp};
  }),[txns,accMap,months6]);
  const iveMax=Math.max(...ive.map(x=>Math.max(x.inc,x.exp)),1);

  const nwMonths=useMemo(()=>months6.map(mk=>{
    let total=0;
    accounts.forEach(a=>{
      txns.filter(t=>t.accountId===a.id&&t.date<=mk+"-31").forEach(t=>{total+=(t.type==="inflow"?t.amount:-t.amount);});
    });
    return{mk,total};
  }),[accounts,txns,months6]);

  return(<div>
    <div style={{display:"flex",gap:4,marginBottom:20,flexWrap:"wrap"}}>
      {tabs.map(t=><button key={t} style={{...S.tabBtn,...(reportTab===t?S.tabA:{})}} onClick={()=>setReportTab(t)}>
        {t==="spending"?"Spending":t==="income_expense"?"Income vs Expense":"Net Worth"}
      </button>)}
    </div>
    {reportTab==="spending"&&<div>
      <div style={S.mNav2}><button style={S.mBtn} onClick={()=>setCurMonth(prevMonth(curMonth))}><I.ChevL/></button><span style={S.mLbl}>{monthLabel(curMonth)}</span><button style={S.mBtn} onClick={()=>setCurMonth(nextMonth(curMonth))}><I.ChevR/></button></div>
      <div style={S.repTotal}><span style={S.repTL}>Total Spending</span><span style={S.repTA}>{fmt(spTotal)}</span></div>
      {spending.length===0?<div style={S.empty}><p style={S.emptyT}>No spending this month</p></div>
      :<div style={S.repBars}>{spending.map(([n,a],i)=><div key={n} style={S.repBR}>
        <div style={S.repBL}><span style={{...S.repDot,background:colors[i%colors.length]}}/><span>{n}</span></div>
        <div style={S.repBT}><div style={{...S.repBF,width:`${(a/spMax)*100}%`,background:colors[i%colors.length]}}/></div>
        <div style={S.repBA}><span>{fmt(a)}</span><span style={S.repPct}>{spTotal>0?((a/spTotal)*100).toFixed(1):0}%</span></div>
      </div>)}</div>}
    </div>}
    {reportTab==="income_expense"&&<div>
      <div style={S.repTotal}><span style={S.repTL}>Income vs Expense (6 months)</span></div>
      <div style={{display:"flex",gap:8,justifyContent:"center",alignItems:"flex-end",height:200,marginBottom:16}}>
        {ive.map(x=><div key={x.mk} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,flex:1,maxWidth:80}}>
          <div style={{display:"flex",gap:2,alignItems:"flex-end",height:160}}>
            <div style={{width:16,background:"#22c55e30",borderRadius:"4px 4px 0 0",height:`${Math.max(2,(x.inc/iveMax)*150)}px`,border:"1px solid #22c55e50"}}/>
            <div style={{width:16,background:"#ef444430",borderRadius:"4px 4px 0 0",height:`${Math.max(2,(x.exp/iveMax)*150)}px`,border:"1px solid #ef444450"}}/>
          </div>
          <span style={{fontSize:10,color:"#64748b"}}>{monthLabel(x.mk).split(" ")[0]}</span>
        </div>)}
      </div>
      <div style={{display:"flex",justifyContent:"center",gap:16,fontSize:12,color:"#94a3b8",marginBottom:12}}>
        <span><span style={{display:"inline-block",width:10,height:10,borderRadius:2,background:"#22c55e50",marginRight:4}}/>Income</span>
        <span><span style={{display:"inline-block",width:10,height:10,borderRadius:2,background:"#ef444450",marginRight:4}}/>Expense</span>
      </div>
      <div>{ive.map(x=><div key={x.mk} style={{display:"flex",gap:12,padding:"8px 0",fontSize:13,borderBottom:"1px solid #1e293b50"}}>
        <span style={{width:80,color:"#94a3b8"}}>{monthLabel(x.mk)}</span>
        <span style={{width:100,color:"#22c55e",textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(x.inc)}</span>
        <span style={{width:100,color:"#ef4444",textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(x.exp)}</span>
        <span style={{width:100,color:x.inc-x.exp>=0?"#22c55e":"#ef4444",textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:600}}>{fmt(x.inc-x.exp)}</span>
      </div>)}</div>
    </div>}
    {reportTab==="net_worth"&&<div>
      <div style={S.repTotal}><span style={S.repTL}>Net Worth Trend</span><span style={S.repTA}>{fmt(nwMonths[nwMonths.length-1]?.total||0)}</span></div>
      <div style={{display:"flex",gap:8,justifyContent:"center",alignItems:"flex-end",height:200,marginBottom:16}}>
        {(()=>{const mn=Math.min(...nwMonths.map(x=>x.total));const mx=Math.max(...nwMonths.map(x=>x.total));const range=mx-mn||1;
        return nwMonths.map(x=><div key={x.mk} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,flex:1,maxWidth:80}}>
          <div style={{width:28,background:x.total>=0?"#6366f140":"#ef444440",borderRadius:"4px 4px 0 0",height:`${Math.max(8,((x.total-mn)/range)*150)}px`,border:`1px solid ${x.total>=0?"#6366f180":"#ef444480"}`}}/>
          <span style={{fontSize:10,color:"#64748b"}}>{monthLabel(x.mk).split(" ")[0]}</span>
          <span style={{fontSize:10,color:x.total>=0?"#a5b4fc":"#ef4444",fontFamily:"'JetBrains Mono',monospace"}}>{fmt(x.total)}</span>
        </div>);})()}
      </div>
    </div>}
  </div>);
}

// ═══════════════════════════════════════════════════════════════════
//  MODAL & FORMS
// ═══════════════════════════════════════════════════════════════════
function Modal({children,onClose}){return(<div style={S.modalO} onClick={onClose}><div style={S.modalC} onClick={e=>e.stopPropagation()}><button style={S.modalX} onClick={onClose}><I.X/></button>{children}</div></div>);}

// Bug #2 fix: useSplit determined by actual splits array with real data, not just existence
function TxnForm({accounts,budgetCats,accMap,payeeList,defaultAccId,defaultType,editTxn,onSave,onCancel}){
  const hasSplits = editTxn?.splits && editTxn.splits.length > 0 && editTxn.splits.some(sp => sp.amount > 0);
  const [f,setF]=useState(editTxn
    ? { date:editTxn.date, payee:editTxn.payee||"", categoryId:editTxn.categoryId||budgetCats[0]?.id||"", accountId:editTxn.accountId, amount:editTxn.amount?.toString()||"", memo:editTxn.memo||"", type:editTxn.type||"outflow", isTransfer:!!editTxn.isTransfer, transferToAccountId:editTxn.transferToAccountId||"", cleared:!!editTxn.cleared, flag:editTxn.flag||"none", useSplit:!!hasSplits, splits:hasSplits?editTxn.splits:[{categoryId:budgetCats[0]?.id||"",amount:""}] }
    : { date:today(), payee:"", categoryId:budgetCats[0]?.id||"", accountId:defaultAccId||accounts[0]?.id||"", amount:"", memo:"", type:defaultType||"outflow", isTransfer:false, transferToAccountId:"", cleared:false, flag:"none", useSplit:false, splits:[{categoryId:budgetCats[0]?.id||"",amount:""}] });
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const isTrack = accMap[f.accountId] ? !accMap[f.accountId].onBudget : false;
  const isInflow = f.type==="inflow";
  const [payeeSug,setPayeeSug]=useState([]);

  // Bug #1 fix: build clean transaction object, not spread form state
  const doSave=()=>{
    if(!f.amount||!f.accountId)return;
    const amt = Math.abs(parseFloat(f.amount));
    if (amt === 0) return;

    const catId = (isInflow && !isTrack && !f.isTransfer) ? ""
      : (isTrack && !f.isTransfer) ? ""
      : f.isTransfer ? ""
      : f.categoryId;

    const payee = f.isTransfer
      ? `Transfer: ${accMap[f.transferToAccountId]?.name || "Account"}`
      : f.payee;

    const splits = f.useSplit && !f.isTransfer
      ? f.splits.filter(sp => sp.categoryId && (parseFloat(sp.amount)||0) > 0).map(sp => ({ categoryId: sp.categoryId, amount: parseFloat(sp.amount) }))
      : undefined;

    onSave({
      date: f.date, payee, categoryId: splits && splits.length > 0 ? splits[0].categoryId : catId,
      accountId: f.accountId, amount: amt, type: f.type, memo: f.memo,
      isTransfer: f.isTransfer, transferToAccountId: f.isTransfer ? f.transferToAccountId : "",
      cleared: f.cleared, flag: f.flag, splits,
    });
  };

  return(<div>
    <h2 style={S.modT}>{editTxn?"Edit Transaction":"Add Transaction"}</h2>
    <div style={S.fGrid}>
      <div style={{display:"flex",gap:10}}>
        <label style={{...S.fLbl,flex:1}}>Date<input type="date" value={f.date} onChange={e=>s("date",e.target.value)} style={S.fIn}/></label>
        <label style={{...S.fLbl,flex:1}}>Type<div style={S.typeT}>{["outflow","inflow"].map(t=><button key={t} type="button" style={{...S.typeB,...(f.type===t?(t==="outflow"?S.typeBOut:S.typeBIn):{})}} onClick={()=>s("type",t)}>{t==="outflow"?"Outflow":"Inflow"}</button>)}</div></label>
      </div>
      <label style={S.fLbl}>Account<select value={f.accountId} onChange={e=>s("accountId",e.target.value)} style={S.fSel}>
        <optgroup label="Budget">{accounts.filter(a=>a.onBudget).map(a=><option key={a.id} value={a.id}>{a.name}{a.type==="credit"?" (CC)":""}</option>)}</optgroup>
        {accounts.filter(a=>!a.onBudget).length>0&&<optgroup label="Tracking">{accounts.filter(a=>!a.onBudget).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>}
      </select></label>
      <label style={S.fLbl}><span style={S.chkR}><input type="checkbox" checked={f.isTransfer} onChange={e=>{s("isTransfer",e.target.checked);if(e.target.checked)s("useSplit",false);}}/> <I.Transfer/> Transfer between accounts</span></label>
      {f.isTransfer?<label style={S.fLbl}>Transfer To<select value={f.transferToAccountId} onChange={e=>s("transferToAccountId",e.target.value)} style={S.fSel}>
        <option value="">Select account...</option>{accounts.filter(a=>a.id!==f.accountId).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
      </select></label>:<>
        <label style={S.fLbl}>Payee<div style={{position:"relative"}}>
          <input type="text" value={f.payee} onChange={e=>{s("payee",e.target.value);setPayeeSug(e.target.value.length>=2?payeeList.filter(p=>p.toLowerCase().includes(e.target.value.toLowerCase())).slice(0,5):[]);}} onBlur={()=>setTimeout(()=>setPayeeSug([]),200)} placeholder={isInflow?"e.g. Employer":"e.g. Walmart"} style={S.fIn}/>
          {payeeSug.length>0&&<div style={S.sugBox}>{payeeSug.map(p=><div key={p} style={S.sugItem} onMouseDown={()=>{s("payee",p);setPayeeSug([]);}}>{p}</div>)}</div>}
        </div></label>
        {!isTrack&&!isInflow&&!f.useSplit&&<label style={S.fLbl}>Category<select value={f.categoryId} onChange={e=>s("categoryId",e.target.value)} style={S.fSel}>
          {budgetCats.map(c=><option key={c.id} value={c.id}>{c.groupName} › {c.name}</option>)}
        </select></label>}
        {!isTrack&&isInflow&&<div style={S.rtaBox}><span style={{fontSize:18,color:"#4ade80"}}>↗</span><div><div style={{fontWeight:600,color:"#4ade80"}}>Ready to Assign</div><div style={{fontSize:11,color:"#94a3b8"}}>Income goes directly to Ready to Assign</div></div></div>}
        {!isTrack&&!isInflow&&!f.isTransfer&&<label style={S.fLbl}><span style={S.chkR}><input type="checkbox" checked={f.useSplit} onChange={e=>s("useSplit",e.target.checked)}/> <I.Split/> Split across categories</span></label>}
        {f.useSplit&&<div style={{display:"flex",flexDirection:"column",gap:6,padding:"8px 0"}}>
          {f.splits.map((sp,i)=><div key={i} style={{display:"flex",gap:6,alignItems:"center"}}>
            <select value={sp.categoryId} onChange={e=>{const ns=[...f.splits];ns[i]={...ns[i],categoryId:e.target.value};s("splits",ns);}} style={{...S.fSel,flex:2}}>
              {budgetCats.map(c=><option key={c.id} value={c.id}>{c.groupName} › {c.name}</option>)}
            </select>
            <input type="number" step="0.01" value={sp.amount} onChange={e=>{const ns=[...f.splits];ns[i]={...ns[i],amount:e.target.value};s("splits",ns);}} placeholder="0.00" style={{...S.fIn,flex:1}}/>
            {f.splits.length>1&&<button type="button" style={S.iBtn} onClick={()=>s("splits",f.splits.filter((_,j)=>j!==i))}><I.Trash/></button>}
          </div>)}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <button type="button" style={{...S.secBtn,fontSize:11}} onClick={()=>s("splits",[...f.splits,{categoryId:budgetCats[0]?.id||"",amount:""}])}><I.Plus/> Add Split</button>
            <span style={{fontSize:11,color:"#64748b"}}>Total: {fmt(f.splits.reduce((s2,sp)=>s2+(parseFloat(sp.amount)||0),0))}</span>
          </div>
        </div>}
      </>}
      <div style={{display:"flex",gap:10}}>
        <label style={{...S.fLbl,flex:1}}>Amount<input type="number" step="0.01" min="0" value={f.amount} onChange={e=>s("amount",e.target.value)} placeholder="0.00" style={S.fIn}/></label>
        <label style={{...S.fLbl,flex:1}}>Flag<select value={f.flag} onChange={e=>s("flag",e.target.value)} style={S.fSel}>
          {Object.keys(FLAG_COLORS).map(fl=><option key={fl} value={fl}>{fl==="none"?"None":fl.charAt(0).toUpperCase()+fl.slice(1)}</option>)}
        </select></label>
      </div>
      <label style={S.fLbl}>Memo<input type="text" value={f.memo} onChange={e=>s("memo",e.target.value)} placeholder="Optional note" style={S.fIn}/></label>
      <label style={S.fLbl}><span style={S.chkR}><input type="checkbox" checked={f.cleared||false} onChange={e=>s("cleared",e.target.checked)}/> Cleared</span></label>
    </div>
    <div style={S.fAct}><button style={S.canBtn} onClick={onCancel}>Cancel</button><button style={S.savBtn} onClick={doSave}><I.Check/> {editTxn?"Update":"Save"}</button></div>
  </div>);
}

function AccForm({defaultOnBudget,onSave,onCancel}){
  const [n,setN]=useState("");const [t,setT]=useState(defaultOnBudget?"checking":"asset");const [ob,setOb]=useState(defaultOnBudget);const [sb,setSb]=useState("");
  const bTypes=[{v:"checking",l:"Checking"},{v:"savings",l:"Savings"},{v:"credit",l:"Credit Card"},{v:"cash",l:"Cash"}];
  const tTypes=[{v:"asset",l:"Asset"},{v:"investment",l:"Investment"},{v:"mortgage",l:"Mortgage"},{v:"loan",l:"Loan"},{v:"other",l:"Other"}];
  return(<div>
    <h2 style={S.modT}>Add Account</h2>
    <div style={S.fGrid}>
      <label style={S.fLbl}>Name<input type="text" value={n} onChange={e=>setN(e.target.value)} placeholder="e.g. Chase Checking" style={S.fIn} autoFocus/></label>
      <label style={S.fLbl}>Budget Type<div style={S.typeT}>
        <button type="button" style={{...S.typeB,...(ob?S.typeBIn:{})}} onClick={()=>{setOb(true);setT("checking")}}>On Budget</button>
        <button type="button" style={{...S.typeB,...(!ob?{background:"#6366f130",color:"#a5b4fc"}:{})}} onClick={()=>{setOb(false);setT("asset")}}>Tracking</button>
      </div></label>
      <label style={S.fLbl}>Type<select value={t} onChange={e=>setT(e.target.value)} style={S.fSel}>{(ob?bTypes:tTypes).map(x=><option key={x.v} value={x.v}>{x.l}</option>)}</select></label>
      <label style={S.fLbl}>Starting Balance<input type="number" step="0.01" value={sb} onChange={e=>setSb(e.target.value)} placeholder="0.00 (negative for CC debt)" style={S.fIn}/></label>
    </div>
    <div style={S.fAct}><button style={S.canBtn} onClick={onCancel}>Cancel</button><button style={S.savBtn} onClick={()=>{if(n.trim())onSave({id:uid(),name:n.trim(),type:t,onBudget:ob,startingBal:parseFloat(sb)||0})}}><I.Check/> Add</button></div>
  </div>);
}

function SimpleForm({title,label,placeholder,initial,onSave,onCancel}){const [v,setV]=useState(initial||"");return(<div>
  <h2 style={S.modT}>{title}</h2><label style={S.fLbl}>{label}<input type="text" value={v} onChange={e=>setV(e.target.value)} placeholder={placeholder} style={S.fIn} autoFocus onKeyDown={e=>{if(e.key==="Enter"&&v.trim()){onSave(v.trim())}}}/></label>
  <div style={S.fAct}><button style={S.canBtn} onClick={onCancel}>Cancel</button><button style={S.savBtn} onClick={()=>{if(v.trim())onSave(v.trim())}}><I.Check/> Save</button></div>
</div>);}

function TargetForm({catId,current,onSave,onDelete,onCancel}){
  const [type,setType]=useState(current?.type||"monthly");const [amt,setAmt]=useState(current?.amount?.toString()||"");const [dt,setDt]=useState(current?.targetDate||"");
  return(<div>
    <h2 style={S.modT}>Category Target</h2>
    <div style={S.fGrid}>
      <label style={S.fLbl}>Target Type<div style={S.typeT}>
        <button type="button" style={{...S.typeB,...(type==="monthly"?S.typeBIn:{})}} onClick={()=>setType("monthly")}>Monthly</button>
        <button type="button" style={{...S.typeB,...(type==="savings"?S.typeBIn:{})}} onClick={()=>setType("savings")}>Savings Goal</button>
      </div></label>
      <label style={S.fLbl}>{type==="monthly"?"Amount Needed Monthly":"Total Savings Target"}<input type="number" step="0.01" value={amt} onChange={e=>setAmt(e.target.value)} placeholder="0.00" style={S.fIn} autoFocus/></label>
      {type==="savings"&&<label style={S.fLbl}>Target Date<input type="date" value={dt} onChange={e=>setDt(e.target.value)} style={S.fIn}/></label>}
    </div>
    <div style={S.fAct}>
      {current&&<button style={S.danBtn} onClick={onDelete}><I.Trash/> Remove</button>}
      <div style={{flex:1}}/>
      <button style={S.canBtn} onClick={onCancel}>Cancel</button>
      <button style={S.savBtn} onClick={()=>{const a=parseFloat(amt);if(a>0)onSave({type,amount:a,targetDate:dt||null})}}><I.Check/> Save</button>
    </div>
  </div>);
}

function MoveForm({cats,getAvailable,curMonth,onSave,onCancel}){
  const [from,setFrom]=useState(cats[0]?.id||"");const [to,setTo]=useState(cats[1]?.id||cats[0]?.id||"");const [amt,setAmt]=useState("");
  return(<div>
    <h2 style={S.modT}>Move Money Between Categories</h2>
    <div style={S.fGrid}>
      <label style={S.fLbl}>From<select value={from} onChange={e=>setFrom(e.target.value)} style={S.fSel}>
        {cats.map(c=><option key={c.id} value={c.id}>{c.name} (avail: {fmt(getAvailable(c.id,curMonth))})</option>)}</select></label>
      <label style={S.fLbl}>To<select value={to} onChange={e=>setTo(e.target.value)} style={S.fSel}>
        {cats.map(c=><option key={c.id} value={c.id}>{c.name} (avail: {fmt(getAvailable(c.id,curMonth))})</option>)}</select></label>
      <label style={S.fLbl}>Amount<input type="number" step="0.01" value={amt} onChange={e=>setAmt(e.target.value)} placeholder="0.00" style={S.fIn} autoFocus/></label>
    </div>
    <div style={S.fAct}><button style={S.canBtn} onClick={onCancel}>Cancel</button><button style={S.savBtn} onClick={()=>{const a=parseFloat(amt);if(a>0&&from!==to)onSave(from,to,a)}}><I.Check/> Move</button></div>
  </div>);
}

function ReconcileForm({accId,accMap,clearedBal,onReconcile,onCancel}){
  const [bal,setBal]=useState(clearedBal.toFixed(2));
  const diff=parseFloat(bal||0)-clearedBal;
  return(<div>
    <h2 style={S.modT}>Reconcile: {accMap[accId]?.name}</h2>
    <p style={{fontSize:13,color:"#94a3b8",marginBottom:16}}>Enter your bank's current cleared balance to verify it matches YNAB.</p>
    <div style={S.fGrid}>
      <label style={S.fLbl}>YNAB Cleared Balance<div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,color:"#e2e8f0",padding:"4px 0"}}>{fmt(clearedBal)}</div></label>
      <label style={S.fLbl}>Bank Cleared Balance<input type="number" step="0.01" value={bal} onChange={e=>setBal(e.target.value)} style={S.fIn} autoFocus/></label>
      {Math.abs(diff)>0.005&&<div style={{padding:"10px 14px",borderRadius:8,background:"#f9731612",border:"1px solid #f9731630",color:"#fdba74",fontSize:12}}>
        Difference: <strong>{fmt(diff)}</strong> — an adjustment transaction will be created.
      </div>}
      {Math.abs(diff)<=0.005&&<div style={{padding:"10px 14px",borderRadius:8,background:"#22c55e10",border:"1px solid #22c55e25",color:"#4ade80",fontSize:12}}>
        ✓ Balances match! Cleared transactions will be locked.
      </div>}
    </div>
    <div style={S.fAct}><button style={S.canBtn} onClick={onCancel}>Cancel</button><button style={S.savBtn} onClick={()=>onReconcile(accId,parseFloat(bal)||0)}><I.Lock/> Reconcile</button></div>
  </div>);
}

function ScheduledForm({accounts,budgetCats,accMap,onSave,onCancel}){
  const [f,setF]=useState({payee:"",categoryId:budgetCats[0]?.id||"",accountId:accounts[0]?.id||"",amount:"",type:"outflow",frequency:"monthly",nextDate:today(),memo:""});
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  return(<div>
    <h2 style={S.modT}>Add Scheduled Transaction</h2>
    <div style={S.fGrid}>
      <label style={S.fLbl}>Payee<input type="text" value={f.payee} onChange={e=>s("payee",e.target.value)} placeholder="e.g. Landlord" style={S.fIn} autoFocus/></label>
      <div style={{display:"flex",gap:10}}>
        <label style={{...S.fLbl,flex:1}}>Amount<input type="number" step="0.01" value={f.amount} onChange={e=>s("amount",e.target.value)} placeholder="0.00" style={S.fIn}/></label>
        <label style={{...S.fLbl,flex:1}}>Frequency<select value={f.frequency} onChange={e=>s("frequency",e.target.value)} style={S.fSel}>
          <option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
        </select></label>
      </div>
      <label style={S.fLbl}>Type<div style={S.typeT}>
        <button type="button" style={{...S.typeB,...(f.type==="outflow"?S.typeBOut:{})}} onClick={()=>s("type","outflow")}>Outflow</button>
        <button type="button" style={{...S.typeB,...(f.type==="inflow"?S.typeBIn:{})}} onClick={()=>s("type","inflow")}>Inflow</button>
      </div></label>
      <label style={S.fLbl}>Next Date<input type="date" value={f.nextDate} onChange={e=>s("nextDate",e.target.value)} style={S.fIn}/></label>
      <label style={S.fLbl}>Account<select value={f.accountId} onChange={e=>s("accountId",e.target.value)} style={S.fSel}>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      {f.type==="outflow"&&<label style={S.fLbl}>Category<select value={f.categoryId} onChange={e=>s("categoryId",e.target.value)} style={S.fSel}>{budgetCats.map(c=><option key={c.id} value={c.id}>{c.groupName} › {c.name}</option>)}</select></label>}
    </div>
    <div style={S.fAct}><button style={S.canBtn} onClick={onCancel}>Cancel</button><button style={S.savBtn} onClick={()=>{if(f.payee&&f.amount)onSave({...f,amount:Math.abs(parseFloat(f.amount)),cleared:false,isTransfer:false,flag:"none"})}}><I.Check/> Save</button></div>
  </div>);
}

// ═══════════════════════════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════════════════════════
const CSS=`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
html,body,#root{width:100%;height:100%;margin:0;padding:0;max-width:none!important}
*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:#334155;border-radius:3px}
input:focus,select:focus{outline:none;box-shadow:0 0 0 2px #6366f140}input[type="number"]::-webkit-inner-spin-button{opacity:.3}
@keyframes spin{to{transform:rotate(360deg)}}
.cat-row:hover{background:#1e293b40}
.content>div{width:100%}
.sb{transition:transform .3s}
@media(max-width:840px){.sb{position:fixed!important;left:0;top:0;bottom:0;transform:translateX(-100%)}.sb.open{transform:translateX(0)!important}.sb-close{display:flex!important}.menu-btn{display:flex!important}.bcn{width:80px!important}}
@media(max-width:600px){.bcn{width:65px!important;font-size:11px!important}.tx-memo,.tx-acc,.tx-run{display:none!important}.topbar{padding:10px 12px!important}.content{padding:12px!important}.cat-row{padding-left:20px!important}}`;

const S={
  app:{display:"flex",width:"100%",height:"100vh",fontFamily:"'DM Sans',sans-serif",background:"#0f172a",color:"#e2e8f0",overflow:"hidden"},
  loading:{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",width:"100%",background:"#0f172a"},
  spinner:{width:28,height:28,border:"3px solid #1e293b",borderTopColor:"#6366f1",borderRadius:"50%",animation:"spin .8s linear infinite"},
  sb:{width:260,minWidth:260,background:"#1e293b",display:"flex",flexDirection:"column",borderRight:"1px solid #334155",zIndex:100,overflowY:"auto"},
  sbHead:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 14px 6px"},
  sbClose:{display:"none",background:"none",border:"none",color:"#94a3b8",cursor:"pointer"},
  logo:{display:"flex",alignItems:"center",gap:8},logoI:{width:28,height:28,borderRadius:7,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:14,color:"#fff"},
  logoT:{fontWeight:700,fontSize:16,color:"#f1f5f9",letterSpacing:"-.02em"},
  aom:{display:"flex",alignItems:"center",gap:6,padding:"6px 14px",fontSize:11,color:"#94a3b8",background:"#0f172a40",margin:"4px 8px",borderRadius:6},
  nav:{padding:"6px 6px 0",display:"flex",flexDirection:"column",gap:1},
  navI:{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:7,background:"none",border:"none",color:"#94a3b8",cursor:"pointer",fontSize:13,fontFamily:"inherit",textAlign:"left"},
  navA:{background:"#6366f118",color:"#a5b4fc"},
  sbSec:{padding:"10px 6px 2px"},sbSecH:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 10px 6px"},
  sbSecT:{fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:".08em",color:"#64748b"},
  addB:{background:"none",border:"none",color:"#64748b",cursor:"pointer",padding:2,borderRadius:4,display:"flex"},
  accI:{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:7,background:"none",border:"none",color:"#cbd5e1",cursor:"pointer",fontSize:12,fontFamily:"inherit",width:"100%",textAlign:"left"},
  accA:{background:"#6366f118",color:"#a5b4fc"},
  dot:(t)=>({width:7,height:7,borderRadius:"50%",background:t==="checking"?"#3b82f6":t==="savings"?"#22c55e":t==="credit"?"#f97316":t==="cash"?"#eab308":t==="investment"?"#8b5cf6":t==="asset"?"#14b8a6":"#64748b",flexShrink:0}),
  accN:{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:4},
  accBal:{fontSize:11,fontFamily:"'JetBrains Mono',monospace",flexShrink:0},
  ccB:{fontSize:8,fontWeight:700,background:"#f9731625",color:"#f97316",padding:"0 4px",borderRadius:3,marginLeft:2},
  totR:{display:"flex",justifyContent:"space-between",padding:"6px 10px",borderTop:"1px solid #334155",marginTop:2,fontSize:11,fontWeight:600,fontFamily:"'JetBrains Mono',monospace",color:"#94a3b8"},
  sbBottom:{marginTop:"auto",padding:"10px 10px 12px",display:"flex",flexDirection:"column",gap:4},
  sbBtn:{display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:7,background:"none",border:"1px solid #334155",color:"#94a3b8",cursor:"pointer",fontSize:11,fontFamily:"inherit",width:"100%"},
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,.4)",zIndex:99},
  main:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",minWidth:0},
  topBar:{display:"flex",alignItems:"center",gap:12,padding:"12px 20px",borderBottom:"1px solid #1e293b",flexWrap:"wrap",minHeight:56},
  menuB:{display:"none",background:"none",border:"none",color:"#94a3b8",cursor:"pointer",padding:2},
  pageT:{fontSize:18,fontWeight:700,letterSpacing:"-.02em",color:"#f1f5f9",display:"flex",alignItems:"center",gap:8},
  trackBadge:{fontSize:10,fontWeight:600,background:"#6366f120",color:"#818cf8",padding:"2px 8px",borderRadius:16},
  content:{flex:1,overflow:"auto",padding:"16px 20px 32px",width:"100%"},
  mNav:{display:"flex",alignItems:"center",gap:6,marginLeft:"auto"},
  mNav2:{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:20},
  mBtn:{background:"#1e293b",border:"1px solid #334155",borderRadius:6,color:"#94a3b8",cursor:"pointer",padding:"4px 6px",display:"flex"},
  mLbl:{fontSize:14,fontWeight:600,color:"#e2e8f0",minWidth:120,textAlign:"center"},
  priBtn:{display:"flex",alignItems:"center",gap:5,padding:"6px 14px",borderRadius:7,background:"linear-gradient(135deg,#6366f1,#7c3aed)",border:"none",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",whiteSpace:"nowrap"},
  secBtn:{display:"flex",alignItems:"center",gap:5,padding:"6px 12px",borderRadius:7,background:"#1e293b",border:"1px solid #334155",color:"#a5b4fc",cursor:"pointer",fontSize:12,fontWeight:500,fontFamily:"inherit"},
  danBtn:{display:"flex",alignItems:"center",gap:4,padding:"6px 10px",borderRadius:6,background:"#dc262615",border:"1px solid #dc262630",color:"#ef4444",cursor:"pointer",fontSize:11,fontFamily:"inherit"},
  iBtn:{background:"none",border:"none",color:"#475569",cursor:"pointer",padding:2,borderRadius:3,display:"flex"},
  rtaB:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 18px",borderRadius:10,background:"#1e293b",border:"1px solid",marginBottom:14,flexWrap:"wrap",gap:10},
  rtaL:{display:"flex",flexDirection:"column",gap:2},rtaLbl:{fontSize:11,fontWeight:500,color:"#94a3b8",textTransform:"uppercase",letterSpacing:".05em"},
  rtaAmt:{fontSize:26,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",letterSpacing:"-.02em"},
  bTable:{borderRadius:10,overflow:"hidden",width:"100%"},
  bHead:{display:"flex",alignItems:"center",padding:"8px 14px",background:"#1e293b",borderBottom:"1px solid #334155",fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:".06em",color:"#64748b"},
  bColC:{flex:1,minWidth:120},bColN:{width:110,textAlign:"right",flexShrink:0},
  grpR:{display:"flex",alignItems:"center",padding:"8px 14px",background:"#1e293b90",borderBottom:"1px solid #1e293b"},
  grpN:{flex:1,display:"flex",alignItems:"center",gap:5,cursor:"pointer",minWidth:120},
  grpLbl:{fontWeight:600,fontSize:12,color:"#cbd5e1"},grpNum:{fontSize:12,fontFamily:"'JetBrains Mono',monospace",color:"#94a3b8"},
  tBtn:{background:"none",border:"none",color:"#47556960",cursor:"pointer",padding:1,borderRadius:3,display:"flex"},
  tBtnD:{background:"none",border:"none",color:"#47556940",cursor:"pointer",padding:1,borderRadius:3,display:"flex"},
  catR:{display:"flex",alignItems:"center",padding:"7px 14px 7px 36px",borderBottom:"1px solid #1e293b20",transition:"background .15s"},
  catN:{flex:1,display:"flex",alignItems:"center",gap:4,fontSize:13,color:"#cbd5e1",minWidth:120},
  progWrap:{width:40,height:4,background:"#334155",borderRadius:2,overflow:"hidden",flexShrink:0},
  progBar:{height:"100%",borderRadius:2,transition:"width .3s"},
  bCell:{cursor:"pointer",padding:"3px 8px",borderRadius:5,fontSize:12,fontFamily:"'JetBrains Mono',monospace",display:"inline-block"},
  bInput:{width:90,padding:"3px 6px",borderRadius:5,border:"1px solid #6366f1",background:"#0f172a",color:"#e2e8f0",fontSize:12,fontFamily:"'JetBrains Mono',monospace",textAlign:"right"},
  avPill:{padding:"2px 8px",borderRadius:16,fontSize:12,fontFamily:"'JetBrains Mono',monospace",fontWeight:500,display:"inline-block"},
  addGrpBtn:{display:"flex",alignItems:"center",gap:5,padding:"10px 14px",background:"none",border:"1px dashed #334155",borderRadius:8,color:"#64748b",cursor:"pointer",fontSize:12,fontFamily:"inherit",width:"100%",marginTop:10,justifyContent:"center"},
  accHead:{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,flexWrap:"wrap",gap:6},
  accType:{fontSize:12,color:"#64748b",textTransform:"capitalize",background:"#1e293b",padding:"3px 10px",borderRadius:16},
  trackPill:{fontSize:10,color:"#818cf8",background:"#6366f115",padding:"3px 10px",borderRadius:16},
  searchBox:{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",background:"#1e293b",borderRadius:7,border:"1px solid #334155",flex:1,maxWidth:300},
  searchIn:{background:"none",border:"none",color:"#e2e8f0",fontSize:13,fontFamily:"inherit",flex:1,outline:"none"},
  txT:{borderRadius:10,overflow:"hidden",fontSize:12},
  txH:{display:"flex",alignItems:"center",padding:"8px 10px",background:"#1e293b",borderBottom:"1px solid #334155",fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:".06em",color:"#64748b",gap:6},
  txR:{display:"flex",alignItems:"center",padding:"8px 10px",borderBottom:"1px solid #1e293b20",gap:6},
  txD:{width:80,flexShrink:0,color:"#94a3b8",fontSize:11,fontFamily:"'JetBrains Mono',monospace"},
  txP:{flex:2,display:"flex",alignItems:"center",gap:4,minWidth:80},
  txC:{flex:1.5,color:"#94a3b8",minWidth:60},txAc:{flex:1,color:"#94a3b8",minWidth:50},
  txM:{flex:1.5,color:"#64748b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:50},
  txAmt:{width:90,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:500,flexShrink:0},
  txRun:{width:80,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:11,flexShrink:0},
  flagSel:{background:"none",border:"none",cursor:"pointer",fontSize:11,padding:0,width:18},
  empty:{textAlign:"center",padding:"50px 16px"},emptyT:{fontSize:16,fontWeight:600,color:"#cbd5e1",marginBottom:16},
  tabBtn:{padding:"6px 14px",borderRadius:7,background:"#1e293b",border:"1px solid #334155",color:"#94a3b8",cursor:"pointer",fontSize:12,fontFamily:"inherit"},
  tabA:{background:"#6366f120",borderColor:"#6366f150",color:"#a5b4fc"},
  repTotal:{textAlign:"center",marginBottom:24},repTL:{fontSize:12,color:"#64748b",display:"block",marginBottom:4},
  repTA:{fontSize:32,fontWeight:700,fontFamily:"'JetBrains Mono',monospace",color:"#f1f5f9"},
  repBars:{display:"flex",flexDirection:"column",gap:12,maxWidth:600,margin:"0 auto"},
  repBR:{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"},
  repBL:{width:120,display:"flex",alignItems:"center",gap:6,fontSize:13,flexShrink:0},
  repDot:{width:8,height:8,borderRadius:"50%",flexShrink:0},
  repBT:{flex:1,height:20,background:"#1e293b",borderRadius:5,overflow:"hidden",minWidth:80},
  repBF:{height:"100%",borderRadius:5,transition:"width .5s ease"},
  repBA:{width:100,textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontSize:12,display:"flex",flexDirection:"column",flexShrink:0},
  repPct:{fontSize:10,color:"#64748b"},
  modalO:{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16},
  modalC:{background:"#1e293b",borderRadius:14,padding:24,width:"100%",maxWidth:460,maxHeight:"90vh",overflow:"auto",position:"relative",border:"1px solid #334155",boxShadow:"0 25px 50px -12px rgba(0,0,0,.5)"},
  modalX:{position:"absolute",top:10,right:10,background:"none",border:"none",color:"#64748b",cursor:"pointer",padding:2},
  modT:{fontSize:18,fontWeight:700,color:"#f1f5f9",marginBottom:16,letterSpacing:"-.02em"},
  fGrid:{display:"flex",flexDirection:"column",gap:12},
  fLbl:{display:"flex",flexDirection:"column",gap:4,fontSize:12,fontWeight:500,color:"#94a3b8"},
  fIn:{padding:"8px 10px",borderRadius:7,border:"1px solid #334155",background:"#0f172a",color:"#e2e8f0",fontSize:13,fontFamily:"inherit"},
  fSel:{padding:"8px 10px",borderRadius:7,border:"1px solid #334155",background:"#0f172a",color:"#e2e8f0",fontSize:13,fontFamily:"inherit"},
  chkR:{display:"flex",alignItems:"center",gap:6,cursor:"pointer"},
  rtaBox:{display:"flex",gap:10,padding:"10px 14px",borderRadius:8,background:"#22c55e10",border:"1px solid #22c55e25",alignItems:"center"},
  sugBox:{position:"absolute",top:"100%",left:0,right:0,background:"#1e293b",border:"1px solid #334155",borderRadius:7,zIndex:10,maxHeight:150,overflow:"auto"},
  sugItem:{padding:"6px 10px",fontSize:13,cursor:"pointer",color:"#cbd5e1",borderBottom:"1px solid #334155"},
  typeT:{display:"flex",borderRadius:7,overflow:"hidden",border:"1px solid #334155"},
  typeB:{flex:1,padding:"7px 10px",background:"#0f172a",border:"none",color:"#64748b",cursor:"pointer",fontSize:12,fontWeight:500,fontFamily:"inherit"},
  typeBOut:{background:"#dc262630",color:"#f87171"},typeBIn:{background:"#22c55e20",color:"#4ade80"},
  fAct:{display:"flex",gap:8,alignItems:"center",marginTop:16},
  canBtn:{padding:"8px 14px",borderRadius:7,background:"none",border:"1px solid #334155",color:"#94a3b8",cursor:"pointer",fontSize:13,fontFamily:"inherit"},
  savBtn:{display:"flex",alignItems:"center",gap:5,padding:"8px 16px",borderRadius:7,background:"linear-gradient(135deg,#6366f1,#7c3aed)",border:"none",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"},
};