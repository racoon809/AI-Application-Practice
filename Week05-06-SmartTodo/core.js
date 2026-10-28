/* =====================================================================
 * File    : Week05-06-SmartTodo/core.js
 * Purpose : 5·6주차 할 일 앱의 공통 로직 (두 레이아웃이 함께 사용)
 *   - 기본 기능: CRUD · 카테고리 · 진행률 · 다크 모드 · 정렬 · 격언 · JSON 입출력
 *   - ★ 5주차: 키워드 기반 자동 카테고리 분류 시스템 (아래 [5주차] 블록)
 *
 * 레이아웃별 차이는 각 주차 폴더의 ui.js 가 담당합니다.
 *   week05/ui.js  모바일 중심 화면 — 진행률 막대
 *   week06/ui.js  데스크톱 사이드바 화면 — 진행률 링 · 목록 제목
 * ui.js 는 window.TodoLayout 에 훅 함수를 등록하고, 이 파일은 렌더링할 때
 * 그 훅을 호출합니다. 화면에 없는 요소는 자동으로 건너뜁니다.
 *
 * 불러오는 순서 (index.html):  <script src="../core.js"> → <script src="ui.js">
 * Node 테스트: tests/core.test.js 가 분류 로직을 require 해서 검증합니다.
 * ===================================================================== */

'use strict';

/** 레이아웃 훅 (ui.js 가 window.TodoLayout 으로 등록). 없으면 아무것도 하지 않음 */
function layoutHook(name, ...args) {
  const layout = typeof window !== 'undefined' ? window.TodoLayout : null;
  if (layout && typeof layout[name] === 'function') layout[name](...args);
}

// ---------------------------------------------------------------------
// 0. 상수 & 저장소
// ---------------------------------------------------------------------
const STORAGE_KEY = 'todoApp.todos.v1';
const SETTINGS_KEY = 'todoApp.settings.v1';
const THEME_KEY = 'todoApp.theme';
const CATEGORIES = ['업무', '개인', '공부'];

const storage = {
  load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('저장 실패:', e);
    }
  }
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// =====================================================================
// [5주차] 키워드 기반 자동 카테고리 분류 시스템
//  - 할 일 문장에 들어 있는 키워드를 카테고리별 사전과 비교해 점수를 매기고
//  - 가장 높은 점수의 카테고리를 추천합니다. (동점이면 추천하지 않음)
//  - 예) '회의', '개발'  → 업무 / '집', '운동', '영화' → 개인 / '시험', '과제' → 공부
// =====================================================================
const DEFAULT_KEYWORDS = {
  업무: [
    '회의', '미팅', '보고서', '보고', '개발', '코딩', '배포', '회사', '출근', '퇴근', '업무',
    '프로젝트', '기획', '메일', '이메일', '스케줄', '거래처', '고객', '클라이언트', '결재',
    '발표자료', '견적', '계약', '버그', '서버', '코드 리뷰', '리뷰', '야근', '팀장', '상사', '동료', '인터뷰'
  ],
  개인: [
    '집', '운동', '헬스', '요가', '산책', '러닝', '장보기', '마트', '청소', '빨래', '설거지',
    '영화', '친구', '가족', '부모님', '엄마', '아빠', '병원', '치과', '약속', '쇼핑', '여행',
    '요리', '게임', '생일', '은행', '택배', '미용실', '데이트', '카페', '휴식', '취미'
  ],
  공부: [
    '공부', '시험', '과제', '강의', '수업', '복습', '예습', '독서', '책', '토익', '토플',
    '자격증', '레포트', '리포트', '논문', '인강', '문제집', '단어', '퀴즈', '중간고사', '기말고사',
    '스터디', '알고리즘', '백준', '프로그래머스', '실습', '학습'
  ]
};

/** 기본 사전 + 사용자가 추가한 키워드를 합친 사전 */
function getKeywordDictionary() {
  const dict = {};
  CATEGORIES.forEach((cat) => {
    const custom = (settings.customKeywords && settings.customKeywords[cat]) || [];
    dict[cat] = [...new Set([...DEFAULT_KEYWORDS[cat], ...custom])];
  });
  return dict;
}

/**
 * 스마트 키워드 분석
 * @param {string} text 할 일 문장
 * @returns {{category: string|null, scores: object, matched: object}}
 */
function analyzeText(text) {
  const normalized = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  const dict = getKeywordDictionary();
  const scores = {};
  const matched = {};

  CATEGORIES.forEach((cat) => {
    scores[cat] = 0;
    matched[cat] = [];
    dict[cat].forEach((kw) => {
      const k = kw.toLowerCase();
      if (k && normalized.includes(k)) {
        // 긴 키워드일수록 의미가 분명하므로 가중치를 조금 더 줌
        scores[cat] += k.length >= 3 ? 1.5 : 1;
        matched[cat].push(kw);
      }
    });
  });

  const ranked = [...CATEGORIES].sort((a, b) => scores[b] - scores[a]);
  const top = ranked[0];
  const second = ranked[1];
  const category = scores[top] > 0 && scores[top] !== scores[second] ? top : null;
  return { category, scores, matched };
}

/** 추가 직전 호출: 선택한 카테고리와 추천이 다르면 확인 창(또는 자동 적용) */
function resolveCategory(text, selected) {
  return new Promise((resolve) => {
    if (!settings.autoClassify) return resolve({ category: selected, auto: false });
    const { category, matched } = analyzeText(text);
    if (!category || category === selected) return resolve({ category: selected, auto: false });

    if (settings.mode === 'auto') {
      toast(`'${text}' → ${category} (으)로 자동 분류했어요`);
      return resolve({ category, auto: true });
    }
    openSuggestDialog({ text, selected, suggested: category, keywords: matched[category] }, resolve);
  });
}

/** 기존 할 일 전체를 다시 분석해 바뀔 항목 목록을 돌려줌 */
function findReclassifyCandidates() {
  return todos
    .map((t) => ({ todo: t, result: analyzeText(t.text) }))
    .filter(({ todo, result }) => result.category && result.category !== todo.category);
}
// ======================= [5주차] 분류 시스템 끝 =======================

// ---------------------------------------------------------------------
// 1. 상태
// ---------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  autoClassify: true,          // 자동 분류 사용
  mode: 'confirm',             // 'confirm' = 추천 후 확인, 'auto' = 바로 적용
  customKeywords: { 업무: [], 개인: [], 공부: [] }
};

let settings = { ...DEFAULT_SETTINGS, ...storage.load(SETTINGS_KEY, {}) };
let todos = storage.load(STORAGE_KEY, null) || sampleTodos();
let currentFilter = 'all';
let searchQuery = '';
let sortMode = 'newest';
let editingId = null;

function sampleTodos() {
  const now = Date.now();
  return [
    { id: now - 4, text: '혼공 바이브 코딩 4장 끝내기', category: '공부', done: true, createdAt: now - 400000 },
    { id: now - 3, text: '내일 회사 스케줄 확인', category: '업무', done: false, createdAt: now - 300000 },
    { id: now - 2, text: '저녁에 운동하기', category: '개인', done: false, createdAt: now - 200000 },
    { id: now - 1, text: '팀 회의 자료 정리', category: '업무', done: false, createdAt: now - 100000 }
  ];
}

function persist() {
  storage.save(STORAGE_KEY, todos);
  render();
}

// ---------------------------------------------------------------------
// 2. CRUD
// ---------------------------------------------------------------------
async function addTodo(text, selectedCategory) {
  const clean = text.trim();
  if (!clean) {
    toast('할 일을 입력해 주세요');
    return;
  }
  const { category, auto } = await resolveCategory(clean, selectedCategory);
  todos.unshift({
    id: Date.now(),
    text: clean,
    category,
    done: false,
    createdAt: Date.now(),
    autoClassified: auto
  });
  persist();
}

function toggleTodo(id) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  t.completedAt = t.done ? Date.now() : null;
  persist();
}

function deleteTodo(id) {
  todos = todos.filter((x) => x.id !== id);
  persist();
}

function updateTodo(id, text) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;
  const clean = text.trim();
  if (clean) t.text = clean;
  editingId = null;
  persist();
}

function clearCompleted() {
  const n = todos.filter((t) => t.done).length;
  if (!n) return toast('삭제할 완료 항목이 없어요');
  todos = todos.filter((t) => !t.done);
  persist();
  toast(`완료 항목 ${n}개를 삭제했어요`);
}

// ---------------------------------------------------------------------
// 3. 렌더링
// ---------------------------------------------------------------------
function visibleTodos() {
  let list = todos.slice();
  if (CATEGORIES.includes(currentFilter)) list = list.filter((t) => t.category === currentFilter);
  if (currentFilter === 'active') list = list.filter((t) => !t.done);
  if (currentFilter === 'done') list = list.filter((t) => t.done);
  if (searchQuery) list = list.filter((t) => t.text.toLowerCase().includes(searchQuery.toLowerCase()));

  const byCat = (t) => CATEGORIES.indexOf(t.category);
  const sorters = {
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    category: (a, b) => byCat(a) - byCat(b) || b.createdAt - a.createdAt,
    activeFirst: (a, b) => Number(a.done) - Number(b.done) || b.createdAt - a.createdAt,
    alpha: (a, b) => a.text.localeCompare(b.text, 'ko')
  };
  return list.sort(sorters[sortMode] || sorters.newest);
}

function render() {
  renderList();
  renderDashboard();
  renderFilters();
}

function renderList() {
  const ul = $('#todoList');
  if (!ul) return;
  const list = visibleTodos();
  ul.innerHTML = '';

  list.forEach((t) => {
    const li = document.createElement('li');
    li.className = 'todo-item' + (t.done ? ' done' : '');
    li.dataset.id = t.id;
    li.dataset.category = t.category;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.done;
    cb.id = 'chk-' + t.id;
    cb.setAttribute('aria-label', `${t.text} 완료 표시`);
    cb.addEventListener('change', () => toggleTodo(t.id));

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.dataset.category = t.category;
    badge.textContent = t.category + (t.autoClassified ? ' · 자동' : '');

    let body;
    if (editingId === t.id) {
      body = document.createElement('input');
      body.className = 'edit-input';
      body.value = t.text;
      body.setAttribute('aria-label', '할 일 수정');
      body.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') updateTodo(t.id, body.value);
        if (e.key === 'Escape') { editingId = null; render(); }
      });
      body.addEventListener('blur', () => updateTodo(t.id, body.value));
      setTimeout(() => { body.focus(); body.select(); }, 0);
    } else {
      body = document.createElement('span');
      body.className = 'todo-text';
      body.textContent = t.text;
      body.title = '더블 클릭해서 수정';
      body.addEventListener('dblclick', () => { editingId = t.id; render(); });
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete-btn';
    del.textContent = '✕';
    del.setAttribute('aria-label', `${t.text} 삭제`);
    del.addEventListener('click', () => deleteTodo(t.id));

    li.append(cb, badge, body, del);
    ul.appendChild(li);
  });

  const empty = $('#emptyState');
  if (empty) {
    empty.hidden = list.length > 0;
    empty.textContent = todos.length ? '조건에 맞는 할 일이 없어요.' : '첫 할 일을 추가해 보세요!';
  }
}

function renderDashboard() {
  const total = todos.length;
  const done = todos.filter((t) => t.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  setText('#overallPercent', pct + '%');
  setText('#overallText', `${done} / ${total}개 완료`);
  layoutHook('renderOverall', pct, done, total);   // 막대(5주차) / 링(6주차)

  CATEGORIES.forEach((cat) => {
    const items = todos.filter((t) => t.category === cat);
    const d = items.filter((t) => t.done).length;
    const p = items.length ? Math.round((d / items.length) * 100) : 0;
    $$(`[data-progress="${cat}"]`).forEach((el) => (el.style.width = p + '%'));
    $$(`[data-progress-text="${cat}"]`).forEach((el) => (el.textContent = `${d}/${items.length} · ${p}%`));
    $$(`[data-count="${cat}"]`).forEach((el) => (el.textContent = items.filter((t) => !t.done).length));
  });
  $$('[data-count="all"]').forEach((el) => (el.textContent = todos.filter((t) => !t.done).length));
  $$('[data-count="done"]').forEach((el) => (el.textContent = done));
}

function renderFilters() {
  $$('.filter-btn').forEach((b) => {
    const on = b.dataset.filter === currentFilter;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  layoutHook('renderFilterTitle', currentFilter);   // 6주차만 목록 제목 표시
}

function setText(sel, text) {
  const el = $(sel);
  if (el) el.textContent = text;
}

// ---------------------------------------------------------------------
// 4. [5주차] 분류 UI — 실시간 힌트 · 추천 확인 창 · 자동 재분류 · 분류 설정
// ---------------------------------------------------------------------
function updateSmartHint() {
  const hint = $('#smartHint');
  const input = $('#todoInput');
  if (!hint || !input) return;
  const text = input.value.trim();
  if (!text || !settings.autoClassify) { hint.textContent = ''; hint.dataset.category = ''; return; }
  const { category, matched } = analyzeText(text);
  if (category) {
    hint.dataset.category = category;
    hint.textContent = `스마트 키워드 분석: ${category} 추천 (키워드: ${matched[category].join(', ')})`;
  } else {
    hint.dataset.category = '';
    hint.textContent = '스마트 키워드 분석: 일치하는 키워드가 없어 선택한 카테고리로 저장돼요';
  }
}

let suggestResolver = null;
let suggestPayload = null;

function openSuggestDialog(payload, resolve) {
  const dlg = $('#suggestDialog');
  suggestPayload = payload;
  suggestResolver = resolve;
  if (!dlg) return resolve({ category: payload.suggested, auto: true });
  setText('#suggestText', `'${payload.text}'은(는) '${payload.suggested}' 카테고리로 보여요.`);
  setText('#suggestReason', `감지된 키워드: ${payload.keywords.join(', ')} · 현재 선택: ${payload.selected}`);
  setText('#applySuggest', `${payload.suggested}(으)로 등록`);
  setText('#keepOriginal', `${payload.selected} 그대로 등록`);
  dlg.showModal();
}

function closeSuggestDialog(useSuggestion) {
  const dlg = $('#suggestDialog');
  if (dlg && dlg.open) dlg.close();
  if (!suggestResolver) return;
  const p = suggestPayload;
  suggestResolver(useSuggestion ? { category: p.suggested, auto: true } : { category: p.selected, auto: false });
  suggestResolver = null;
  suggestPayload = null;
}

function openReclassifyDialog() {
  const candidates = findReclassifyCandidates();
  if (!candidates.length) return toast('다시 분류할 항목이 없어요. 모두 알맞게 분류되어 있어요!');
  const dlg = $('#reclassifyDialog');
  const list = $('#reclassifyList');
  list.innerHTML = '';
  candidates.forEach(({ todo, result }) => {
    const li = document.createElement('li');
    const id = 'rc-' + todo.id;
    li.innerHTML = `<input type="checkbox" id="${id}" checked data-id="${todo.id}" data-to="${result.category}">
      <label for="${id}"><b></b><span class="arrow"></span></label>`;
    li.querySelector('b').textContent = todo.text;
    li.querySelector('.arrow').textContent = `${todo.category} → ${result.category}`;
    list.appendChild(li);
  });
  dlg.showModal();
}

function applyReclassify() {
  let n = 0;
  $$('#reclassifyList input:checked').forEach((cb) => {
    const t = todos.find((x) => x.id === Number(cb.dataset.id));
    if (t) { t.category = cb.dataset.to; t.autoClassified = true; n++; }
  });
  $('#reclassifyDialog').close();
  persist();
  toast(`${n}개 항목을 다시 분류했어요`);
}

function openSettingsDialog() {
  const dlg = $('#settingsDialog');
  $('#autoToggle').checked = settings.autoClassify;
  $$('input[name="classifyMode"]').forEach((r) => (r.checked = r.value === settings.mode));
  CATEGORIES.forEach((cat) => {
    const input = $(`[data-keywords="${cat}"]`);
    if (input) input.value = (settings.customKeywords[cat] || []).join(', ');
    const def = $(`[data-default-keywords="${cat}"]`);
    if (def) def.textContent = DEFAULT_KEYWORDS[cat].slice(0, 10).join(', ') + ' …';
  });
  dlg.showModal();
}

function saveSettings() {
  settings.autoClassify = $('#autoToggle').checked;
  const mode = $('input[name="classifyMode"]:checked');
  settings.mode = mode ? mode.value : 'confirm';
  CATEGORIES.forEach((cat) => {
    const input = $(`[data-keywords="${cat}"]`);
    settings.customKeywords[cat] = input
      ? input.value.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
  });
  storage.save(SETTINGS_KEY, settings);
  $('#settingsDialog').close();
  updateSmartHint();
  syncAutoBadge();
  toast('분류 설정을 저장했어요');
}

function syncAutoBadge() {
  const b = $('#autoStatus');
  if (b) b.textContent = settings.autoClassify ? (settings.mode === 'auto' ? '자동 분류: 바로 적용' : '자동 분류: 확인 후 적용') : '자동 분류: 꺼짐';
}

// ---------------------------------------------------------------------
// 5. 다크 모드 · 격언 · 내보내기/가져오기 · 토스트
// ---------------------------------------------------------------------
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  storage.save(THEME_KEY, theme);
  const btn = $('#themeToggle');
  if (btn) {
    btn.textContent = theme === 'dark' ? '☀️ 라이트 모드' : '🌙 다크 모드';
    btn.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}
function toggleTheme() {
  applyTheme(isDark() ? 'light' : 'dark');
}

const QUOTES = [
  ['천 리 길도 한 걸음부터.', '속담'],
  ['시작이 반이다.', '속담'],
  ['오늘 할 수 있는 일을 내일로 미루지 마라.', '벤저민 프랭클린'],
  ['작은 일도 무시하지 말고 꾸준히 하라.', '속담'],
  ['계획 없는 목표는 소원에 불과하다.', '앙투안 드 생텍쥐페리(으로 알려짐)'],
  ['완벽함보다 완성이 낫다.', '개발자 격언']
];
function showQuote() {
  const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  setText('#quote', `“${q[0]}”`);
  setText('#quoteAuthor', `— ${q[1]}`);
}

function exportJSON() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), todos, settings }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `todos-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  toast('JSON 파일로 내보냈어요 (다운로드 폴더 확인)');
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const list = Array.isArray(data) ? data : data.todos;
      if (!Array.isArray(list)) throw new Error('todos 배열이 없습니다');
      todos = list
        .filter((t) => t && typeof t.text === 'string')
        .map((t, i) => ({
          id: t.id || Date.now() + i,
          text: t.text,
          category: CATEGORIES.includes(t.category) ? t.category : '개인',
          done: Boolean(t.done),
          createdAt: t.createdAt || Date.now(),
          autoClassified: Boolean(t.autoClassified)
        }));
      if (data.settings) { settings = { ...DEFAULT_SETTINGS, ...data.settings }; storage.save(SETTINGS_KEY, settings); syncAutoBadge(); }
      persist();
      toast(`${todos.length}개 항목을 불러왔어요`);
    } catch (e) {
      toast('불러오기 실패: 올바른 JSON 파일인지 확인해 주세요');
    }
  };
  reader.readAsText(file);
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  if (!el) return console.log(msg);
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

// ---------------------------------------------------------------------
// 6. 이벤트 연결
// ---------------------------------------------------------------------
function bind(sel, evt, fn) {
  const el = $(sel);
  if (el) el.addEventListener(evt, fn);
}

function init() {
  applyTheme(storage.load(THEME_KEY, null) || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  showQuote();
  syncAutoBadge();

  bind('#todoForm', 'submit', (e) => {
    e.preventDefault();
    const input = $('#todoInput');
    const cat = $('#categorySelect') ? $('#categorySelect').value : '개인';
    addTodo(input.value, cat).then(() => {
      input.value = '';
      updateSmartHint();
      input.focus();
    });
  });
  bind('#todoInput', 'input', updateSmartHint);

  $$('.filter-btn').forEach((b) =>
    b.addEventListener('click', () => { currentFilter = b.dataset.filter; render(); })
  );
  bind('#searchInput', 'input', (e) => { searchQuery = e.target.value.trim(); renderList(); });
  bind('#sortSelect', 'change', (e) => { sortMode = e.target.value; renderList(); });
  bind('#themeToggle', 'click', toggleTheme);
  bind('#clearCompleted', 'click', clearCompleted);
  bind('#exportBtn', 'click', exportJSON);
  bind('#importBtn', 'click', () => $('#importFile').click());
  bind('#importFile', 'change', (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ''; });
  bind('#newQuote', 'click', showQuote);

  // [5주차] 분류 UI
  bind('#applySuggest', 'click', () => closeSuggestDialog(true));
  bind('#keepOriginal', 'click', () => closeSuggestDialog(false));
  bind('#suggestDialog', 'cancel', (e) => { e.preventDefault(); closeSuggestDialog(false); });
  bind('#reclassifyBtn', 'click', openReclassifyDialog);
  bind('#applyReclassify', 'click', applyReclassify);
  bind('#cancelReclassify', 'click', () => $('#reclassifyDialog').close());
  bind('#settingsBtn', 'click', openSettingsDialog);
  bind('#saveSettings', 'click', saveSettings);
  bind('#cancelSettings', 'click', () => $('#settingsDialog').close());

  // 단축키: '/' 입력창 포커스 · Alt+D 다크 모드 · Alt+1~3 카테고리 필터 · Alt+0 전체
  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); $('#todoInput').focus(); }
    if (e.altKey && (e.key === 'd' || e.key === 'D' || e.code === 'KeyD')) { e.preventDefault(); toggleTheme(); }
    if (e.altKey && /^Digit[0-3]$/.test(e.code)) {
      e.preventDefault();
      const n = Number(e.code.slice(-1));
      currentFilter = n === 0 ? 'all' : CATEGORIES[n - 1];
      render();
    }
  });

  layoutHook('init');
  render();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}

// Node(테스트)에서는 DOM 없이 분류 로직만 꺼내 쓸 수 있게 내보냄
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CATEGORIES, DEFAULT_KEYWORDS, DEFAULT_SETTINGS,
    analyzeText, getKeywordDictionary, visibleTodos,
    setSettings(next) { settings = { ...DEFAULT_SETTINGS, ...next }; },
    setTodos(next) { todos = next; },
    setView(view) {
      if ('filter' in view) currentFilter = view.filter;
      if ('search' in view) searchQuery = view.search;
      if ('sort' in view) sortMode = view.sort;
    },
    findReclassifyCandidates
  };
}
