import { useState, useEffect, useRef } from "react";
import { ref, onValue, set, remove } from "firebase/database";
import { db } from "./firebase";

// ═══════════════════════════════════════════════════
//  Семейный бюджет · Митя & Марина
//  · чат-ввод («500 кроссовки» → −500 zł Хотелки)
//  · конверты: деньги лежат в «Общем счёте», оттуда
//    переводятся на «Еду», «Хотелки», «Счёт Марины»
//  · профили с фото · донат · календарь · долг в €
//  · общие данные на всех устройствах через Firebase
// ═══════════════════════════════════════════════════

const PALETTE = ["#8b5cf6","#f59e0b","#3b82f6","#ec4899","#f97316","#ef4444","#a855f7","#10b981","#06b6d4","#84cc16","#64748b","#14b8a6"];

const MAIN = "main"; // общий счёт, откуда раздаются деньги по конвертам

const DEFAULT_ENVELOPES = [
  { id: MAIN, emoji: "💼", label: "Общий счёт", color: "#6366f1", main: true },
  { id: "e_food", emoji: "🍔", label: "Еда", color: "#f59e0b" },
  { id: "e_wants", emoji: "🛍️", label: "Хотелки", color: "#ec4899" },
];

const DEFAULT_DATA = {
  people: [
    { id: "p1", name: "Митя", avatar: null, color: "#38bdf8" },
    { id: "p2", name: "Марина", avatar: null, color: "#ec4899" },
  ],
  categories: {
    income: [
      { id: "salary_h", emoji: "💼", label: "Зарплата Мити", color: "#10b981" },
      { id: "salary_w", emoji: "💅", label: "Зарплата Марины", color: "#14b8a6" },
      { id: "freelance", emoji: "🚀", label: "Фриланс", color: "#06b6d4" },
      { id: "other_in", emoji: "🎁", label: "Другое", color: "#84cc16" },
    ],
    expense: [
      { id: "rent", emoji: "🏠", label: "Квартира", color: "#8b5cf6" },
      { id: "food", emoji: "🍔", label: "Еда", color: "#f59e0b" },
      { id: "subs", emoji: "📱", label: "Подписки", color: "#3b82f6" },
      { id: "wants", emoji: "🛍️", label: "Хотелки", color: "#ec4899" },
      { id: "transport", emoji: "🚌", label: "Транспорт", color: "#f97316" },
      { id: "health", emoji: "💊", label: "Здоровье", color: "#ef4444" },
      { id: "fun", emoji: "🎉", label: "Развлечения", color: "#a855f7" },
      { id: "other_out", emoji: "📦", label: "Другое", color: "#64748b" },
    ],
  },
  envelopes: DEFAULT_ENVELOPES,
  transactions: {},
  transfers: {},
  debtTotal: 3000,
  debtPayments: {},
};

const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const MONTHS_GEN = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
const WEEKDAYS = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

const fmt = (n) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n));
const newId = () => Date.now() + "_" + Math.random().toString(36).slice(2, 6);

// ── ключевые слова для распознавания категории ──
const KEYWORDS = {
  food: ["еда","продукт","бедронк","biedronka","lidl","лидл","жабка","żabka","zabka","магазин","кафе","ресторан","пицц","суши","кофе","обед","ужин","завтрак"],
  rent: ["квартир","аренда","чинш","czynsz","жиль"],
  subs: ["подписк","spotify","спотифай","youtube","ютуб","claude","клод","chatgpt","чатжпт","canva","канва","google","гугл","play","нетфликс","netflix"],
  wants: ["кроссовк","одежд","дух","шмот","обувь","косметик","парфюм","кофт","джинс","платье","сумк","украшен"],
  transport: ["такси","uber","убер","bolt","болт","автобус","метро","бензин","проезд","билет"],
  health: ["аптек","врач","лекарств","стоматолог","витамин","клиник"],
  fun: ["кино","бар","клуб","игр","концерт","боулинг","развлеч"],
};

// разбор строки: «500 кроссовки» / «зарплата 6400» / «бедронка 120,50» / «отдал 200 долга»
function localParse(text, cats) {
  const t = text.toLowerCase();
  const m = t.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const amount = parseFloat(m[1].replace(",", "."));
  if (!(amount > 0)) return null;

  if (/долг|кредит|займ/.test(t)) return { action: "debt", amount };

  const isIncome = /зарплат|фриланс|заказ|получил|пришл|доход|аванс|преми|\+/.test(t);
  let catId = isIncome ? "other_in" : "other_out";
  if (isIncome) {
    if (/фриланс|заказ/.test(t)) catId = "freelance";
    else if (/зарплат|аванс|преми/.test(t)) catId = /марин|жен/.test(t) ? "salary_w" : "salary_h";
  } else {
    for (const [id, words] of Object.entries(KEYWORDS)) {
      if (words.some((w) => t.includes(w))) { catId = id; break; }
    }
    if (catId === "other_out") {
      const custom = cats.expense.find((c) => {
        const w = (c.label || "").toLowerCase().split(" ")[0];
        return w.length > 3 && t.includes(w.slice(0, w.length - 1));
      });
      if (custom) catId = custom.id;
    }
  }
  const pool = isIncome ? cats.income : cats.expense;
  if (!pool.find((c) => c.id === catId)) catId = pool[pool.length - 1]?.id;
  const note = text.replace(m[0], "").replace(/зл|zł|злот\w*|pln/gi, "").trim();
  return { action: "add", type: isIncome ? "income" : "expense", amount, category: catId, note };
}

// ── аватарка ──
function Avatar({ person, size = 40 }) {
  return person.avatar ? (
    <img src={person.avatar} alt={person.name} style={{ width: size, height: size, borderColor: person.color }} className="rounded-full object-cover border-2 shrink-0" />
  ) : (
    <div style={{ width: size, height: size, background: person.color }} className="rounded-full flex items-center justify-center text-white font-black shrink-0">
      <span style={{ fontSize: size * 0.42 }}>{person.name[0]}</span>
    </div>
  );
}

// ── донат-диаграмма ──
function Donut({ items, total, centerLabel }) {
  const R = 70, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <svg width="170" height="170" viewBox="0 0 170 170" className="shrink-0 mx-auto block">
      <circle cx="85" cy="85" r={R} fill="none" stroke="#f1f5f9" strokeWidth="22" />
      {items.map((it) => {
        const frac = total > 0 ? it.sum / total : 0;
        const dash = frac * C;
        const el = (
          <circle key={it.id} cx="85" cy="85" r={R} fill="none" stroke={it.color} strokeWidth="22"
            strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc * C + C / 4}
            strokeLinecap={items.length > 1 ? "butt" : "round"} style={{ transition: "stroke-dasharray .6s" }} />
        );
        acc += frac;
        return el;
      })}
      <text x="85" y="80" textAnchor="middle" style={{ fontSize: 22, fill: "#1e293b", fontFamily: "'Nunito',sans-serif", fontWeight: 900 }}>{fmt(total)}</text>
      <text x="85" y="100" textAnchor="middle" style={{ fontSize: 12, fill: "#94a3b8", fontFamily: "'Nunito',sans-serif", fontWeight: 700 }}>{centerLabel}</text>
    </svg>
  );
}

// в базе списки лежат объектами {id: {...}} — разворачиваем в массив, свежие сверху
const toList = (obj) => Object.values(obj || {}).sort((a, b) => (a.date < b.date ? 1 : -1));

export default function FamilyBudget() {
  const [data, setData] = useState({ ...DEFAULT_DATA, transactions: [], debtPayments: [], transfers: [] });
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState("overview");
  const now = new Date();
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [activePerson, setActivePerson] = useState(() => localStorage.getItem("activePerson") || "p1");
  const [flash, setFlash] = useState("");

  // чат
  const [chatLog, setChatLog] = useState([
    { role: "bot", text: "Привет! 👋 Пишите траты как в мессенджере:\n«500 кроссовки» · «бедронка 120» · «зарплата 6400»\n\nИли спросите: «сколько ушло на еду?»" },
  ]);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef(null);

  const [selectedDay, setSelectedDay] = useState(null);

  // окна
  const [sheet, setSheet] = useState(null);       // ввод траты/дохода
  const [transfer, setTransfer] = useState(null); // перевод между конвертами
  const [newEnv, setNewEnv] = useState(null);     // новый конверт
  const [fabOpen, setFabOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const [newCat, setNewCat] = useState({ type: "expense", emoji: "✨", label: "", color: PALETTE[0] });
  const [dAmount, setDAmount] = useState("");
  const [editNames, setEditNames] = useState(null);
  const [editDebtTotal, setEditDebtTotal] = useState(false);

  // ── подписка на базу в реальном времени ──
  useEffect(() => {
    const budgetRef = ref(db, "budget");
    const unsub = onValue(
      budgetRef,
      (snap) => {
        const v = snap.val();
        if (!v) {
          set(budgetRef, DEFAULT_DATA).catch(() => setSaveError(true));
          setLoading(false);
          return;
        }
        // у старой базы конвертов ещё нет — создаём их один раз
        if (!v.envelopes) set(ref(db, "budget/envelopes"), DEFAULT_ENVELOPES).catch(() => {});
        setData({
          people: v.people || DEFAULT_DATA.people,
          categories: {
            income: v.categories?.income || DEFAULT_DATA.categories.income,
            expense: v.categories?.expense || DEFAULT_DATA.categories.expense,
          },
          envelopes: v.envelopes || DEFAULT_ENVELOPES,
          transactions: toList(v.transactions),
          transfers: toList(v.transfers),
          debtTotal: v.debtTotal ?? 3000,
          debtPayments: toList(v.debtPayments),
        });
        setSaveError(false);
        setLoading(false);
      },
      () => { setSaveError(true); setLoading(false); }
    );
    const unsubConn = onValue(ref(db, ".info/connected"), (s) => setOffline(!s.val()));
    return () => { unsub(); unsubConn(); };
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatLog, tab]);
  useEffect(() => { localStorage.setItem("activePerson", activePerson); }, [activePerson]);

  // круглая ➕ появляется, как только уехали от кнопок вверху
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 150);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const showFlash = (msg) => { setFlash(msg); setTimeout(() => setFlash(""), 2200); };
  const guard = (p) => p.catch(() => setSaveError(true));

  const catById = (id) => [...data.categories.income, ...data.categories.expense].find((c) => c.id === id) || { emoji: "❓", label: "Прочее", color: "#94a3b8", id };
  const personById = (id) => data.people.find((p) => p.id === id) || data.people[0];
  const envById = (id) => data.envelopes.find((e) => e.id === id) || data.envelopes.find((e) => e.main) || data.envelopes[0];
  const mainEnv = data.envelopes.find((e) => e.main) || data.envelopes[0];
  // у записей, сделанных до появления конвертов, конверта нет — считаем их «Общим счётом»
  const envOf = (t) => t.envelope || MAIN;

  // ── запись данных ──
  const addTx = (type, personId, category, amount, note, dateIso, envelope) => {
    const id = newId();
    const tx = { id, type, personId, category, amount, note: note || "", envelope: envelope || MAIN, date: dateIso || new Date().toISOString() };
    guard(set(ref(db, `budget/transactions/${id}`), tx));
    localStorage.setItem("env_" + category, tx.envelope); // запомним конверт для этой категории
    return tx;
  };
  const deleteTx = (id) => guard(remove(ref(db, `budget/transactions/${id}`)));
  const addTransfer = (from, to, amount) => {
    const id = newId();
    guard(set(ref(db, `budget/transfers/${id}`), { id, from, to, amount, personId: activePerson, date: new Date().toISOString() }));
  };
  const deleteTransfer = (id) => guard(remove(ref(db, `budget/transfers/${id}`)));
  const saveEnvelopes = (arr) => guard(set(ref(db, "budget/envelopes"), arr));
  const addDebt = (amount, personId) => {
    const id = newId();
    guard(set(ref(db, `budget/debtPayments/${id}`), { id, amount, personId, date: new Date().toISOString() }));
  };
  const deleteDebt = (id) => guard(remove(ref(db, `budget/debtPayments/${id}`)));
  const savePeople = (people) => guard(set(ref(db, "budget/people"), people));
  const saveCats = (type, arr) => guard(set(ref(db, `budget/categories/${type}`), arr));

  // ── расчёты за месяц ──
  const inMonth = (iso, mm = month) => { const d = new Date(iso); return d.getFullYear() === mm.y && d.getMonth() === mm.m; };
  const monthTx = data.transactions.filter((t) => inMonth(t.date));
  const income = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;

  const prev = month.m === 0 ? { y: month.y - 1, m: 11 } : { y: month.y, m: month.m - 1 };
  const prevExpense = data.transactions
    .filter((t) => t.type === "expense" && inMonth(t.date, prev))
    .reduce((s, t) => s + t.amount, 0);

  const byCat = (type) => {
    const map = {};
    monthTx.filter((t) => t.type === type).forEach((t) => { map[t.category] = (map[t.category] || 0) + t.amount; });
    return Object.entries(map).map(([id, sum]) => ({ ...catById(id), sum })).sort((a, b) => b.sum - a.sum);
  };
  const byPerson = (pid) => ({
    spent: monthTx.filter((t) => t.type === "expense" && t.personId === pid).reduce((s, t) => s + t.amount, 0),
    earned: monthTx.filter((t) => t.type === "income" && t.personId === pid).reduce((s, t) => s + t.amount, 0),
  });

  // ── конверты ──
  // Остаток в конверте — за всё время: что зачислили и перевели сюда, минус что потратили и увели.
  const envBalance = (eid) => {
    const inc = data.transactions.filter((t) => t.type === "income" && envOf(t) === eid).reduce((s, t) => s + t.amount, 0);
    const out = data.transactions.filter((t) => t.type === "expense" && envOf(t) === eid).reduce((s, t) => s + t.amount, 0);
    const tin = data.transfers.filter((t) => t.to === eid).reduce((s, t) => s + t.amount, 0);
    const tout = data.transfers.filter((t) => t.from === eid).reduce((s, t) => s + t.amount, 0);
    return inc + tin - out - tout;
  };
  // Выделено в этом месяце — сколько перевели на конверт; потрачено — сколько с него ушло.
  const envAllocated = (eid) => data.transfers.filter((t) => t.to === eid && inMonth(t.date)).reduce((s, t) => s + t.amount, 0);
  const envSpent = (eid) => monthTx.filter((t) => t.type === "expense" && envOf(t) === eid).reduce((s, t) => s + t.amount, 0);

  const debtPaid = data.debtPayments.reduce((s, p) => s + p.amount, 0);
  const debtLeft = Math.max(0, data.debtTotal - debtPaid);
  const debtPct = Math.min(100, data.debtTotal > 0 ? (debtPaid / data.debtTotal) * 100 : 100);

  const prevMonth = () => { setSelectedDay(null); setMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 })); };
  const nextMonth = () => { setSelectedDay(null); setMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 })); };

  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate();
  const isCurrentMonth = month.y === now.getFullYear() && month.m === now.getMonth();
  const monthProgress = isCurrentMonth ? now.getDate() / daysInMonth : 1; // сколько месяца прошло

  // ── подсказки ──
  const buildTips = () => {
    const tips = [];
    data.envelopes.filter((e) => !e.main).forEach((e) => {
      const bal = envBalance(e.id);
      const alloc = envAllocated(e.id);
      const spent = envSpent(e.id);
      if (bal < 0) {
        tips.push({ tone: "bad", text: `${e.emoji} ${e.label}: перерасход ${fmt(-bal)} zł — конверт ушёл в минус, переведите туда денег` });
      } else if (alloc > 0 && spent / alloc >= 0.8) {
        tips.push({ tone: "warn", text: `${e.emoji} ${e.label}: потрачено ${Math.round((spent / alloc) * 100)}% выделенного (${fmt(spent)} из ${fmt(alloc)} zł). Осталось ${fmt(bal)} zł — лучше притормозить` });
      } else if (alloc > 0 && monthProgress > 0.6 && spent / alloc < 0.5) {
        tips.push({ tone: "good", text: `${e.emoji} ${e.label}: месяц на исходе, а потрачено всего ${Math.round((spent / alloc) * 100)}% — идёте с запасом ${fmt(bal)} zł 👍` });
      }
    });

    const cats = byCat("expense");
    const top = cats[0];
    if (top && expense > 0 && top.sum / expense >= 0.25) {
      tips.push({ tone: "warn", text: `${top.emoji} ${top.label} съедает ${Math.round((top.sum / expense) * 100)}% всех трат за месяц — ${fmt(top.sum)} zł` });
    }

    if (prevExpense > 0 && monthProgress > 0.5 && expense > prevExpense * 1.15) {
      tips.push({ tone: "warn", text: `📈 Тратите на ${Math.round((expense / prevExpense - 1) * 100)}% больше, чем в ${MONTHS_GEN[prev.m]} (${fmt(expense)} против ${fmt(prevExpense)} zł)` });
    }

    if (balance < 0) {
      tips.push({ tone: "bad", text: `⚠️ Расходы превысили доходы на ${fmt(-balance)} zł — живёте из накоплений` });
    } else if (income > 0 && balance > 0 && monthProgress > 0.8) {
      tips.push({ tone: "good", text: `🎉 За ${MONTHS_GEN[month.m]} остаётся ${fmt(balance)} zł — можно закинуть в долг или отложить` });
    }

    return tips.slice(0, 4);
  };

  // ── ответы на вопросы ──
  const answerQuestion = (t) => {
    if (/долг/.test(t)) return `💶 По долгу: осталось ${fmt(debtLeft)} € из ${fmt(data.debtTotal)} € · выплачено ${Math.round(debtPct)}%`;
    if (/конверт|счёт|счет|бюджет/.test(t)) {
      return "💼 Конверты:\n" + data.envelopes.map((e) => `${e.emoji} ${e.label}: ${fmt(envBalance(e.id))} zł`).join("\n");
    }
    const cat = data.categories.expense.find((c) => {
      const w = (c.label || "").toLowerCase().split(" ")[0];
      return w.length > 3 && t.includes(w.slice(0, w.length - 1));
    });
    if (cat) {
      const sum = monthTx.filter((x) => x.type === "expense" && x.category === cat.id).reduce((s, x) => s + x.amount, 0);
      const share = expense > 0 ? Math.round((sum / expense) * 100) : 0;
      return `${cat.emoji} ${cat.label} за ${MONTHS[month.m].toLowerCase()}: ${fmt(sum)} zł · это ${share}% всех трат`;
    }
    if (/остал|баланс|хватит/.test(t)) {
      return balance >= 0
        ? `💰 Остаток за ${MONTHS[month.m].toLowerCase()}: ${fmt(balance)} zł (пришло ${fmt(income)} zł, ушло ${fmt(expense)} zł)`
        : `⚠️ Минус ${fmt(Math.abs(balance))} zł за ${MONTHS[month.m].toLowerCase()}: потратили ${fmt(expense)} zł, а пришло ${fmt(income)} zł`;
    }
    if (/кто|митя|марин/.test(t)) {
      return "👫 " + data.people.map((p) => { const s = byPerson(p.id); return `${p.name}: потратил(а) ${fmt(s.spent)} zł, внёс(ла) ${fmt(s.earned)} zł`; }).join("\n");
    }
    const top = byCat("expense").slice(0, 3).map((c) => `${c.emoji} ${c.label} — ${fmt(c.sum)} zł`).join("\n");
    return `📊 ${MONTHS[month.m]} ${month.y}\n📥 +${fmt(income)} zł · 📤 −${fmt(expense)} zł · остаток ${fmt(balance)} zł${top ? "\n\nБольше всего ушло:\n" + top : ""}`;
  };

  const applyParsed = (parsed) => {
    if (parsed.action === "add") {
      // конверт подставляем тот, с которого обычно платят за эту категорию
      const env = localStorage.getItem("env_" + parsed.category) || MAIN;
      const tx = addTx(parsed.type, activePerson, parsed.category, parsed.amount, parsed.note, null, parsed.type === "income" ? MAIN : env);
      const c = catById(parsed.category);
      const e = envById(tx.envelope);
      const sign = parsed.type === "income" ? "+" : "−";
      return { role: "bot", text: `✅ Записал: ${c.emoji} ${c.label} ${sign}${fmt(parsed.amount)} zł · ${e.emoji} ${e.label} · ${personById(activePerson).name}`, undoId: tx.id };
    }
    if (parsed.action === "debt") {
      addDebt(parsed.amount, activePerson);
      return { role: "bot", text: `💪 Платёж по долгу −${fmt(parsed.amount)} € записан! Осталось ${fmt(Math.max(0, debtLeft - parsed.amount))} €` };
    }
    return { role: "bot", text: "🤔 Не понял. Напишите, например: «500 кроссовки» или «сколько ушло на еду?»" };
  };

  const sendChat = () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    setChatLog((l) => [...l, { role: "user", text }]);
    const t = text.toLowerCase();
    const isQuestion = /\?|^скольк|^что |^куда|^как /.test(t);
    const parsed = isQuestion ? null : localParse(text, data.categories);
    const reply = parsed ? applyParsed(parsed) : { role: "bot", text: answerQuestion(t) };
    setChatLog((l) => [...l, reply]);
  };

  const undoTx = (id) => {
    deleteTx(id);
    setChatLog((l) => l.map((m) => (m.undoId === id ? { ...m, text: m.text + "\n↩️ Отменено", undoId: null } : m)));
  };

  // ── окно ввода ──
  const todayInput = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const openSheet = (type) => {
    setFabOpen(false);
    const cat = data.categories[type][0]?.id;
    setSheet({
      type,
      amount: "",
      category: cat,
      envelope: type === "income" ? MAIN : localStorage.getItem("env_" + cat) || MAIN,
      note: "",
      date: todayInput(),
    });
  };
  // при смене категории подставляем конверт, с которого за неё обычно платят
  const pickCategory = (cid) =>
    setSheet((s) => ({ ...s, category: cid, envelope: s.type === "income" ? s.envelope : localStorage.getItem("env_" + cid) || s.envelope }));

  const saveSheet = () => {
    const amount = parseFloat(String(sheet.amount).replace(",", "."));
    if (!(amount > 0)) { showFlash("Введите сумму"); return; }
    if (!sheet.category) { showFlash("Выберите категорию"); return; }
    const [y, m, d] = sheet.date.split("-").map(Number);
    const t = new Date();
    const iso = new Date(y, m - 1, d, t.getHours(), t.getMinutes(), t.getSeconds()).toISOString();
    addTx(sheet.type, activePerson, sheet.category, amount, sheet.note.trim(), iso, sheet.envelope);
    const c = catById(sheet.category);
    const e = envById(sheet.envelope);
    setSheet(null);
    showFlash(`${sheet.type === "income" ? "📥" : "📤"} ${c.emoji} ${fmt(amount)} zł · ${e.emoji} ${e.label}`);
  };

  // ── перевод между конвертами ──
  const openTransfer = (toId) => setTransfer({ from: MAIN, to: toId || data.envelopes.find((e) => !e.main)?.id || MAIN, amount: "" });
  const saveTransfer = () => {
    const amount = parseFloat(String(transfer.amount).replace(",", "."));
    if (!(amount > 0)) { showFlash("Введите сумму"); return; }
    if (transfer.from === transfer.to) { showFlash("Выберите разные конверты"); return; }
    addTransfer(transfer.from, transfer.to, amount);
    const f = envById(transfer.from), t = envById(transfer.to);
    setTransfer(null);
    showFlash(`💸 ${fmt(amount)} zł: ${f.emoji} → ${t.emoji} ${t.label}`);
  };

  // ── конверты: добавление / удаление ──
  const saveNewEnv = () => {
    if (!newEnv.label.trim()) { showFlash("Введите название конверта"); return; }
    const e = { id: "e_" + Date.now(), emoji: newEnv.emoji || "✨", label: newEnv.label.trim(), color: newEnv.color };
    saveEnvelopes([...data.envelopes, e]);
    setNewEnv(null);
    showFlash("✅ Конверт создан");
  };
  const deleteEnv = (id) => {
    const e = envById(id);
    if (e.main) { showFlash("Общий счёт удалить нельзя"); return; }
    const bal = envBalance(id);
    if (!confirm(`Удалить конверт «${e.label}»?${bal !== 0 ? `\nОстаток ${fmt(bal)} zł вернётся на Общий счёт.` : ""}\nЗаписи останутся в истории.`)) return;
    if (bal !== 0) addTransfer(id, MAIN, bal); // остаток не теряется, а возвращается в общий котёл
    saveEnvelopes(data.envelopes.filter((x) => x.id !== id));
  };

  // ── категории ──
  const moveCat = (type, idx, dir) => {
    const arr = [...data.categories[type]];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    saveCats(type, arr);
  };
  const deleteCat = (type, id) => {
    if (data.categories[type].length <= 1) { showFlash("Нельзя удалить последнюю категорию"); return; }
    if (!confirm("Удалить категорию? Записи в ней останутся в истории.")) return;
    saveCats(type, data.categories[type].filter((c) => c.id !== id));
  };
  const addCat = () => {
    if (!newCat.label.trim()) { showFlash("Введите название категории"); return; }
    const cat = { id: "c_" + Date.now(), emoji: newCat.emoji || "✨", label: newCat.label.trim(), color: newCat.color };
    saveCats(newCat.type, [...data.categories[newCat.type], cat]);
    setNewCat({ type: newCat.type, emoji: "✨", label: "", color: PALETTE[0] });
    showFlash("✅ Категория добавлена");
  };

  // ── фото профиля ──
  const uploadAvatar = (personId, file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const S = 120;
        canvas.width = S; canvas.height = S;
        const ctx = canvas.getContext("2d");
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
        savePeople(data.people.map((p) => (p.id === personId ? { ...p, avatar: canvas.toDataURL("image/jpeg", 0.8) } : p)));
        showFlash("📸 Фото обновлено");
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  // ── календарь ──
  const firstOffset = (new Date(month.y, month.m, 1).getDay() + 6) % 7; // Пн = 0
  const dailySpent = {};
  monthTx.filter((t) => t.type === "expense").forEach((t) => {
    const d = new Date(t.date).getDate();
    dailySpent[d] = (dailySpent[d] || 0) + t.amount;
  });
  const maxDaily = Math.max(...Object.values(dailySpent), 1);
  const dayTx = selectedDay ? monthTx.filter((t) => new Date(t.date).getDate() === selectedDay) : [];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-indigo-50">
        <div className="text-center"><div className="text-5xl mb-3 animate-bounce">💰</div><div className="text-indigo-400 font-bold">Загружаем ваш бюджет…</div></div>
      </div>
    );
  }

  const expenseCats = byCat("expense");
  const incomeCats = byCat("income");
  const tips = buildTips();

  const PersonChip = ({ p }) => (
    <button onClick={() => setActivePerson(p.id)}
      className={`flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full transition border-2 ${activePerson === p.id ? "bg-white shadow-md" : "bg-white/40 border-transparent opacity-60"}`}
      style={{ borderColor: activePerson === p.id ? p.color : "transparent" }}>
      <Avatar person={p} size={26} />
      <span className="text-sm font-extrabold text-slate-700">{p.name}</span>
    </button>
  );

  const TxRow = ({ t, border }) => {
    const c = catById(t.category);
    const p = personById(t.personId);
    const e = envById(envOf(t));
    return (
      <div className={`flex items-center gap-3 px-4 py-3 ${border ? "border-t border-slate-100" : ""}`}>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl shrink-0" style={{ background: c.color + "22" }}>{c.emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-slate-800 text-sm truncate">{c.label}{t.note ? ` · ${t.note}` : ""}</div>
          <div className="flex items-center gap-1.5">
            <Avatar person={p} size={16} />
            <span className="text-[11px] font-bold text-slate-400 truncate">{p.name} · {e.emoji} {e.label}</span>
          </div>
        </div>
        <div className={`font-extrabold text-sm shrink-0 ${t.type === "income" ? "text-emerald-500" : "text-rose-500"}`}>
          {t.type === "income" ? "+" : "−"}{fmt(t.amount)} zł
        </div>
        <button onClick={() => { if (confirm("Удалить запись?")) deleteTx(t.id); }} className="text-slate-300 hover:text-rose-400 font-black px-1 shrink-0" aria-label="Удалить">✕</button>
      </div>
    );
  };

  const EnvPicker = ({ value, onPick }) => (
    <div className="flex gap-2 flex-wrap">
      {data.envelopes.map((e) => {
        const on = value === e.id;
        return (
          <button key={e.id} onClick={() => onPick(e.id)}
            className={`flex items-center gap-1.5 pl-2 pr-3 py-2 rounded-2xl text-xs font-extrabold transition border-2 ${on ? "scale-105" : "border-transparent"}`}
            style={{ background: e.color + (on ? "33" : "14"), borderColor: on ? e.color : "transparent", color: "#334155" }}>
            <span className="text-base">{e.emoji}</span>
            <span>{e.label}</span>
            <span className="text-slate-400 font-bold">{fmt(envBalance(e.id))}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-indigo-50">
      <div className="max-w-md mx-auto pb-28">

        {/* ── шапка ── */}
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-2">{data.people.map((p) => <PersonChip key={p.id} p={p} />)}</div>
            <span className="text-[10px] font-bold text-slate-400 text-right leading-tight">кто сейчас<br />вносит</span>
          </div>
          <div className="rounded-3xl p-5 text-white shadow-xl" style={{ background: "linear-gradient(135deg,#6366f1 0%,#8b5cf6 55%,#d946ef 100%)" }}>
            <div className="flex items-center justify-between">
              <button onClick={prevMonth} className="w-9 h-9 rounded-full bg-white/20 font-black text-lg active:scale-90 transition">‹</button>
              <div className="text-center">
                <div className="text-sm font-bold opacity-80">{MONTHS[month.m]} {month.y}</div>
                <div className="text-3xl font-black tracking-tight">{balance < 0 ? "−" : ""}{fmt(Math.abs(balance))} zł</div>
                <div className="text-xs font-semibold opacity-70">📥 +{fmt(income)} · 📤 −{fmt(expense)}</div>
              </div>
              <button onClick={nextMonth} className="w-9 h-9 rounded-full bg-white/20 font-black text-lg active:scale-90 transition">›</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <button onClick={() => openSheet("expense")}
              className="bg-rose-500 text-white font-black py-3.5 rounded-2xl shadow-md active:scale-95 transition flex items-center justify-center gap-2">
              <span className="text-lg">📤</span> Трата
            </button>
            <button onClick={() => openSheet("income")}
              className="bg-emerald-500 text-white font-black py-3.5 rounded-2xl shadow-md active:scale-95 transition flex items-center justify-center gap-2">
              <span className="text-lg">📥</span> Доход
            </button>
          </div>

          {offline && <div className="mt-2 text-xs text-center font-bold text-amber-600 bg-amber-50 rounded-xl py-2">📴 Нет связи — запись сохранится, когда интернет вернётся</div>}
          {saveError && <div className="mt-2 text-xs text-center font-bold text-rose-600 bg-rose-50 rounded-xl py-2">⚠️ Не удалось сохранить — проверьте интернет</div>}
        </div>

        {flash && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white text-sm font-bold px-4 py-2 rounded-full shadow-lg max-w-[92vw] text-center">{flash}</div>}

        {/* ══ ОБЗОР ══ */}
        {tab === "overview" && (
          <div className="px-4 mt-4">

            {/* подсказки */}
            {tips.length > 0 && (
              <div className="mb-4 space-y-2">
                {tips.map((t, i) => (
                  <div key={i} className={`rounded-2xl px-4 py-3 text-sm font-bold leading-snug ${
                    t.tone === "bad" ? "bg-rose-50 text-rose-700"
                      : t.tone === "warn" ? "bg-amber-50 text-amber-700"
                      : "bg-emerald-50 text-emerald-700"}`}>
                    {t.text}
                  </div>
                ))}
              </div>
            )}

            {/* конверты */}
            <div className="bg-white rounded-3xl p-5 shadow-sm mb-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-black text-slate-800 text-lg">💼 Конверты</h2>
                <button onClick={() => openTransfer()} className="text-xs font-extrabold text-indigo-500 bg-indigo-50 rounded-full px-3 py-1.5 active:scale-95 transition">💸 Перевести</button>
              </div>

              {/* общий счёт */}
              <div className="flex items-center gap-3 pb-3 mb-3 border-b border-slate-100">
                <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl shrink-0" style={{ background: mainEnv.color + "22" }}>{mainEnv.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-black text-slate-800">{mainEnv.label}</div>
                  <div className="text-[11px] font-bold text-slate-400">сюда падают доходы, отсюда раздаём</div>
                </div>
                <div className={`font-black text-lg shrink-0 ${envBalance(MAIN) < 0 ? "text-rose-500" : "text-slate-800"}`}>{fmt(envBalance(MAIN))} zł</div>
              </div>

              {data.envelopes.filter((e) => !e.main).length === 0 ? (
                <p className="text-sm text-slate-400 font-semibold">Конвертов пока нет — создайте первый во вкладке ⚙️ Ещё</p>
              ) : (
                data.envelopes.filter((e) => !e.main).map((e) => {
                  const bal = envBalance(e.id);
                  const alloc = envAllocated(e.id);
                  const spent = envSpent(e.id);
                  const pct = alloc > 0 ? Math.min(100, (spent / alloc) * 100) : 0;
                  const over = bal < 0;
                  return (
                    <button key={e.id} onClick={() => openTransfer(e.id)} className="w-full text-left mb-3.5 active:scale-[0.99] transition">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-lg">{e.emoji}</span>
                        <span className="font-extrabold text-slate-700 text-sm flex-1 truncate">{e.label}</span>
                        <span className={`font-black text-sm ${over ? "text-rose-500" : "text-slate-800"}`}>{fmt(bal)} zł</span>
                      </div>
                      {alloc > 0 ? (
                        <>
                          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${Math.max(3, pct)}%`, background: over ? "#ef4444" : pct >= 80 ? "#f59e0b" : e.color }} />
                          </div>
                          <div className="flex justify-between mt-1">
                            <span className="text-[11px] font-bold text-slate-400">потрачено {fmt(spent)} из {fmt(alloc)} zł</span>
                            <span className="text-[11px] font-extrabold" style={{ color: over ? "#ef4444" : pct >= 80 ? "#f59e0b" : "#94a3b8" }}>{Math.round(pct)}%</span>
                          </div>
                        </>
                      ) : (
                        <div className="text-[11px] font-bold text-slate-400">в этом месяце сюда ещё не переводили — нажмите, чтобы пополнить</div>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* кто сколько */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {data.people.map((p) => {
                const s = byPerson(p.id);
                return (
                  <div key={p.id} className="bg-white rounded-3xl p-4 shadow-sm">
                    <div className="flex items-center gap-2 mb-2"><Avatar person={p} size={34} /><span className="font-black text-slate-800">{p.name}</span></div>
                    <div className="text-xs font-bold text-rose-500">📤 −{fmt(s.spent)} zł</div>
                    <div className="text-xs font-bold text-emerald-500">📥 +{fmt(s.earned)} zł</div>
                  </div>
                );
              })}
            </div>

            {/* куда ушли деньги — подробно */}
            <div className="bg-white rounded-3xl p-5 shadow-sm mb-4">
              <h2 className="font-black text-slate-800 mb-3 text-lg">🍩 Куда ушли деньги</h2>
              {expenseCats.length === 0 ? (
                <p className="text-sm text-slate-400 font-semibold">Расходов пока нет — нажмите 📤 «Трата» вверху</p>
              ) : (
                <>
                  <Donut items={expenseCats} total={expense} centerLabel="zł ушло" />
                  <div className="mt-4">
                    {expenseCats.map((c) => {
                      const pct = expense > 0 ? (c.sum / expense) * 100 : 0;
                      const count = monthTx.filter((t) => t.type === "expense" && t.category === c.id).length;
                      return (
                        <div key={c.id} className="mb-3">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-base shrink-0">{c.emoji}</span>
                            <span className="text-sm font-bold text-slate-700 flex-1 truncate">{c.label}</span>
                            <span className="text-sm font-black text-slate-800 shrink-0">{fmt(c.sum)} zł</span>
                            <span className="text-xs font-extrabold shrink-0 w-10 text-right" style={{ color: c.color }}>{Math.round(pct)}%</span>
                          </div>
                          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(3, pct)}%`, background: c.color }} />
                          </div>
                          <div className="text-[11px] font-bold text-slate-400 mt-0.5">
                            {count} {count === 1 ? "операция" : count < 5 ? "операции" : "операций"} · в среднем {fmt(c.sum / count)} zł
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex justify-between pt-3 mt-1 border-t border-slate-100">
                      <span className="font-black text-slate-800">Всего за {MONTHS_GEN[month.m]}</span>
                      <span className="font-black text-rose-500">−{fmt(expense)} zł</span>
                    </div>
                    {prevExpense > 0 && (
                      <div className="text-[11px] font-bold text-slate-400 mt-1 text-right">
                        в {MONTHS_GEN[prev.m]} было {fmt(prevExpense)} zł
                        {expense !== prevExpense && (
                          <span style={{ color: expense > prevExpense ? "#ef4444" : "#10b981" }}>
                            {" "}({expense > prevExpense ? "+" : "−"}{Math.abs(Math.round((expense / prevExpense - 1) * 100))}%)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* откуда пришли */}
            <div className="bg-white rounded-3xl p-5 shadow-sm mb-4">
              <h2 className="font-black text-slate-800 mb-3 text-lg">📥 Откуда пришли</h2>
              {incomeCats.length === 0
                ? <p className="text-sm text-slate-400 font-semibold">Доходов пока нет за этот месяц</p>
                : incomeCats.map((c) => {
                    const max = Math.max(...incomeCats.map((x) => x.sum), 1);
                    const pct = income > 0 ? Math.round((c.sum / income) * 100) : 0;
                    return (
                      <div key={c.id} className="mb-3">
                        <div className="flex justify-between mb-1">
                          <span className="text-sm font-bold text-slate-700">{c.emoji} {c.label}</span>
                          <span className="text-sm font-extrabold" style={{ color: c.color }}>+{fmt(c.sum)} zł · {pct}%</span>
                        </div>
                        <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(4, (c.sum / max) * 100)}%`, background: c.color }} />
                        </div>
                      </div>
                    );
                  })}
            </div>

            {debtLeft > 0 && (
              <button onClick={() => setTab("more")} className="w-full bg-white rounded-3xl p-5 shadow-sm text-left active:scale-[0.98] transition">
                <div className="flex justify-between"><span className="font-black text-slate-800">💶 Долг</span><span className="font-extrabold text-rose-500">осталось {fmt(debtLeft)} €</span></div>
                <div className="h-3 rounded-full bg-slate-100 overflow-hidden mt-3">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" style={{ width: `${debtPct}%` }} />
                </div>
              </button>
            )}
          </div>
        )}

        {/* ══ ЧАТ ══ */}
        {tab === "chat" && (
          <div className="px-4 mt-4 flex flex-col" style={{ minHeight: "55vh" }}>
            <div className="flex-1 overflow-y-auto mb-3">
              {chatLog.map((m, i) => (
                <div key={i} className={`flex mb-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] px-4 py-2.5 text-sm font-semibold whitespace-pre-line ${
                    m.role === "user" ? "bg-indigo-500 text-white rounded-3xl rounded-br-lg" : "bg-white text-slate-700 rounded-3xl rounded-bl-lg shadow-sm"}`}>
                    {m.text}
                    {m.undoId && <button onClick={() => undoTx(m.undoId)} className="block mt-1.5 text-xs font-extrabold text-rose-400">↩️ Отменить</button>}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2 sticky bottom-24">
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                placeholder="500 кроссовки…"
                className="flex-1 bg-white rounded-full py-3 px-5 text-sm font-bold text-slate-800 shadow-sm outline-none focus:ring-2 focus:ring-indigo-300" />
              <button onClick={sendChat}
                className="w-12 h-12 rounded-full bg-indigo-500 text-white font-black text-lg shadow-md active:scale-90 transition shrink-0">➤</button>
            </div>
          </div>
        )}

        {/* ══ КАЛЕНДАРЬ ══ */}
        {tab === "calendar" && (
          <div className="px-4 mt-4">
            <div className="bg-white rounded-3xl p-4 shadow-sm mb-4">
              <div className="grid grid-cols-7 gap-1 mb-1">
                {WEEKDAYS.map((w) => <div key={w} className="text-center text-[10px] font-extrabold text-slate-400 py-1">{w}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstOffset }).map((_, i) => <div key={"e" + i} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const d = i + 1;
                  const spent = dailySpent[d] || 0;
                  const heat = spent / maxDaily;
                  const isToday = d === now.getDate() && isCurrentMonth;
                  return (
                    <button key={d} onClick={() => setSelectedDay(selectedDay === d ? null : d)}
                      className={`rounded-xl py-1.5 flex flex-col items-center transition ${selectedDay === d ? "ring-2 ring-indigo-400" : ""}`}
                      style={{ background: spent > 0 ? `rgba(236,72,153,${0.12 + heat * 0.55})` : "#f8fafc" }}>
                      <span className={`text-xs font-extrabold ${isToday ? "text-indigo-600" : "text-slate-700"}`}>{d}</span>
                      <span className="text-[9px] font-bold text-slate-500 leading-none">{spent > 0 ? fmt(spent) : "·"}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 mt-3 text-[10px] font-bold text-slate-400">
                <span>меньше</span>
                <div className="flex-1 h-2 rounded-full" style={{ background: "linear-gradient(90deg, rgba(236,72,153,.12), rgba(236,72,153,.67))" }} />
                <span>больше трат</span>
              </div>
            </div>

            {selectedDay && (
              <div>
                <div className="text-xs font-extrabold text-slate-400 uppercase tracking-wide mb-2 px-1">{selectedDay} {MONTHS_GEN[month.m]}</div>
                <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
                  {dayTx.length === 0
                    ? <p className="text-sm text-slate-400 font-semibold p-4">В этот день записей нет</p>
                    : dayTx.map((t, i) => <TxRow key={t.id} t={t} border={i > 0} />)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ ИСТОРИЯ ══ */}
        {tab === "history" && (
          <div className="px-4 mt-4">
            {monthTx.length === 0 ? (
              <div className="bg-white rounded-3xl p-8 text-center shadow-sm">
                <div className="text-5xl mb-2">🌱</div>
                <p className="font-bold text-slate-500">За {MONTHS[month.m].toLowerCase()} записей нет.<br />Нажмите 📤 «Трата» или 📥 «Доход» вверху</p>
              </div>
            ) : (
              (() => {
                const map = {};
                monthTx.forEach((t) => { const d = new Date(t.date); const k = `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`; (map[k] = map[k] || []).push(t); });
                return Object.entries(map).map(([day, txs]) => (
                  <div key={day} className="mb-4">
                    <div className="text-xs font-extrabold text-slate-400 uppercase tracking-wide mb-2 px-1">{day}</div>
                    <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
                      {txs.map((t, i) => <TxRow key={t.id} t={t} border={i > 0} />)}
                    </div>
                  </div>
                ));
              })()
            )}

            {/* переводы между конвертами */}
            {data.transfers.filter((t) => inMonth(t.date)).length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-extrabold text-slate-400 uppercase tracking-wide mb-2 px-1">💸 Переводы</div>
                <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
                  {data.transfers.filter((t) => inMonth(t.date)).map((t, i) => {
                    const f = envById(t.from), to = envById(t.to);
                    const d = new Date(t.date);
                    return (
                      <div key={t.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-slate-100" : ""}`}>
                        <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center text-lg shrink-0">💸</div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-800 text-sm truncate">{f.emoji} {f.label} → {to.emoji} {to.label}</div>
                          <div className="text-[11px] font-bold text-slate-400">{d.getDate()} {MONTHS_GEN[d.getMonth()]}</div>
                        </div>
                        <div className="font-extrabold text-sm text-indigo-500 shrink-0">{fmt(t.amount)} zł</div>
                        <button onClick={() => { if (confirm("Удалить перевод?")) deleteTransfer(t.id); }} className="text-slate-300 hover:text-rose-400 font-black px-1 shrink-0">✕</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ ЕЩЁ ══ */}
        {tab === "more" && (
          <div className="px-4 mt-4">
            {/* конверты */}
            <div className="bg-white rounded-3xl p-5 shadow-sm mb-4">
              <h3 className="font-black text-slate-800 mb-3">💼 Конверты</h3>
              {data.envelopes.map((e) => (
                <div key={e.id} className="flex items-center gap-2 py-2 border-t border-slate-50">
                  <span className="w-8 h-8 rounded-xl flex items-center justify-center text-lg shrink-0" style={{ background: e.color + "22" }}>{e.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-700 truncate">{e.label}{e.main && <span className="text-[10px] font-extrabold text-indigo-400"> · главный</span>}</div>
                    <div className="text-[11px] font-bold text-slate-400">остаток {fmt(envBalance(e.id))} zł</div>
                  </div>
                  {!e.main && <button onClick={() => deleteEnv(e.id)} className="text-slate-300 hover:text-rose-400 font-black px-1">✕</button>}
                </div>
              ))}
              <button onClick={() => setNewEnv({ emoji: "✨", label: "", color: PALETTE[0] })}
                className="w-full mt-3 bg-indigo-500 text-white font-black py-2.5 rounded-xl text-sm active:scale-[0.98] transition">➕ Новый конверт</button>
              <p className="text-[11px] font-semibold text-slate-400 mt-2">
                Доходы падают на «Общий счёт». Оттуда переводите деньги в конверты — на еду, хотелки, личный счёт Марины. При трате выбираете, с какого конверта списать.
              </p>
            </div>

            {/* долг */}
            <div className="bg-white rounded-3xl p-5 shadow-sm mb-4 text-center">
              <div className="text-4xl mb-1">{debtLeft === 0 ? "🎉" : "💶"}</div>
              {debtLeft === 0 ? (
                <div className="font-black text-xl text-emerald-500 mb-3">Долг закрыт! Вы молодцы!</div>
              ) : (
                <>
                  <div className="font-black text-2xl text-slate-800">{fmt(debtLeft)} €</div>
                  <div className="text-xs font-bold text-slate-400 mb-2">
                    осталось из{" "}
                    {editDebtTotal ? (
                      <input autoFocus type="number" defaultValue={data.debtTotal}
                        onBlur={(e) => { const v = parseFloat(e.target.value); if (v > 0) guard(set(ref(db, "budget/debtTotal"), v)); setEditDebtTotal(false); }}
                        onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                        className="w-20 text-center font-black text-slate-700 bg-slate-50 rounded-lg outline-none" />
                    ) : (
                      <button onClick={() => setEditDebtTotal(true)} className="font-black text-slate-500 underline decoration-dotted">{fmt(data.debtTotal)}</button>
                    )}{" "}
                    € · выплачено {Math.round(debtPct)}%
                  </div>
                </>
              )}
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden mb-3">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all duration-700" style={{ width: `${debtPct}%` }} />
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input type="number" inputMode="decimal" value={dAmount} onChange={(e) => setDAmount(e.target.value)} placeholder="Сумма платежа"
                    className="w-full font-black text-slate-800 bg-slate-50 rounded-2xl py-3 px-4 pr-8 outline-none focus:ring-2 focus:ring-emerald-300 text-sm" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 font-black text-slate-400 text-sm">€</span>
                </div>
                <button onClick={() => { const a = parseFloat(String(dAmount).replace(",", ".")); if (a > 0) { addDebt(a, activePerson); setDAmount(""); showFlash("💪 Платёж записан"); } }}
                  className="bg-emerald-500 text-white font-black px-5 rounded-2xl active:scale-95 transition text-sm">ОК</button>
              </div>
              {data.debtPayments.length > 0 && (
                <div className="mt-3 text-left">
                  {data.debtPayments.slice(0, 5).map((p) => {
                    const per = personById(p.personId || "p1");
                    const d = new Date(p.date);
                    return (
                      <div key={p.id} className="flex items-center gap-2 py-1.5 border-t border-slate-50">
                        <Avatar person={per} size={20} />
                        <span className="text-xs font-bold text-slate-500 flex-1">{d.getDate()} {MONTHS_GEN[d.getMonth()]} · {per.name}</span>
                        <span className="text-xs font-extrabold text-emerald-500">−{fmt(p.amount)} €</span>
                        <button onClick={() => { if (confirm("Удалить платёж?")) deleteDebt(p.id); }} className="text-slate-300 font-black text-xs">✕</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* профили */}
            <div className="bg-white rounded-3xl p-5 shadow-sm mb-4">
              <h3 className="font-black text-slate-800 mb-3">👫 Профили</h3>
              {data.people.map((p) => (
                <div key={p.id} className="flex items-center gap-3 mb-3">
                  <label className="cursor-pointer relative">
                    <Avatar person={p} size={52} />
                    <span className="absolute -bottom-1 -right-1 bg-indigo-500 text-white w-5 h-5 rounded-full flex items-center justify-center text-[10px]">📷</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files[0] && uploadAvatar(p.id, e.target.files[0])} />
                  </label>
                  {editNames === p.id ? (
                    <input autoFocus defaultValue={p.name}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v) savePeople(data.people.map((x) => (x.id === p.id ? { ...x, name: v } : x))); setEditNames(null); }}
                      onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
                      className="flex-1 font-extrabold text-slate-800 bg-slate-50 rounded-xl py-2 px-3 outline-none focus:ring-2 focus:ring-indigo-300" />
                  ) : (
                    <button onClick={() => setEditNames(p.id)} className="flex-1 text-left font-extrabold text-slate-800">{p.name} <span className="text-xs text-slate-300 font-bold">✏️</span></button>
                  )}
                </div>
              ))}
              <p className="text-[11px] font-semibold text-slate-400">Нажмите на фото, чтобы загрузить своё · на имя — чтобы изменить</p>
            </div>

            {/* категории */}
            <div className="bg-white rounded-3xl p-5 shadow-sm mb-4">
              <h3 className="font-black text-slate-800 mb-3">🎨 Категории</h3>
              {["expense", "income"].map((type) => (
                <div key={type} className="mb-4">
                  <div className="text-xs font-extrabold text-slate-400 uppercase mb-2">{type === "expense" ? "📤 Расходы" : "📥 Доходы"}</div>
                  {data.categories[type].map((c, i) => (
                    <div key={c.id} className="flex items-center gap-2 py-1.5 border-t border-slate-50">
                      <span className="w-8 h-8 rounded-xl flex items-center justify-center text-lg shrink-0" style={{ background: c.color + "22" }}>{c.emoji}</span>
                      <span className="flex-1 text-sm font-bold text-slate-700 truncate">{c.label}</span>
                      <button onClick={() => moveCat(type, i, -1)} className="text-slate-300 font-black px-1">↑</button>
                      <button onClick={() => moveCat(type, i, 1)} className="text-slate-300 font-black px-1">↓</button>
                      <button onClick={() => deleteCat(type, c.id)} className="text-slate-300 hover:text-rose-400 font-black px-1">✕</button>
                    </div>
                  ))}
                </div>
              ))}
              <div className="bg-slate-50 rounded-2xl p-3">
                <div className="text-xs font-extrabold text-slate-500 mb-2">➕ Новая категория</div>
                <div className="flex gap-2 mb-2">
                  <button onClick={() => setNewCat({ ...newCat, type: "expense" })} className={`flex-1 py-1.5 rounded-xl text-xs font-extrabold ${newCat.type === "expense" ? "bg-rose-500 text-white" : "bg-white text-slate-400"}`}>Расход</button>
                  <button onClick={() => setNewCat({ ...newCat, type: "income" })} className={`flex-1 py-1.5 rounded-xl text-xs font-extrabold ${newCat.type === "income" ? "bg-emerald-500 text-white" : "bg-white text-slate-400"}`}>Доход</button>
                </div>
                <div className="flex gap-2 mb-2">
                  <input value={newCat.emoji} onChange={(e) => setNewCat({ ...newCat, emoji: e.target.value.slice(0, 4) })}
                    className="w-14 text-center text-xl bg-white rounded-xl py-2 outline-none focus:ring-2 focus:ring-indigo-300" />
                  <input value={newCat.label} onChange={(e) => setNewCat({ ...newCat, label: e.target.value })} placeholder="Например: Материалы для ногтей"
                    className="flex-1 text-sm font-bold text-slate-700 bg-white rounded-xl py-2 px-3 outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>
                <div className="flex gap-1.5 mb-3 flex-wrap">
                  {PALETTE.map((col) => (
                    <button key={col} onClick={() => setNewCat({ ...newCat, color: col })}
                      className={`w-7 h-7 rounded-full transition ${newCat.color === col ? "ring-2 ring-offset-2 ring-slate-400 scale-110" : ""}`} style={{ background: col }} />
                  ))}
                </div>
                <button onClick={addCat} className="w-full bg-indigo-500 text-white font-black py-2.5 rounded-xl text-sm active:scale-[0.98] transition">Добавить категорию</button>
              </div>
            </div>
          </div>
        )}

        {/* ══ ОКНО: ТРАТА / ДОХОД ══ */}
        {sheet && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40" onClick={() => setSheet(null)}>
            <div className="w-full max-w-md bg-white rounded-t-3xl p-5 pb-8 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-black text-xl text-slate-800">{sheet.type === "expense" ? "📤 Новая трата" : "📥 Новый доход"}</h2>
                <button onClick={() => setSheet(null)} className="w-9 h-9 rounded-full bg-slate-100 text-slate-400 font-black">✕</button>
              </div>

              <div className="relative mb-4">
                <input autoFocus type="number" inputMode="decimal" value={sheet.amount}
                  onChange={(e) => setSheet({ ...sheet, amount: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && saveSheet()}
                  placeholder="0"
                  className="w-full text-center text-4xl font-black text-slate-800 bg-slate-50 rounded-2xl py-5 pr-12 outline-none focus:ring-2 focus:ring-indigo-300" />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 text-2xl font-black text-slate-300">zł</span>
              </div>

              <div className="text-xs font-extrabold text-slate-400 uppercase mb-2">Категория</div>
              <div className="grid grid-cols-4 gap-2 mb-4">
                {data.categories[sheet.type].map((c) => {
                  const on = sheet.category === c.id;
                  return (
                    <button key={c.id} onClick={() => pickCategory(c.id)}
                      className={`rounded-2xl py-2.5 px-1 flex flex-col items-center gap-1 transition border-2 ${on ? "scale-105" : "border-transparent"}`}
                      style={{ background: c.color + (on ? "33" : "14"), borderColor: on ? c.color : "transparent" }}>
                      <span className="text-2xl leading-none">{c.emoji}</span>
                      <span className="text-[10px] font-extrabold text-slate-600 leading-tight text-center break-words w-full">{c.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="text-xs font-extrabold text-slate-400 uppercase mb-2">
                {sheet.type === "expense" ? "С какого конверта списать" : "На какой конверт зачислить"}
              </div>
              <div className="mb-4">
                <EnvPicker value={sheet.envelope} onPick={(id) => setSheet({ ...sheet, envelope: id })} />
                {sheet.type === "expense" && (() => {
                  const bal = envBalance(sheet.envelope);
                  const amt = parseFloat(String(sheet.amount).replace(",", ".")) || 0;
                  if (amt > 0 && amt > bal) {
                    return <div className="text-[11px] font-bold text-amber-600 mt-2">⚠️ В конверте {fmt(bal)} zł — после этой траты уйдёт в минус на {fmt(amt - bal)} zł</div>;
                  }
                  return <div className="text-[11px] font-bold text-slate-400 mt-2">В конверте {fmt(bal)} zł</div>;
                })()}
              </div>

              <input value={sheet.note} onChange={(e) => setSheet({ ...sheet, note: e.target.value })}
                placeholder="Заметка (необязательно)"
                className="w-full text-sm font-bold text-slate-700 bg-slate-50 rounded-2xl py-3 px-4 mb-3 outline-none focus:ring-2 focus:ring-indigo-300" />

              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs font-extrabold text-slate-400 uppercase shrink-0">Дата</span>
                <input type="date" value={sheet.date} onChange={(e) => setSheet({ ...sheet, date: e.target.value })}
                  className="flex-1 text-sm font-bold text-slate-700 bg-slate-50 rounded-2xl py-2.5 px-4 outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>

              <div className="flex items-center gap-2 mb-4">
                <span className="text-xs font-extrabold text-slate-400 uppercase shrink-0">Вносит</span>
                <div className="flex gap-2">{data.people.map((p) => <PersonChip key={p.id} p={p} />)}</div>
              </div>

              <button onClick={saveSheet}
                className={`w-full text-white font-black py-4 rounded-2xl text-lg active:scale-[0.98] transition ${sheet.type === "expense" ? "bg-rose-500" : "bg-emerald-500"}`}>
                Записать
              </button>
            </div>
          </div>
        )}

        {/* ══ ОКНО: ПЕРЕВОД ══ */}
        {transfer && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40" onClick={() => setTransfer(null)}>
            <div className="w-full max-w-md bg-white rounded-t-3xl p-5 pb-8 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-black text-xl text-slate-800">💸 Перевод между конвертами</h2>
                <button onClick={() => setTransfer(null)} className="w-9 h-9 rounded-full bg-slate-100 text-slate-400 font-black">✕</button>
              </div>

              <div className="relative mb-4">
                <input autoFocus type="number" inputMode="decimal" value={transfer.amount}
                  onChange={(e) => setTransfer({ ...transfer, amount: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && saveTransfer()}
                  placeholder="0"
                  className="w-full text-center text-4xl font-black text-slate-800 bg-slate-50 rounded-2xl py-5 pr-12 outline-none focus:ring-2 focus:ring-indigo-300" />
                <span className="absolute right-5 top-1/2 -translate-y-1/2 text-2xl font-black text-slate-300">zł</span>
              </div>

              <div className="text-xs font-extrabold text-slate-400 uppercase mb-2">Откуда</div>
              <div className="mb-4"><EnvPicker value={transfer.from} onPick={(id) => setTransfer({ ...transfer, from: id })} /></div>

              <div className="text-xs font-extrabold text-slate-400 uppercase mb-2">Куда</div>
              <div className="mb-5"><EnvPicker value={transfer.to} onPick={(id) => setTransfer({ ...transfer, to: id })} /></div>

              <button onClick={saveTransfer} className="w-full bg-indigo-500 text-white font-black py-4 rounded-2xl text-lg active:scale-[0.98] transition">
                Перевести
              </button>
            </div>
          </div>
        )}

        {/* ══ ОКНО: НОВЫЙ КОНВЕРТ ══ */}
        {newEnv && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40" onClick={() => setNewEnv(null)}>
            <div className="w-full max-w-md bg-white rounded-t-3xl p-5 pb-8" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-black text-xl text-slate-800">💼 Новый конверт</h2>
                <button onClick={() => setNewEnv(null)} className="w-9 h-9 rounded-full bg-slate-100 text-slate-400 font-black">✕</button>
              </div>
              <div className="flex gap-2 mb-3">
                <input value={newEnv.emoji} onChange={(e) => setNewEnv({ ...newEnv, emoji: e.target.value.slice(0, 4) })}
                  className="w-16 text-center text-2xl bg-slate-50 rounded-2xl py-3 outline-none focus:ring-2 focus:ring-indigo-300" />
                <input autoFocus value={newEnv.label} onChange={(e) => setNewEnv({ ...newEnv, label: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && saveNewEnv()}
                  placeholder="Например: Счёт Марины"
                  className="flex-1 text-sm font-bold text-slate-700 bg-slate-50 rounded-2xl py-3 px-4 outline-none focus:ring-2 focus:ring-indigo-300" />
              </div>
              <div className="flex gap-1.5 mb-5 flex-wrap">
                {PALETTE.map((col) => (
                  <button key={col} onClick={() => setNewEnv({ ...newEnv, color: col })}
                    className={`w-8 h-8 rounded-full transition ${newEnv.color === col ? "ring-2 ring-offset-2 ring-slate-400 scale-110" : ""}`} style={{ background: col }} />
                ))}
              </div>
              <button onClick={saveNewEnv} className="w-full bg-indigo-500 text-white font-black py-4 rounded-2xl text-lg active:scale-[0.98] transition">Создать</button>
            </div>
          </div>
        )}

        {/* ── круглая ➕ при прокрутке ── */}
        {scrolled && !sheet && !transfer && !newEnv && (
          <div className="fixed right-4 bottom-28 z-40 flex flex-col items-end gap-2">
            {fabOpen && (
              <>
                <button onClick={() => openSheet("income")}
                  className="flex items-center gap-2 bg-emerald-500 text-white font-black pl-4 pr-5 py-3 rounded-full shadow-xl active:scale-95 transition">
                  <span>📥</span> Доход
                </button>
                <button onClick={() => openSheet("expense")}
                  className="flex items-center gap-2 bg-rose-500 text-white font-black pl-4 pr-5 py-3 rounded-full shadow-xl active:scale-95 transition">
                  <span>📤</span> Трата
                </button>
              </>
            )}
            <button onClick={() => setFabOpen((v) => !v)}
              className={`w-14 h-14 rounded-full bg-indigo-500 text-white text-3xl font-black shadow-xl active:scale-90 transition flex items-center justify-center ${fabOpen ? "rotate-45" : ""}`}
              style={{ transition: "transform .2s" }} aria-label="Добавить">
              ＋
            </button>
          </div>
        )}

        {/* ── нижняя навигация ── */}
        <div className="fixed bottom-0 left-0 right-0 z-40">
          <div className="max-w-md mx-auto px-4 pb-4">
            <div className="bg-white rounded-3xl shadow-xl border border-slate-100 flex">
              {[
                { id: "overview", emoji: "📊", label: "Обзор" },
                { id: "chat", emoji: "💬", label: "Чат" },
                { id: "calendar", emoji: "📅", label: "Дни" },
                { id: "history", emoji: "📜", label: "Лента" },
                { id: "more", emoji: "⚙️", label: "Ещё" },
              ].map((t) => (
                <button key={t.id} onClick={() => { setTab(t.id); setFabOpen(false); }}
                  className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 rounded-3xl transition ${tab === t.id ? "bg-indigo-50" : ""}`}>
                  <span className="text-xl">{t.emoji}</span>
                  <span className={`text-[10px] font-extrabold ${tab === t.id ? "text-indigo-600" : "text-slate-400"}`}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
