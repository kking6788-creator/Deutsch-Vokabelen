import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  RotateCcw, Check, X, Plus, Trash2, BookOpen, Type as TypeIcon,
  Settings, Clock, Sparkles, Pencil, Frown, Star, FolderPlus, Folder,
} from "lucide-react";

const STORAGE_KEY = "de-vocab-data-v3";
const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_FOLDER = "미분류";
const BUCKET_LABELS = ["0-1일", "2-3일", "4-7일", "8-14일", "15일+"];
const BUCKET_COLORS = ["#E5534B", "#E8B23D", "#4CAF77", "#5B8DEF", "#9B7FD4"];

const DEFAULT_WORDS = [
  { de: "Haus", ko: "집", example: "Das Haus ist groß.", exampleKo: "그 집은 커요." },
  { de: "Wasser", ko: "물", example: "Ich trinke gern Wasser.", exampleKo: "저는 물을 즐겨 마셔요." },
].map((w, i) => ({
  id: `w${i}`, ...w, folder: DEFAULT_FOLDER,
  ef: 2.5, repetition: 0, interval: 0, nextReview: Date.now(),
}));

function makeId() {
  return "w" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---- SM-2 spaced repetition algorithm ----
// quality: 0 (again) / 3 (hard) / 4 (good) / 5 (easy)
function sm2Update(word, quality) {
  let { ef, repetition, interval } = word;
  if (quality < 3) {
    repetition = 0;
    interval = 1;
  } else {
    if (repetition === 0) interval = 1;
    else if (repetition === 1) interval = 6;
    else interval = Math.round(interval * ef);
    repetition += 1;
  }
  ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (ef < 1.3) ef = 1.3;
  return { ef, repetition, interval, nextReview: Date.now() + interval * DAY };
}

function bucketIndex(interval) {
  if (interval <= 1) return 0;
  if (interval <= 3) return 1;
  if (interval <= 7) return 2;
  if (interval <= 14) return 3;
  return 4;
}

function fmtWhen(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return "지금";
  const days = Math.round(diff / DAY);
  if (days <= 0) return "오늘";
  if (days === 1) return "내일";
  return `${days}일 후`;
}

function polar(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function arcPath(cx, cy, r, startAngle, endAngle) {
  const start = polar(cx, cy, r, endAngle);
  const end = polar(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
}
function normWord(s) {
  return (s || "").toLowerCase().replace(/[.,!?;:„"'’‚]/g, "");
}
function buildDiff(typed, correct) {
  const correctTokens = correct.trim().split(/\s+/);
  const typedTokens = typed.trim().split(/\s+/);
  return correctTokens.map((tok, i) => ({
    tok,
    ok: !!typedTokens[i] && normWord(typedTokens[i]) === normWord(tok),
  }));
}

export default function VocabApp() {
  const [data, setData] = useState(null); // { words, folders }
  const [mode, setMode] = useState("wheel");
  const [activeFolder, setActiveFolder] = useState("전체");
  const [dueQueue, setDueQueue] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [typedVal, setTypedVal] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [saveError, setSaveError] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) {
          setData(JSON.parse(res.value));
        } else {
          setData({ words: DEFAULT_WORDS, folders: [DEFAULT_FOLDER] });
        }
      } catch (e) {
        setData({ words: DEFAULT_WORDS, folders: [DEFAULT_FOLDER] });
      }
    })();
  }, []);

  useEffect(() => {
    if (data === null) return;
    (async () => {
      try {
        const r = await window.storage.set(STORAGE_KEY, JSON.stringify(data), false);
        setSaveError(!r);
      } catch (e) {
        setSaveError(true);
      }
    })();
  }, [data]);

  const words = data ? data.words : [];
  const folders = data ? data.folders : [DEFAULT_FOLDER];

  const scopedWords = useMemo(() => {
    if (activeFolder === "전체") return words;
    return words.filter((w) => w.folder === activeFolder);
  }, [words, activeFolder]);

  const dueWords = useMemo(() => {
    return scopedWords.filter((w) => w.nextReview <= Date.now()).sort((a, b) => a.nextReview - b.nextReview);
  }, [scopedWords]);

  const bucketCounts = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    scopedWords.forEach((w) => { counts[bucketIndex(w.interval)] += 1; });
    return counts;
  }, [scopedWords]);

  function enterSession(targetMode) {
    setDueQueue(dueWords.map((w) => w.id));
    setCursor(0);
    setFlipped(false);
    setTypedVal("");
    setFeedback(null);
    setMode(targetMode);
  }

  const currentWord = useMemo(() => {
    const id = dueQueue[cursor];
    return words.find((w) => w.id === id) || null;
  }, [words, dueQueue, cursor]);

  function updateWord(id, quality) {
    setData((prev) => ({
      ...prev,
      words: prev.words.map((w) => (w.id === id ? { ...w, ...sm2Update(w, quality) } : w)),
    }));
  }

  function nextCard() {
    setFlipped(false);
    setTypedVal("");
    setFeedback(null);
    setCursor((c) => c + 1);
    setTimeout(() => inputRef.current && inputRef.current.focus(), 30);
  }

  function handleFlashcardAnswer(quality) {
    if (!currentWord) return;
    updateWord(currentWord.id, quality);
    nextCard();
  }

  function checkTyping() {
    if (!currentWord || feedback) return;
    const hasSentence = !!(currentWord.example && currentWord.exampleKo);
    const answer = hasSentence ? currentWord.example : currentWord.de;
    const correct = normWord(typedVal.replace(/\s+/g, " ")) === normWord(answer.replace(/\s+/g, " "));
    setFeedback(correct ? "correct" : "wrong");
    updateWord(currentWord.id, correct ? 4 : 0);
  }

  function upsertWord(id, patch) {
    setData((prev) => ({ ...prev, words: prev.words.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
  }
  function addWord(entry) {
    setData((prev) => ({
      ...prev,
      words: [...prev.words, {
        id: makeId(), ef: 2.5, repetition: 0, interval: 0, nextReview: Date.now(), ...entry,
      }],
    }));
  }
  function deleteWord(id) {
    setData((prev) => ({ ...prev, words: prev.words.filter((w) => w.id !== id) }));
  }
  function resetAllProgress() {
    setData((prev) => ({
      ...prev,
      words: prev.words.map((w) => ({ ...w, ef: 2.5, repetition: 0, interval: 0, nextReview: Date.now() })),
    }));
  }
  function addFolder(name) {
    const n = name.trim();
    if (!n) return;
    setData((prev) => (prev.folders.includes(n) ? prev : { ...prev, folders: [...prev.folders, n] }));
  }
  function renameFolder(oldName, newName) {
    const n = newName.trim();
    if (!n || oldName === DEFAULT_FOLDER) return;
    setData((prev) => ({
      folders: prev.folders.map((f) => (f === oldName ? n : f)),
      words: prev.words.map((w) => (w.folder === oldName ? { ...w, folder: n } : w)),
    }));
    if (activeFolder === oldName) setActiveFolder(n);
  }
  function deleteFolder(name) {
    if (name === DEFAULT_FOLDER) return;
    setData((prev) => ({
      folders: prev.folders.filter((f) => f !== name),
      words: prev.words.map((w) => (w.folder === name ? { ...w, folder: DEFAULT_FOLDER } : w)),
    }));
    if (activeFolder === name) setActiveFolder("전체");
  }

  if (data === null) {
    return (
      <div className="vwrap"><style>{CSS}</style>
        <div className="loading">단어를 불러오는 중…</div>
      </div>
    );
  }

  const total = scopedWords.length;
  const dueCount = dueWords.length;

  return (
    <div className="vwrap">
      <style>{CSS}</style>

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">DE</span>
          <div className="brand-text">
            <h1>Wortrad</h1>
            <p>독일어 예문 학습 · SM-2 간격 반복</p>
          </div>
        </div>
        <div className="stat-pair">
          <div className="stat">
            <span className="stat-num">{total}</span>
            <span className="stat-lbl">{activeFolder === "전체" ? "전체 단어" : activeFolder}</span>
          </div>
          <div className="stat accent">
            <span className="stat-num">{dueCount}</span>
            <span className="stat-lbl">오늘 복습</span>
          </div>
        </div>
      </header>

      <div className="folder-row">
        <button className={activeFolder === "전체" ? "chip active" : "chip"} onClick={() => setActiveFolder("전체")}>전체</button>
        {folders.map((f) => (
          <button key={f} className={activeFolder === f ? "chip active" : "chip"} onClick={() => setActiveFolder(f)}>
            <Folder size={12} /> {f}
          </button>
        ))}
      </div>

      <nav className="tabs">
        <button className={mode === "wheel" ? "tab active" : "tab"} onClick={() => setMode("wheel")}>
          <Clock size={16} /> 복습 바퀴
        </button>
        <button className={mode === "flashcard" ? "tab active" : "tab"} onClick={() => enterSession("flashcard")}>
          <BookOpen size={16} /> 플래시카드
        </button>
        <button className={mode === "typing" ? "tab active" : "tab"} onClick={() => enterSession("typing")}>
          <TypeIcon size={16} /> 타이핑
        </button>
        <button className={mode === "manage" ? "tab active" : "tab"} onClick={() => setMode("manage")}>
          <Settings size={16} /> 단어 관리
        </button>
      </nav>

      <main className="stage">
        {mode === "wheel" && (
          <WheelView bucketCounts={bucketCounts} dueCount={dueCount} total={total} onStart={() => enterSession(dueCount ? "flashcard" : "wheel")} />
        )}

        {(mode === "flashcard" || mode === "typing") && (
          <SessionView
            mode={mode}
            queueLen={dueQueue.length}
            cursor={cursor}
            currentWord={currentWord}
            flipped={flipped}
            setFlipped={setFlipped}
            typedVal={typedVal}
            setTypedVal={setTypedVal}
            feedback={feedback}
            checkTyping={checkTyping}
            nextCard={nextCard}
            handleFlashcardAnswer={handleFlashcardAnswer}
            inputRef={inputRef}
            onBackToWheel={() => setMode("wheel")}
          />
        )}

        {mode === "manage" && (
          <ManageView
            words={scopedWords}
            folders={folders}
            activeFolder={activeFolder}
            addWord={addWord}
            deleteWord={deleteWord}
            upsertWord={upsertWord}
            resetAllProgress={resetAllProgress}
            addFolder={addFolder}
            renameFolder={renameFolder}
            deleteFolder={deleteFolder}
          />
        )}
      </main>

      {saveError && <div className="save-error">저장에 실패했어요. 진도가 유지되지 않을 수 있어요.</div>}
    </div>
  );
}

function WheelView({ bucketCounts, dueCount, total, onStart }) {
  const cx = 120, cy = 120, r = 96, rInner = 40;
  const segAngle = 360 / 5;
  return (
    <div className="wheel-view">
      <div className="wheel-box">
        <svg viewBox="0 0 240 240" className="wheel-svg">
          {bucketCounts.map((count, i) => {
            const start = i * segAngle;
            const end = start + segAngle - 3;
            return (
              <path key={i} d={arcPath(cx, cy, r, start, end)} fill={BUCKET_COLORS[i]} opacity={count === 0 ? 0.2 : 0.95} />
            );
          })}
          <circle cx={cx} cy={cy} r={rInner} fill="#141416" stroke="#EDEAE2" strokeWidth="2" />
          <text x={cx} y={cy - 6} textAnchor="middle" className="wheel-center-num">{total}</text>
          <text x={cx} y={cy + 14} textAnchor="middle" className="wheel-center-lbl">단어</text>
        </svg>
        <div className="wheel-labels">
          {BUCKET_LABELS.map((label, i) => (
            <div className="wheel-label" key={i}>
              <span className="dot" style={{ background: BUCKET_COLORS[i] }} />
              현재 간격 {label} <span className="wheel-count">{bucketCounts[i]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="wheel-side">
        <h2>오늘의 복습</h2>
        <p className="wheel-desc">
          SM-2 알고리즘이 답변 난이도에 따라 다음 복습 간격을 자동으로 계산해요. 쉽게 맞힐수록 간격이 크게 늘어나고, 틀리면 간격이 1일로 초기화돼요.
        </p>
        <div className="due-panel">
          <span className="due-num">{dueCount}</span>
          <span className="due-lbl">개 단어가 지금 복습 대상이에요</span>
        </div>
        <button className="btn-primary" onClick={onStart} disabled={dueCount === 0}>
          <Sparkles size={16} /> {dueCount === 0 ? "오늘 복습 완료!" : "복습 시작하기"}
        </button>
        {dueCount === 0 && <p className="empty-hint">모든 단어의 다음 복습일이 아직 안 됐어요. 내일 다시 오거나 단어 관리에서 새 단어를 추가해보세요.</p>}
      </div>
    </div>
  );
}

function SessionView(props) {
  const {
    mode, queueLen, cursor, currentWord, flipped, setFlipped,
    typedVal, setTypedVal, feedback, checkTyping, nextCard,
    handleFlashcardAnswer, inputRef, onBackToWheel,
  } = props;

  if (!currentWord) {
    return (
      <div className="session-done">
        <h2>오늘 복습을 모두 마쳤어요 🎉</h2>
        <p>내일 새로운 복습 카드가 준비될 거예요.</p>
        <button className="btn-secondary" onClick={onBackToWheel}>복습 바퀴로 돌아가기</button>
      </div>
    );
  }

  const progressPct = Math.round((cursor / queueLen) * 100);
  const hasSentence = !!(currentWord.example && currentWord.exampleKo);

  return (
    <div className="session">
      <div className="progress-row">
        <div className="progress-track"><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div>
        <span className="progress-txt">{cursor + 1} / {queueLen}</span>
      </div>

      {mode === "flashcard" && (
        <div className="card-area">
          <div className={flipped ? "flashcard flipped" : "flashcard"} onClick={() => setFlipped((f) => !f)}>
            <div className="flashcard-face front">
              <span className="card-eyebrow">간격 {currentWord.interval || 0}일 · EF {currentWord.ef.toFixed(1)}</span>
              <span className="card-word">{currentWord.de}</span>
              {currentWord.example && <span className="card-example">{currentWord.example}</span>}
              <span className="card-hint">탭해서 뜻 보기</span>
            </div>
            <div className="flashcard-face back">
              <span className="card-eyebrow">뜻</span>
              <span className="card-word">{currentWord.ko}</span>
              {currentWord.exampleKo && <span className="card-example">{currentWord.exampleKo}</span>}
            </div>
          </div>

          {flipped && (
            <div className="answer-row">
              <button className="btn-q q-again" onClick={() => handleFlashcardAnswer(0)}><X size={16} /> 다시</button>
              <button className="btn-q q-hard" onClick={() => handleFlashcardAnswer(3)}><Frown size={16} /> 어려워요</button>
              <button className="btn-q q-good" onClick={() => handleFlashcardAnswer(4)}><Check size={16} /> 알아요</button>
              <button className="btn-q q-easy" onClick={() => handleFlashcardAnswer(5)}><Star size={16} /> 쉬워요</button>
            </div>
          )}
        </div>
      )}

      {mode === "typing" && (
        <div className="card-area">
          <div className="typing-card">
            <span className="card-eyebrow">
              간격 {currentWord.interval || 0}일 · {hasSentence ? "이 문장을 독일어로 써보세요" : "이 뜻의 독일어 철자는?"}
            </span>
            <span className="card-word sentence-prompt">{hasSentence ? currentWord.exampleKo : currentWord.ko}</span>
            <input
              ref={inputRef}
              className={feedback === "wrong" ? "typing-input wrong" : feedback === "correct" ? "typing-input correct" : "typing-input"}
              value={typedVal}
              onChange={(e) => setTypedVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { feedback ? nextCard() : checkTyping(); } }}
              placeholder={hasSentence ? "독일어 문장을 입력하세요" : "여기에 입력하세요"}
              disabled={!!feedback}
              autoFocus
            />
            {feedback === "wrong" && hasSentence && (
              <p className="diff-line">
                {buildDiff(typedVal, currentWord.example).map((d, i) => (
                  <span key={i} className={d.ok ? "diff-ok" : "diff-bad"}>{d.tok} </span>
                ))}
              </p>
            )}
            {feedback === "wrong" && !hasSentence && (
              <p className="correct-answer">정답: <strong>{currentWord.de}</strong></p>
            )}
            {feedback === "correct" && <p className="correct-answer correct-txt">정확해요!</p>}
          </div>
          {!feedback ? (
            <button className="btn-primary" onClick={checkTyping}>확인</button>
          ) : (
            <button className="btn-primary" onClick={nextCard}>다음 단어</button>
          )}
        </div>
      )}
    </div>
  );
}

function emptyForm(folder) {
  return { de: "", ko: "", example: "", exampleKo: "", folder: folder || DEFAULT_FOLDER };
}

function ManageView({ words, folders, activeFolder, addWord, deleteWord, upsertWord, resetAllProgress, addFolder, renameFolder, deleteFolder }) {
  const defaultFolder = activeFolder === "전체" ? DEFAULT_FOLDER : activeFolder;
  const [form, setForm] = useState(emptyForm(defaultFolder));
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm());
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState(null);
  const [renameVal, setRenameVal] = useState("");

  function handleAdd() {
    if (!form.de.trim() || !form.ko.trim()) return;
    addWord({
      de: form.de.trim(), ko: form.ko.trim(),
      example: form.example.trim(), exampleKo: form.exampleKo.trim(),
      folder: form.folder || DEFAULT_FOLDER,
    });
    setForm(emptyForm(form.folder));
  }
  function startEdit(w) {
    setEditingId(w.id);
    setEditForm({ de: w.de, ko: w.ko, example: w.example || "", exampleKo: w.exampleKo || "", folder: w.folder || DEFAULT_FOLDER });
  }
  function saveEdit() {
    upsertWord(editingId, {
      de: editForm.de.trim(), ko: editForm.ko.trim(),
      example: editForm.example.trim(), exampleKo: editForm.exampleKo.trim(),
      folder: editForm.folder || DEFAULT_FOLDER,
    });
    setEditingId(null);
  }

  return (
    <div className="manage">
      <div className="folder-manager">
        <h3><FolderPlus size={15} /> 폴더 관리</h3>
        <div className="folder-add-row">
          <input placeholder="새 폴더 이름" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} />
          <button className="btn-secondary small" onClick={() => { addFolder(newFolderName); setNewFolderName(""); }}>추가</button>
        </div>
        <div className="folder-manage-list">
          {folders.map((f) => (
            <div className="folder-manage-item" key={f}>
              {renamingFolder === f ? (
                <>
                  <input value={renameVal} onChange={(e) => setRenameVal(e.target.value)} />
                  <button className="icon-btn" onClick={() => { renameFolder(f, renameVal); setRenamingFolder(null); }}><Check size={14} /></button>
                  <button className="icon-btn" onClick={() => setRenamingFolder(null)}><X size={14} /></button>
                </>
              ) : (
                <>
                  <span>{f}</span>
                  {f !== DEFAULT_FOLDER && (
                    <>
                      <button className="icon-btn" onClick={() => { setRenamingFolder(f); setRenameVal(f); }}><Pencil size={13} /></button>
                      <button className="icon-btn" onClick={() => deleteFolder(f)}><Trash2 size={13} /></button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="add-card">
        <h3>새 단어 추가</h3>
        <div className="form-grid">
          <input placeholder="독일어 단어" value={form.de} onChange={(e) => setForm({ ...form, de: e.target.value })} />
          <input placeholder="한국어 뜻" value={form.ko} onChange={(e) => setForm({ ...form, ko: e.target.value })} />
          <input className="wide" placeholder="예문 (독일어)" value={form.example} onChange={(e) => setForm({ ...form, example: e.target.value })} />
          <input className="wide" placeholder="예문 한국어 뜻" value={form.exampleKo} onChange={(e) => setForm({ ...form, exampleKo: e.target.value })} />
          <select className="wide" value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })}>
            {folders.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <button className="btn-primary small" onClick={handleAdd}><Plus size={16} /> 추가</button>
      </div>

      <div className="manage-list">
        {words.map((w) => (
          <div className="manage-item" key={w.id}>
            {editingId === w.id ? (
              <div className="edit-form">
                <div className="form-grid">
                  <input value={editForm.de} onChange={(e) => setEditForm({ ...editForm, de: e.target.value })} placeholder="독일어 단어" />
                  <input value={editForm.ko} onChange={(e) => setEditForm({ ...editForm, ko: e.target.value })} placeholder="한국어 뜻" />
                  <input className="wide" value={editForm.example} onChange={(e) => setEditForm({ ...editForm, example: e.target.value })} placeholder="예문 (독일어)" />
                  <input className="wide" value={editForm.exampleKo} onChange={(e) => setEditForm({ ...editForm, exampleKo: e.target.value })} placeholder="예문 한국어 뜻" />
                  <select className="wide" value={editForm.folder} onChange={(e) => setEditForm({ ...editForm, folder: e.target.value })}>
                    {folders.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className="edit-actions">
                  <button className="btn-secondary" onClick={() => setEditingId(null)}>취소</button>
                  <button className="btn-primary small" onClick={saveEdit}>저장</button>
                </div>
              </div>
            ) : (
              <>
                <div className="manage-word">
                  <div className="manage-word-top">
                    <strong>{w.de}</strong>
                    <span>{w.ko}</span>
                    <span className="folder-tag"><Folder size={10} /> {w.folder}</span>
                  </div>
                  {w.example && <p className="manage-example">{w.example}</p>}
                  {w.exampleKo && <p className="manage-example-ko">{w.exampleKo}</p>}
                </div>
                <div className="manage-meta">
                  <span className="meta-box">간격 {w.interval || 0}일 · EF {w.ef.toFixed(1)}</span>
                  <span className="meta-when">다음 복습: {fmtWhen(w.nextReview)}</span>
                  <button className="icon-btn" onClick={() => startEdit(w)}><Pencil size={15} /></button>
                  <button className="icon-btn" onClick={() => deleteWord(w.id)}><Trash2 size={15} /></button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <button className="btn-secondary danger" onClick={resetAllProgress}><RotateCcw size={16} /> 전체 진도 초기화</button>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap');

.vwrap {
  --bg: #0A0A0B;
  --surface: #17171A;
  --surface2: #1F1F23;
  --ink: #EDEAE2;
  --muted: #8B8880;
  --blue: #5B8DEF;
  --red: #E5534B;
  --yellow: #E8B23D;
  --green: #4CAF77;
  --purple: #9B7FD4;
  background: var(--bg);
  color: var(--ink);
  font-family: 'IBM Plex Sans', sans-serif;
  border-radius: 18px;
  padding: 24px;
  max-width: 660px;
  margin: 0 auto;
  box-sizing: border-box;
}
.vwrap * { box-sizing: border-box; }
.loading { padding: 60px 0; text-align: center; font-family: 'IBM Plex Mono', monospace; color: var(--muted); }

.topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; flex-wrap: wrap; gap: 12px; }
.brand { display: flex; align-items: center; gap: 12px; }
.brand-mark {
  font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 15px;
  background: var(--ink); color: var(--bg); padding: 8px 10px; border-radius: 8px; letter-spacing: 0.05em;
}
.brand-text h1 { font-family: 'Space Grotesk', sans-serif; font-size: 22px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.brand-text p { margin: 0; font-size: 12.5px; color: var(--muted); }

.stat-pair { display: flex; gap: 10px; }
.stat { display: flex; flex-direction: column; align-items: center; padding: 6px 14px; border-radius: 10px; background: var(--surface); min-width: 64px; }
.stat.accent { background: var(--blue); color: #0A0A0B; }
.stat-num { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 18px; }
.stat-lbl { font-size: 10.5px; letter-spacing: 0.02em; }

.folder-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
.chip {
  display: flex; align-items: center; gap: 5px; background: var(--surface); color: var(--muted); border: 1px solid var(--surface2);
  border-radius: 20px; padding: 6px 12px; font-size: 12.5px; cursor: pointer; font-family: 'IBM Plex Sans', sans-serif;
}
.chip.active { background: var(--ink); color: var(--bg); border-color: var(--ink); }

.tabs { display: flex; gap: 6px; margin-bottom: 20px; border-bottom: 2px solid var(--surface2); padding-bottom: 0; flex-wrap: wrap; }
.tab {
  display: flex; align-items: center; gap: 6px; font-family: 'IBM Plex Sans', sans-serif; font-weight: 500; font-size: 13.5px;
  background: transparent; border: none; padding: 9px 14px; cursor: pointer; color: var(--muted); border-radius: 8px 8px 0 0;
  transform: translateY(2px);
}
.tab:hover { color: var(--ink); }
.tab.active { color: var(--bg); background: var(--ink); }

.stage { min-height: 340px; }

.wheel-view { display: flex; gap: 28px; flex-wrap: wrap; align-items: center; justify-content: center; }
.wheel-box { display: flex; flex-direction: column; align-items: center; gap: 14px; }
.wheel-svg { width: 220px; height: 220px; }
.wheel-center-num { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 26px; fill: var(--ink); }
.wheel-center-lbl { font-family: 'IBM Plex Mono', monospace; font-size: 10px; fill: var(--muted); }
.wheel-labels { display: flex; flex-direction: column; gap: 4px; width: 100%; }
.wheel-label { display: flex; align-items: center; gap: 8px; font-size: 12px; font-family: 'IBM Plex Mono', monospace; color: var(--ink); }
.wheel-label .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.wheel-count { margin-left: auto; font-weight: 500; }

.wheel-side { max-width: 280px; }
.wheel-side h2 { font-family: 'Space Grotesk', sans-serif; font-size: 19px; margin: 0 0 8px; }
.wheel-desc { font-size: 13px; color: var(--muted); line-height: 1.55; margin: 0 0 16px; }
.due-panel { display: flex; align-items: baseline; gap: 8px; margin-bottom: 16px; }
.due-num { font-family: 'Space Grotesk', sans-serif; font-size: 34px; font-weight: 700; color: var(--red); }
.due-lbl { font-size: 12.5px; color: var(--muted); }
.empty-hint { font-size: 12px; color: var(--muted); margin-top: 10px; line-height: 1.5; }

.btn-primary {
  display: inline-flex; align-items: center; gap: 8px; font-family: 'IBM Plex Sans', sans-serif; font-weight: 600; font-size: 14px;
  background: var(--ink); color: var(--bg); border: none; padding: 12px 20px; border-radius: 10px; cursor: pointer;
}
.btn-primary:disabled { background: var(--muted); cursor: default; }
.btn-primary.small { padding: 9px 14px; font-size: 13px; }
.btn-primary:focus-visible, .btn-secondary:focus-visible, .tab:focus-visible, .icon-btn:focus-visible, .chip:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
.btn-secondary {
  display: inline-flex; align-items: center; gap: 8px; background: transparent; border: 1.5px solid var(--ink); color: var(--ink);
  font-weight: 500; font-size: 13.5px; padding: 10px 16px; border-radius: 10px; cursor: pointer; margin-top: 18px;
}
.btn-secondary.small { padding: 7px 12px; font-size: 12.5px; margin-top: 0; }
.btn-secondary.danger { border-color: var(--red); color: var(--red); }

.session { display: flex; flex-direction: column; align-items: center; gap: 22px; }
.progress-row { width: 100%; display: flex; align-items: center; gap: 10px; }
.progress-track { flex: 1; height: 6px; background: var(--surface2); border-radius: 4px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--blue); }
.progress-txt { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: var(--muted); white-space: nowrap; }

.card-area { display: flex; flex-direction: column; align-items: center; gap: 18px; width: 100%; }
.flashcard { width: 100%; max-width: 380px; height: 250px; position: relative; cursor: pointer; perspective: 1000px; }
.flashcard-face {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  border-radius: 16px; border: 1.5px solid var(--surface2); backface-visibility: hidden; transition: transform 0.45s ease; gap: 8px;
  padding: 16px;
}
.flashcard-face.front { background: var(--surface); transform: rotateY(0deg); }
.flashcard-face.back { background: var(--blue); color: #0A0A0B; transform: rotateY(180deg); }
.flashcard.flipped .front { transform: rotateY(180deg); }
.flashcard.flipped .back { transform: rotateY(360deg); }
.card-eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 0.06em; opacity: 0.7; }
.card-word { font-family: 'Space Grotesk', sans-serif; font-size: 28px; font-weight: 700; text-align: center; padding: 0 16px; }
.card-example { font-family: 'IBM Plex Sans', sans-serif; font-size: 13.5px; text-align: center; opacity: 0.85; font-style: italic; max-width: 300px; }
.card-hint { font-size: 11.5px; opacity: 0.55; }

.answer-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.btn-q {
  display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 13px; border-radius: 10px; padding: 10px 14px; cursor: pointer; border: none;
}
.q-again { background: #3A1E1C; color: var(--red); }
.q-hard { background: #3A311A; color: var(--yellow); }
.q-good { background: #1B3A29; color: var(--green); }
.q-easy { background: #2A1F3D; color: var(--purple); }

.typing-card {
  width: 100%; max-width: 420px; display: flex; flex-direction: column; align-items: center; gap: 12px;
  border: 1.5px solid var(--surface2); border-radius: 16px; padding: 28px 20px; background: var(--surface);
}
.sentence-prompt { font-size: 19px; line-height: 1.4; }
.typing-input {
  width: 100%; font-family: 'Space Grotesk', sans-serif; font-size: 17px; text-align: center; padding: 12px; border-radius: 10px;
  border: 2px solid var(--surface2); background: var(--bg); color: var(--ink);
}
.typing-input.wrong { border-color: var(--red); background: #241615; }
.typing-input.correct { border-color: var(--green); background: #142219; }
.correct-answer { font-size: 13.5px; margin: 0; }
.correct-answer.correct-txt { color: var(--green); font-weight: 600; }
.diff-line { font-family: 'Space Grotesk', sans-serif; font-size: 16px; margin: 0; text-align: center; line-height: 1.6; }
.diff-ok { color: var(--green); }
.diff-bad { color: var(--red); text-decoration: underline wavy; }

.session-done { text-align: center; padding: 50px 20px; }
.session-done h2 { font-family: 'Space Grotesk', sans-serif; font-size: 22px; }
.session-done p { color: var(--muted); font-size: 13.5px; }

.manage { display: flex; flex-direction: column; gap: 16px; }
.folder-manager { background: var(--surface); border-radius: 14px; padding: 16px; }
.folder-manager h3 { display: flex; align-items: center; gap: 6px; font-family: 'Space Grotesk', sans-serif; font-size: 14.5px; margin: 0 0 10px; }
.folder-add-row { display: flex; gap: 8px; margin-bottom: 10px; }
.folder-add-row input { flex: 1; }
.folder-manage-list { display: flex; flex-wrap: wrap; gap: 8px; }
.folder-manage-item { display: flex; align-items: center; gap: 4px; background: var(--surface2); border-radius: 8px; padding: 5px 8px; font-size: 12.5px; }
.folder-manage-item input { width: 90px; padding: 4px 6px; font-size: 12px; }

.add-card { background: var(--surface); border-radius: 14px; padding: 16px; }
.add-card h3 { font-family: 'Space Grotesk', sans-serif; font-size: 14.5px; margin: 0 0 10px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
.form-grid input.wide, .form-grid select.wide { grid-column: 1 / -1; }
.form-grid input, .form-grid select {
  padding: 10px 12px; border-radius: 8px; border: 1.5px solid var(--surface2); font-family: 'IBM Plex Sans', sans-serif; font-size: 13.5px;
  background: var(--bg); color: var(--ink);
}
.manage-list { display: flex; flex-direction: column; gap: 8px; max-height: 380px; overflow-y: auto; }
.manage-item { padding: 12px 14px; border-radius: 10px; background: var(--surface); display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.manage-word { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 180px; }
.manage-word-top { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.manage-word-top strong { font-family: 'Space Grotesk', sans-serif; font-size: 15px; }
.manage-word-top span { font-size: 12.5px; color: var(--muted); }
.folder-tag { display: flex; align-items: center; gap: 3px; font-size: 10.5px; background: var(--surface2); padding: 1px 7px; border-radius: 10px; }
.manage-example { margin: 2px 0 0; font-size: 12.5px; font-style: italic; color: var(--ink); }
.manage-example-ko { margin: 0; font-size: 11.5px; color: var(--muted); }
.manage-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.meta-box { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; border: 1.5px solid var(--surface2); border-radius: 20px; padding: 2px 8px; color: var(--blue); }
.meta-when { font-size: 11px; color: var(--muted); font-family: 'IBM Plex Mono', monospace; }
.icon-btn { background: none; border: none; cursor: pointer; color: var(--muted); padding: 4px; display: flex; }
.icon-btn:hover { color: var(--blue); }
.edit-form { width: 100%; }
.edit-actions { display: flex; justify-content: flex-end; gap: 8px; }
.edit-actions .btn-secondary { margin-top: 0; }

.save-error { margin-top: 14px; font-size: 12px; color: var(--red); text-align: center; }

@media (prefers-reduced-motion: reduce) {
  .flashcard-face { transition: none; }
}
`;
