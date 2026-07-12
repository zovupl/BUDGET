import { useState, useEffect, useRef } from "react";

// ═══════════════════════════════════════════════════
//  Семейный бюджет 2.0 · Митя & Марина
//  · умный чат-ввод («500 кроссовки» → −500 zł Хотелки)
//  · профили с фото · донат-диаграмма · календарь
//  · редактируемые категории · долг в €
// ═══════════════════════════════════════════════════

const STORAGE_KEY = "family-budget-v2";
const OLD_KEY = "family-budget-v1";

const PALETTE = ["#8b5cf6","#f59e0b","#3b82f6","#ec4899","#f97316","#ef4444","#a855f7","#10b981","#06b6d4","#84cc16","#64748b","#14b8a6"];

const DEFAULT_DATA = {
  version: 2,
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
  transactions: [],
  debtTotal: 3000,
  debtPayments: [],
};

const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const MONTHS_GEN = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
const WEEKDAYS = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

const fmt = (n) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(n));

// ── запасной локальный парсер (если ИИ недоступен) ──
const KEYWORDS = {
  food: ["еда","едa","продукт","бедронк","biedronka","lidl","лидл","жабка","żabka","zabka","магазин","кафе","ресторан","пицц","суши","кофе","обед","ужин","завтрак"],
  rent: ["квартир","аренда","чинш","czynsz","жиль"],
  subs: ["подписк","spotify","спотифай","youtube","ютуб","claude","клод","chatgpt","чатжпт","canva","канва","google","гугл","play","нетфликс","netflix"],
  wants: ["кроссовк","одежд","дух","шмот","обувь","косметик","парфюм","кофт","джинс","платье","сумк","украшен"],
  transport: ["такси","uber","убер","bolt","болт","автобус","метро","бензин","проезд","билет"],
  health: ["аптек","врач","лекарств","стоматолог","витамин","клиник"],
  fun: ["кино","бар","клуб","игр","концерт","боулинг","развлеч"],
};

function localParse(text, cats) {
  const t = text.toLowerCase();
  const m = t.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const amount = parseFloat(m[1].replace(",", "."));
  const isIncome = /зарплат|фриланс|заказ|получил|пришл|доход|аванс|премия|\+/.test(t);
  let catId = isIncome ? "other_in" : "other_out";
  if (isIncome) {
    if (/фриланс|заказ/.test(t)) catId = "freelance";
    else if (/зарплат/.test(t)) catId = "salary_h";
  } else {
    for (const [id, words] of Object.entries(KEYWORDS)) {
      if (words.some((w) => t.includes(w))) { catId = id; break; }
    }
  }
  const pool = isIncome ? cats.income : cats.expense;
  if (!pool.find((c) => c.id === catId)) catId = pool[pool.length - 1]?.id;
  const note = text.replace(m[0], "").replace(/зл|zł|злот\w*|pln/gi, "").trim();
  return { action: "add", type: isIncome ? "income" : "expense", amount, category: catId, note };
}

// ── вызов Claude API для умного разбора и вопросов ──
async function askClaude(userText, ctx) {
  const prompt = `Ты — движок семейного бюджет-приложения пары Митя и Марина (Польша, злотые zł, долг в €).

ДОСТУПНЫЕ КАТЕГОРИИ РАСХОДОВ: ${ctx.expenseCats.map((c) => `${c.id}="${c.label}"`).join(", ")}
ДОСТУПНЫЕ КАТЕГОРИИ ДОХОДОВ: ${ctx.incomeCats.map((c) => `${c.id}="${c.label}"`).join(", ")}

ДАННЫЕ ЗА ТЕКУЩИЙ МЕСЯЦ (${ctx.monthName}):
${ctx.summary}

Пользователь (${ctx.personName}) написал: "${userText}"

Определи, что он хочет:
1. Если это запись траты или дохода (например «500 кроссовки», «зарплата 6400», «бедронка 120,50») — верни:
{"action":"add","type":"expense"|"income","amount":число,"category":"id категории из списка","note":"краткая заметка без суммы и валюты"}
2. Если это платёж по долгу (например «отдал 200 евро долга») — верни:
{"action":"debt","amount":число}
3. Если это вопрос о финансах или просьба о совете — верни:
{"action":"answer","text":"дружелюбный ответ по-русски, кратко, с эмодзи, на основе данных выше"}

Отвечай ТОЛЬКО валидным JSON без markdown и пояснений.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const d = await response.json();
  const text = (d.content || []).map((i) => i.text || "").join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ── аватарка ──
function Avatar({ person, size = 40 }) {
  return person.avatar ? (
    <img src={person.avatar} alt={person.name} style={{ width: size, height: size, borderColor: person.color }} className="rounded-full object-cover border-2 shrink-0" />
  ) : (
    <div style={{ width: size, height: size, background: person.color }} className="rounded-full flex items-center justify-center text-white font-black shrink-0" >
      <span style={{ fontSize: size * 0.42 }}>{person.name[0]}</span>
    </div>
  );
}

// ── донат-диаграмма ──
function Donut({ items, total, centerLabel }) {
  const R = 70, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex items-center gap-5">
      <svg width="170" height="170" viewBox="0 0 170 170" className="shrink-0">
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
        <text x="85" y="80" textAnchor="middle" className="font-black" style={{ fontSize: 22, fill: "#1e293b", fontFamily: "'Nunito',sans-serif", fontWeight: 900 }}>{fmt(total)}</text>
        <text x="85" y="100" textAnchor="middle" style={{ fontSize: 12, fill: "#94a3b8", fontFamily: "'Nunito',sans-serif", fontWeight: 700 }}>{centerLabel}</text>
      </svg>
      <div className="flex-1 min-w-0">
        {items.slice(0, 6).map((it) => (
          <div key={it.id} className="flex items-center gap-2 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: it.color }} />
            <span className="text-xs font-bold text-slate-600 truncate flex-1">{it.emoji} {it.label}</span>
            <span className="text-xs font-extrabold text-slate-800 shrink-0">{total > 0 ? Math.round((it.sum / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FamilyBudget() {
  const [data, setData] = useState(DEFAULT_DATA);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [tab, setTab] = useState("overview");
  const now = new Date();
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [activePerson, setActivePerson] = useState("p1");
  const [flash, setFlash] = useState("");

  // чат
  const [chatLog, setChatLog] = useState([
    { role: "bot", text: "Привет! 👋 Пишите траты как в мессенджере:\n«500 кроссовки» · «бедронка 120» · «зарплата 6400»\n\nИли спросите: «сколько ушло на еду?»" },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const chatEndRef = useRef(null);

  // календарь
  const [selectedDay, setSelectedDay] = useState(null);

  // формы «Ещё»
  const [newCat, setNewCat] = useState({ type: "expense", emoji: "✨", label: "", color: PALETTE[0] });
  const [dAmount, setDAmount] = useState("");
  const [editNames, setEditNames] = useState(null);

  // ── загрузка (с миграцией со старой версии) ──
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(STORAGE_KEY, true);
        if (r && r.value) { setData({ ...DEFAULT_DATA, ...JSON.parse(r.value) }); setLoading(false); return; }
      } catch (e) {}
      try {
        const old = await window.storage.get(OLD_KEY, true);
        if (old && old.value) {
          const o = JSON.parse(old.value);
          const migrated = {
            ...DEFAULT_DATA,
            transactions: (o.transactions || []).map((t) => ({ ...t, personId: t.who === "Жена" ? "p2" : "p1" })),
            debtTotal: o.debtTotal || 3000,
            debtPayments: (o.debtPayments || []).map((p) => ({ ...p, personId: p.who === "Жена" ? "p2" : "p1" })),
          };
          setData(migrated);
          try { await window.storage.set(STORAGE_KEY, JSON.stringify(migrated), true); } catch (e) {}
        }
      } catch (e) {}
      setLoading(false);
    })();
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatLog, tab]);

  const persist = async (next) => {
    setData(next);
    try {
      const r = await window.storage.set(STORAGE_KEY, JSON.stringify(next), true);
      setSaveError(!r);
    } catch (e) { setSaveError(true); }
  };

  const showFlash = (msg) => { setFlash(msg); setTimeout(() => setFlash(""), 2000); };

  const catById = (id) => [...data.categories.income, ...data.categories.expense].find((c) => c.id === id) || { emoji: "❓", label: "Прочее", color: "#94a3b8", id };
  const personById = (id) => data.people.find((p) => p.id === id) || data.people[0];

  // ── операции ──
  const addTx = (type, personId, category, amount, note, dateIso) => {
    const tx = { id: Date.now() + "_" + Math.random().toString(36).slice(2, 6), type, personId, category, amount, note: note || "", date: dateIso || new Date().toISOString() };
    persist({ ...data, transactions: [tx, ...data.transactions] });
    return tx;
  };
  const deleteTx = (id) => persist({ ...data, transactions: data.transactions.filter((t) => t.id !== id) });
  const addDebt = (amount, personId) => {
    const p = { id: Date.now() + "", amount, personId, date: new Date().toISOString() };
    persist({ ...data, debtPayments: [p, ...data.debtPayments] });
  };
  const deleteDebt = (id) => persist({ ...data, debtPayments: data.debtPayments.filter((p) => p.id !== id) });

  // ── расчёты за месяц ──
  const inMonth = (iso) => { const d = new Date(iso); return d.getFullYear() === month.y && d.getMonth() === month.m; };
  const monthTx = data.transactions.filter((t) => inMonth(t.date));
  const income = monthTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = monthTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const balance = income - expense;

  const byCat = (type) => {
    const map = {};
    monthTx.filter((t) => t.type === type).forEach((t) => { map[t.category] = (map[t.category] || 0) + t.amount; });
    return Object.entries(map).map(([id, sum]) => ({ ...catById(id), sum })).sort((a, b) => b.sum - a.sum);
  };
  const byPerson = (pid) => ({
    spent: monthTx.filter((t) => t.type === "expense" && t.personId === pid).reduce((s, t) => s + t.amount, 0),
    earned: monthTx.filter((t) => t.type === "income" && t.personId === pid).reduce((s, t) => s + t.amount, 0),
  });

  const debtPaid = data.debtPayments.reduce((s, p) => s + p.amount, 0);
  const debtLeft = Math.max(0, data.debtTotal - debtPaid);
  const debtPct = Math.min(100, data.debtTotal > 0 ? (debtPaid / data.debtTotal) * 100 : 100);

  const prevMonth = () => { setSelectedDay(null); setMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 })); };
  const nextMonth = () => { setSelectedDay(null); setMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 })); };

  // ── чат ──
  const buildContext = () => {
    const expCats = byCat("expense").map((c) => `${c.label}: ${fmt(c.sum)} zł`).join("; ") || "расходов нет";
    const pStats = data.people.map((p) => { const s = byPerson(p.id); return `${p.name}: потратил(а) ${fmt(s.spent)} zł, внёс(ла) ${fmt(s.earned)} zł`; }).join("; ");
    return {
      expenseCats: data.categories.expense,
      incomeCats: data.categories.income,
      monthName: `${MONTHS[month.m]} ${month.y}`,
      personName: personById(activePerson).name,
      summary: `Доходы: ${fmt(income)} zł. Расходы: ${fmt(expense)} zł. Остаток: ${fmt(balance)} zł.\nПо категориям: ${expCats}.\nПо людям: ${pStats}.\nДолг: осталось ${fmt(debtLeft)} € из ${fmt(data.debtTotal)} €.`,
    };
  };

  const applyParsed = (parsed) => {
    if (parsed.action === "add" && parsed.amount > 0) {
      const tx = addTx(parsed.type, activePerson, parsed.category, parsed.amount, parsed.note);
      const c = catById(parsed.category);
      const sign = parsed.type === "income" ? "+" : "−";
      return { role: "bot", text: `✅ Записал: ${c.emoji} ${c.label} ${sign}${fmt(parsed.amount)} zł · ${personById(activePerson).name}`, undoId: tx.id };
    }
    if (parsed.action === "debt" && parsed.amount > 0) {
      addDebt(parsed.amount, activePerson);
      return { role: "bot", text: `💪 Платёж по долгу −${fmt(parsed.amount)} € записан! Осталось ${fmt(Math.max(0, debtLeft - parsed.amount))} €` };
    }
    if (parsed.action === "answer") return { role: "bot", text: parsed.text };
    return { role: "bot", text: "🤔 Не понял. Напишите, например: «500 кроссовки» или «сколько ушло на еду?»" };
  };

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatInput("");
    setChatLog((l) => [...l, { role: "user", text }]);
    setChatBusy(true);
    let reply;
    try {
      const parsed = await askClaude(text, buildContext());
      reply = applyParsed(parsed);
    } catch (e) {
      const fallback = localParse(text, data.categories);
      reply = fallback ? applyParsed(fallback) : { role: "bot", text: "😕 Не получилось разобрать. Попробуйте так: «120 бедронка» или «зарплата 6400»" };
    }
    setChatLog((l) => [...l, reply]);
    setChatBusy(false);
  };

  const undoTx = (id) => {
    deleteTx(id);
    setChatLog((l) => l.map((m) => (m.undoId === id ? { ...m, text: m.text + "\n↩️ Отменено", undoId: null } : m)));
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
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        persist({ ...data, people: data.people.map((p) => (p.id === personId ? { ...p, avatar: dataUrl } : p)) });
        showFlash("📸 Фото обновлено");
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  // ── категории ──
  const moveCat = (type, idx, dir) => {
    const arr = [...data.categories[type]];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    persist({ ...data, categories: { ...data.categories, [type]: arr } });
  };
  const deleteCat = (type, id) => {
    if (data.categories[type].length <= 1) { showFlash("Нельзя удалить последнюю категорию"); return; }
    if (!confirm("Удалить категорию? Записи в ней останутся в истории.")) return;
    persist({ ...data, categories: { ...data.categories, [type]: data.categories[type].filter((c) => c.id !== id) } });
  };
  const addCat = () => {
    if (!newCat.label.trim()) { showFlash("Введите название категории"); return; }
    const cat = { id: "c_" + Date.now(), emoji: newCat.emoji || "✨", label: newCat.label.trim(), color: newCat.color };
    persist({ ...data, categories: { ...data.categories, [newCat.type]: [...data.categories[newCat.type], cat] } });
    setNewCat({ type: newCat.type, emoji: "✨", label: "", color: PALETTE[0] });
    showFlash("✅ Категория добавлена");
  };

  // ── календарь ──
  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate();
  const firstOffset = (new Date(month.y, month.m, 1).getDay() + 6) % 7; // Пн=0
  const dailySpent = {};
  monthTx.filter((t) => t.type === "expense").forEach((t) => {
    const d = new Date(t.date).getDate();
    dailySpent[d] = (dailySpent[d] || 0) + t.amount;
  });
  const maxDaily = Math.max(...Object.values(dailySpent), 1);
  const dayTx = selectedDay ? monthTx.filter((t) => new Date(t.date).getDate() === selectedDay) : [];

  if (loading) {
    return (
      <div style={{ fontFamily: "'Nunito', sans-serif" }} className="min-h-screen flex items-center justify-center bg-indigo-50">
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');`}</style>
        <div className="text-center"><div className="text-5xl mb-3 animate-bounce">💰</div><div className="text-indigo-400 font-bold">Загружаем ваш бюджет…</div></div>
      </div>
    );
  }

  const expenseCats = byCat("expense");
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
    return (
      <div className={`flex items-center gap-3 px-4 py-3 ${border ? "border-t border-slate-100" : ""}`}>
        <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl shrink-0" style={{ background: c.color + "22" }}>{c.emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-slate-800 text-sm truncate">{c.label}{t.note ? ` · ${t.note}` : ""}</div>
          <div className="flex items-center gap-1.5"><Avatar person={p} size={16} /><span className="text-[11px] font-bold text-slate-400">{p.name}</span></div>
        </div>
        <div className={`font-extrabold text-sm shrink-0 ${t.type === "income" ? "text-emerald-500" : "text-rose-500"}`}>
          {t.type === "income" ? "+" : "−"}{fmt(t.amount)} zł
        </div>
        <button onClick={() => { if (confirm("Удалить запись?")) deleteTx(t.id); }} className="text-slate-300 hover:text-rose-400 font-black px-1 shrink-0" aria-label="Удалить">✕</button>
      </div>
    );
  };

  return (
    <div style={{ fontFamily: "'Nunito', sans-serif" }} className="min-h-screen bg-indigo-50">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');`}</style>
      <div className="max-w-md mx-auto pb-28">

        {/* ── шапка ── */}
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-2">{data.people.map((p) => <PersonChip key={p.id} p={p} />)}</div>
            <span className="text-[10px] font-bold text-slate-400 text-right leading-tight">кто сейчас<br/>вносит</span>
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
          {saveError && <div className="mt-2 text-xs text-center font-bold text-rose-600 bg-rose-50 rounded-xl py-2">⚠️ Не удалось сохранить — проверьте интернет</div>}
        </div>

        {flash && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-bold px-4 py-2 rounded-full shadow-lg">{flash}</div>}

        {/* ══ ОБЗОР ══ */}
        {tab === "overview" && (
          <div className="px-4 mt-4">
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

            {/* донат */}
            <div className="bg-white rounded-3xl p-5 shadow-sm mb-4">
              <h2 className="font-black text-slate-800 mb-3 text-lg">🍩 Куда ушли деньги</h2>
              {expenseCats.length === 0
                ? <p className="text-sm text-slate-400 font-semibold">Расходов пока нет — напишите первый в 💬 Чат!</p>
                : <Donut items={expenseCats} total={expense} centerLabel="zł ушло" />}
            </div>

            {/* доходы полосками */}
            <div className="bg-white rounded-3xl p-5 shadow-sm mb-4">
              <h2 className="font-black text-slate-800 mb-3 text-lg">📥 Откуда пришли</h2>
              {byCat("income").length === 0
                ? <p className="text-sm text-slate-400 font-semibold">Доходов пока нет за этот месяц</p>
                : byCat("income").map((c) => {
                    const max = Math.max(...byCat("income").map((x) => x.sum), 1);
                    return (
                      <div key={c.id} className="mb-3">
                        <div className="flex justify-between mb-1">
                          <span className="text-sm font-bold text-slate-700">{c.emoji} {c.label}</span>
                          <span className="text-sm font-extrabold" style={{ color: c.color }}>+{fmt(c.sum)} zł</span>
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
              {chatBusy && <div className="flex justify-start mb-2"><div className="bg-white rounded-3xl rounded-bl-lg shadow-sm px-4 py-2.5 text-sm font-bold text-slate-400">Думаю… 🤔</div></div>}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2 sticky bottom-24">
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                placeholder="500 кроссовки…"
                className="flex-1 bg-white rounded-full py-3 px-5 text-sm font-bold text-slate-800 shadow-sm outline-none focus:ring-2 focus:ring-indigo-300" />
              <button onClick={sendChat} disabled={chatBusy}
                className="w-12 h-12 rounded-full bg-indigo-500 text-white font-black text-lg shadow-md active:scale-90 transition disabled:opacity-50">➤</button>
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
                  const isToday = d === now.getDate() && month.m === now.getMonth() && month.y === now.getFullYear();
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
                <p className="font-bold text-slate-500">За {MONTHS[month.m].toLowerCase()} записей нет.<br/>Напишите первую в 💬 Чат!</p>
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
          </div>
        )}

        {/* ══ ЕЩЁ: долг, профили, категории ══ */}
        {tab === "more" && (
          <div className="px-4 mt-4">
            {/* долг */}
            <div className="bg-white rounded-3xl p-5 shadow-sm mb-4 text-center">
              <div className="text-4xl mb-1">{debtLeft === 0 ? "🎉" : "💶"}</div>
              {debtLeft === 0
                ? <div className="font-black text-xl text-emerald-500">Долг закрыт! Вы молодцы!</div>
                : <><div className="font-black text-2xl text-slate-800">{fmt(debtLeft)} €</div><div className="text-xs font-bold text-slate-400 mb-2">осталось из {fmt(data.debtTotal)} € · выплачено {Math.round(debtPct)}%</div></>}
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
                      onBlur={(e) => { const v = e.target.value.trim(); if (v) persist({ ...data, people: data.people.map((x) => x.id === p.id ? { ...x, name: v } : x) }); setEditNames(null); }}
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
                <button key={t.id} onClick={() => setTab(t.id)}
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
