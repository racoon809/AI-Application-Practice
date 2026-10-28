/* =====================================================================
 * 지식왕 도전 — 상식 퀴즈 게임 로직
 * 7주차 1단계: 4지선다 40문제, 즉시 피드백, 최종 점수·순위 기록
 * 8주차 2단계: 게임 모드 3종 (클래식 / 스피드 퀴즈 15초·힌트 감점 / 카테고리 도전)
 * 문제 데이터는 quiz-data.js 의 QUIZ_DATA 를 사용합니다.
 * ===================================================================== */
'use strict';

const CATEGORIES = ['한국사', '과학', '지리', '일반상식'];
const POINTS = { easy: 10, medium: 15, hard: 20 };
const DIFF_LABEL = { easy: '쉬움', medium: '보통', hard: '어려움' };
const SPEED_SECONDS = 15;
const SPEED_COUNT = 20;
const HINT_PENALTY = 5;
const RANK_KEY = 'quizGame.ranking.v1';
const NAME_KEY = 'quizGame.name';
const THEME_KEY = 'quizGame.theme';
const MARKS = ['①', '②', '③', '④'];

const MODES = {
  classic: { name: '클래식', desc: '4개 분야 40문제를 순서대로 풀어요.' },
  speed: { name: '스피드 퀴즈', desc: `무작위 ${SPEED_COUNT}문제 · 문제당 ${SPEED_SECONDS}초 · 남은 시간만큼 보너스 · 힌트는 -${HINT_PENALTY}점` },
  category: { name: '카테고리 도전', desc: '한 분야를 골라 10문제를 집중해서 풀어요.' }
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 환경 */ } }
};

// ---------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------
const game = {
  mode: 'classic',
  category: '한국사',
  player: '',
  questions: [],
  index: 0,
  score: 0,
  correct: 0,
  answered: false,
  hintUsed: false,
  timer: null,
  timeLeft: SPEED_SECONDS,
  log: [] // { id, category, correct, gained }
};

// ---------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showScreen(id) {
  $$('.screen').forEach((s) => (s.hidden = s.id !== id));
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------
// 시작 화면
// ---------------------------------------------------------------------
function initStart() {
  $('#playerName').value = store.get(NAME_KEY, '');
  $$('input[name="mode"]').forEach((r) =>
    r.addEventListener('change', () => {
      game.mode = r.value;
      $('#categoryPicker').hidden = game.mode !== 'category';
    })
  );
  $('#startForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#playerName').value.trim() || '익명';
    store.set(NAME_KEY, name);
    game.player = name;
    game.mode = ($('input[name="mode"]:checked') || {}).value || 'classic';
    game.category = $('#categorySelect').value;
    startGame();
  });
  renderRanking('#rankingStart');
  $('#totalCount').textContent = QUIZ_DATA.length;
}

// ---------------------------------------------------------------------
// 게임 진행
// ---------------------------------------------------------------------
function buildQuestions() {
  if (game.mode === 'speed') return shuffle(QUIZ_DATA).slice(0, SPEED_COUNT);
  if (game.mode === 'category') return QUIZ_DATA.filter((q) => q.category === game.category);
  // 클래식: 카테고리 순서대로 (한국사 → 과학 → 지리 → 일반상식)
  return CATEGORIES.flatMap((c) => QUIZ_DATA.filter((q) => q.category === c));
}

function startGame() {
  Object.assign(game, { questions: buildQuestions(), index: 0, score: 0, correct: 0, log: [] });
  $('#modeLabel').textContent =
    MODES[game.mode].name + (game.mode === 'category' ? ` · ${game.category}` : '');
  $('#timerWrap').hidden = game.mode !== 'speed';
  $('#hintBtn').hidden = game.mode !== 'speed';
  showScreen('quizScreen');
  showQuestion();
}

function showQuestion() {
  const q = game.questions[game.index];
  game.answered = false;
  game.hintUsed = false;

  $('#progressText').textContent = `${game.index + 1} / ${game.questions.length}`;
  $('#progressBar').style.width = `${(game.index / game.questions.length) * 100}%`;
  $('#scoreText').textContent = game.score;
  $('#qNumber').textContent = `${q.id}.`;
  $('#qCategory').textContent = q.category;
  $('#qDifficulty').textContent = `${DIFF_LABEL[q.difficulty]} · ${POINTS[q.difficulty]}점`;
  $('#qDifficulty').dataset.level = q.difficulty;
  $('#qText').textContent = q.question;
  $('#hintText').hidden = true;
  $('#hintText').textContent = '';
  $('#hintBtn').disabled = false;

  const box = $('#options');
  box.innerHTML = '';
  q.options.forEach((opt, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'option';
    b.dataset.index = i;
    b.innerHTML = `<span class="bubble" aria-hidden="true">${MARKS[i]}</span><span class="opt-text"></span>`;
    b.querySelector('.opt-text').textContent = opt;
    b.setAttribute('aria-label', `${i + 1}번 ${opt}`);
    b.addEventListener('click', () => choose(i));
    box.appendChild(b);
  });

  if (game.mode === 'speed') startTimer();
}

function startTimer() {
  clearInterval(game.timer);
  game.timeLeft = SPEED_SECONDS;
  updateTimer();
  game.timer = setInterval(() => {
    game.timeLeft -= 1;
    updateTimer();
    if (game.timeLeft <= 0) {
      clearInterval(game.timer);
      choose(-1); // 시간 초과 = 오답
    }
  }, 1000);
}

function updateTimer() {
  $('#timerText').textContent = `${game.timeLeft}초`;
  $('#timerBar').style.width = `${(game.timeLeft / SPEED_SECONDS) * 100}%`;
  $('#timerWrap').classList.toggle('urgent', game.timeLeft <= 5);
}

function useHint() {
  if (game.answered || game.hintUsed) return;
  const q = game.questions[game.index];
  game.hintUsed = true;
  game.score = Math.max(0, game.score - HINT_PENALTY);
  $('#scoreText').textContent = game.score;
  $('#hintText').textContent = `힌트 (-${HINT_PENALTY}점): ${q.hint}`;
  $('#hintText').hidden = false;
  $('#hintBtn').disabled = true;
}

function choose(i) {
  if (game.answered) return;
  game.answered = true;
  clearInterval(game.timer);

  const q = game.questions[game.index];
  const isCorrect = i === q.answer;
  let gained = 0;
  if (isCorrect) {
    gained = POINTS[q.difficulty] + (game.mode === 'speed' ? Math.max(0, game.timeLeft) : 0);
    game.score += gained;
    game.correct += 1;
  }
  game.log.push({ id: q.id, category: q.category, correct: isCorrect, gained });

  $$('#options .option').forEach((b) => {
    const idx = Number(b.dataset.index);
    b.disabled = true;
    if (idx === q.answer) b.classList.add('correct');
    else if (idx === i) b.classList.add('wrong');
  });
  $('#scoreText').textContent = game.score;
  openFeedback(isCorrect, i === -1, q, gained);
}

function openFeedback(isCorrect, timeout, q, gained) {
  const dlg = $('#feedback');
  dlg.dataset.result = isCorrect ? 'correct' : 'wrong';
  $('#fbMark').textContent = isCorrect ? '○' : '✕';
  $('#fbTitle').textContent = isCorrect ? `정답입니다! +${gained}점` : timeout ? '시간 초과!' : '틀렸습니다';
  $('#fbAnswer').textContent = `정답: ${MARKS[q.answer]} ${q.options[q.answer]}`;
  $('#fbExplain').textContent = q.explanation;
  $('#fbNext').textContent = game.index + 1 < game.questions.length ? '다음 문제' : '결과 보기';
  dlg.showModal();
  $('#fbNext').focus();
}

function next() {
  $('#feedback').close();
  game.index += 1;
  if (game.index < game.questions.length) showQuestion();
  else finish();
}

// ---------------------------------------------------------------------
// 결과 · 순위
// ---------------------------------------------------------------------
function finish() {
  $('#progressBar').style.width = '100%';
  const total = game.questions.length;
  const acc = Math.round((game.correct / total) * 100);
  const entry = {
    name: game.player,
    mode: game.mode,
    category: game.mode === 'category' ? game.category : '',
    score: game.score,
    correct: game.correct,
    total,
    date: new Date().toISOString()
  };
  const ranking = store.get(RANK_KEY, []);
  ranking.push(entry);
  ranking.sort((a, b) => b.score - a.score || b.correct / b.total - a.correct / a.total);
  const top = ranking.slice(0, 10);
  store.set(RANK_KEY, top);
  const place = top.indexOf(entry) + 1;

  $('#resultScore').textContent = game.score;
  $('#resultDetail').textContent = `${total}문제 중 ${game.correct}문제 정답 · 정답률 ${acc}%`;
  $('#resultMode').textContent =
    MODES[game.mode].name + (game.mode === 'category' ? ` · ${game.category}` : '');
  $('#resultRank').textContent = place ? `명예의 전당 ${place}위에 올랐어요!` : '아쉽게 TOP 10에 들지 못했어요. 다시 도전해 보세요!';
  $('#resultTitle').textContent = acc >= 90 ? '지식왕 등극!' : acc >= 70 ? '상식 고수' : acc >= 50 ? '조금만 더!' : '다시 도전!';

  const tbody = $('#breakdown');
  tbody.innerHTML = '';
  CATEGORIES.forEach((c) => {
    const rows = game.log.filter((l) => l.category === c);
    if (!rows.length) return;
    const ok = rows.filter((l) => l.correct).length;
    const tr = document.createElement('tr');
    tr.innerHTML = `<th scope="row">${c}</th><td>${ok} / ${rows.length}</td><td><div class="mini"><i style="width:${(ok / rows.length) * 100}%"></i></div></td>`;
    tbody.appendChild(tr);
  });

  renderRanking('#rankingResult', entry);
  showScreen('resultScreen');
}

function renderRanking(sel, highlight) {
  const list = store.get(RANK_KEY, []);
  const el = $(sel);
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<tr><td colspan="4" class="empty">아직 기록이 없어요. 첫 기록의 주인공이 되어 보세요!</td></tr>';
    return;
  }
  el.innerHTML = '';
  list.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (highlight && r.date === highlight.date && r.name === highlight.name) tr.className = 'me';
    const mode = MODES[r.mode] ? MODES[r.mode].name : r.mode;
    // 저장된 기록(localStorage)은 사용자가 바꿀 수 있으므로 HTML로 해석하지 않고 글자로만 넣음
    const cells = [String(i + 1), r.name, mode + (r.category ? ' · ' + r.category : ''), String(r.score)];
    const classes = ['', 'name', '', 'num'];
    cells.forEach((text, c) => {
      const td = document.createElement('td');
      if (classes[c]) td.className = classes[c];
      td.textContent = text;
      tr.appendChild(td);
    });
    el.appendChild(tr);
  });
}

// ---------------------------------------------------------------------
// 테마 · 이벤트
// ---------------------------------------------------------------------
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
function syncThemeBtn() {
  $('#themeBtn').textContent = isDark() ? '라이트 모드' : '다크 모드';
}

function init() {
  const saved = store.get(THEME_KEY, null);
  if (saved) document.documentElement.dataset.theme = saved;
  syncThemeBtn();
  $('#themeBtn').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set(THEME_KEY, next);
    syncThemeBtn();
  });

  initStart();
  $('#hintBtn').addEventListener('click', useHint);
  $('#fbNext').addEventListener('click', next);
  $('#feedback').addEventListener('cancel', (e) => { e.preventDefault(); next(); });
  $('#quitBtn').addEventListener('click', () => { clearInterval(game.timer); showScreen('startScreen'); renderRanking('#rankingStart'); });
  $('#retryBtn').addEventListener('click', startGame);
  $('#homeBtn').addEventListener('click', () => { showScreen('startScreen'); renderRanking('#rankingStart'); });
  $('#resetRanking').addEventListener('click', () => {
    const btn = $('#resetRanking');
    if (btn.dataset.confirm !== 'yes') {
      btn.dataset.confirm = 'yes';
      btn.textContent = '한 번 더 누르면 삭제';
      setTimeout(() => { btn.dataset.confirm = ''; btn.textContent = '기록 초기화'; }, 3000);
      return;
    }
    store.set(RANK_KEY, []);
    btn.dataset.confirm = '';
    btn.textContent = '기록 초기화';
    renderRanking('#rankingStart');
  });

  // 키보드: 1~4 보기 선택, H 힌트
  document.addEventListener('keydown', (e) => {
    if ($('#quizScreen').hidden || $('#feedback').open) return;
    if (['1', '2', '3', '4'].includes(e.key)) choose(Number(e.key) - 1);
    if ((e.key === 'h' || e.key === 'H') && game.mode === 'speed') useHint();
  });

  showScreen('startScreen');
}

document.addEventListener('DOMContentLoaded', init);
