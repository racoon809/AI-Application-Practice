/*
  File    : script.js
  Created : 2026-10-01 13:49 (KST, UTC+09:00)
  Updated : 2026-10-01 14:02 (KST, UTC+09:00) - composer reset (button, Esc in the whole
            form, Alt+N), fresh form + input focus on every load (re-reset
            after load against autofill), no saved category
  Updated : 2026-10-02 10:41 (KST, UTC+09:00) - TaskStore.load() wipes saved tasks
            on every load (clean start, 0 tasks); TodoApp.evaluateApp() console
            self-check, also exposed as window.evaluateApp()
  Updated : 2026-10-02 11:18 (KST, UTC+09:00) - TaskStore.load() restores saved tasks;
            sorted('category'); startEdit() + saveEdit() edit text, category and
            priority; evaluateApp() checks reload persistence from a start-up snapshot
  Updated : 2026-10-02 11:41 (KST, UTC+09:00) - DATE_FORMATS: Intl formatters created
            once (rendering 150+ tasks no longer rebuilds them per item)
  Purpose : Class-based logic of the "My Tasks" todo app.
            - SafeStorage   : localStorage wrapper that never throws
            - TaskStore     : task data, CRUD, sorting, validation, persistence
            - ToastManager  : bottom toast notifications (with undo action)
            - ConfirmDialog : accessible confirm modal (Promise based)
            - TodoApp       : rendering, events, shortcuts, theme, DnD, import/export
  Notes   : Plain script (no ES module import) so index.html also works when it
            is opened directly from the file system (file://). User text is only
            ever written with textContent / value, never innerHTML (XSS safe).
*/
(function () {
  'use strict';

  /* ============================== Constants ============================== */

  const APP_VERSION = '1.0.0';
  const MAX_TEXT_LENGTH = 100;
  const MAX_TASKS = 1000;
  const MAX_IMPORT_BYTES = 1024 * 1024; // 1 MB

  const STORAGE_KEYS = {
    tasks: 'myTasks.tasks',
    settings: 'myTasks.settings',
    backup: 'myTasks.backup'
  };

  const CATEGORIES = {
    work: { label: '업무' },
    personal: { label: '개인' },
    study: { label: '공부' }
  };

  const PRIORITIES = {
    high: { label: '높음', rank: 0 },
    medium: { label: '보통', rank: 1 },
    low: { label: '낮음', rank: 2 }
  };

  const FILTERS = ['all', 'work', 'personal', 'study'];
  const COMPOSER_DEFAULTS = { category: 'work', priority: 'medium' };
  const SORTS = ['newest', 'oldest', 'category', 'priority', 'status', 'manual'];

  const QUOTES = [
    { text: '천 리 길도 한 걸음부터.', author: '속담' },
    { text: '시작이 반이다.', author: '속담' },
    { text: '로마는 하루아침에 이루어지지 않았다.', author: '서양 속담' },
    { text: '오늘 할 수 있는 일을 내일로 미루지 마라.', author: '벤저민 프랭클린' },
    { text: '우리가 반복적으로 하는 행동이 곧 우리 자신이다.', author: '윌 듀런트' },
    { text: '멈추지만 않는다면 얼마나 천천히 가는지는 중요하지 않다.', author: '공자' },
    { text: '완벽한 것보다 끝낸 것이 낫다.', author: '실리콘밸리 격언' },
    { text: '작은 진전도 큰 성과입니다.', author: 'My Tasks' },
    { text: '노력하는 모든 순간이 소중해요.', author: 'My Tasks' },
    { text: '할 일을 적는 순간, 머릿속에 여유가 생깁니다.', author: 'My Tasks' },
    { text: '오늘의 체크 하나가 내일의 습관이 됩니다.', author: 'My Tasks' },
    { text: '가장 중요한 일부터, 한 번에 하나씩.', author: 'My Tasks' }
  ];

  /* Example tasks (reference only: a first visit starts with an empty list) */
  const SAMPLE_TASKS = [
    { text: '주말 가족 모임 장소 예약', category: 'personal', priority: 'medium', completed: false, minutesAgo: 25 },
    { text: '프로젝트 기획서 검토', category: 'work', priority: 'high', completed: false, minutesAgo: 70 },
    { text: '혼공 바이브 코딩 4장 끝내기', category: 'study', priority: 'high', completed: true, minutesAgo: 180 }
  ];

  /* ============================== Utilities ============================== */

  /** Creates a unique, URL-safe id. */
  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /** Removes control characters, collapses whitespace and limits length. */
  function cleanText(value) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_TEXT_LENGTH);
  }

  function isSameLocalDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  /*
    Date formatters are created once and reused: building a new Intl formatter
    for every task (toLocaleString) was the most expensive part of rendering
    long lists. Output is identical to the toLocale* calls it replaces.
  */
  const DATE_FORMATS = {
    monthDay: new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }),
    yearMonthDay: new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }),
    full: new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric', month: 'long', day: 'numeric',
      weekday: 'short', hour: '2-digit', minute: '2-digit'
    })
  };

  /** "방금 전", "10분 전", "3시간 전", "어제", "4일 전", otherwise "9월 12일". */
  function formatRelativeTime(iso, now) {
    const date = new Date(iso);
    const diffSec = Math.max(0, Math.floor((now - date) / 1000));
    if (diffSec < 60) return '방금 전';
    const min = Math.floor(diffSec / 60);
    if (min < 60) return min + '분 전';
    const hour = Math.floor(min / 60);
    if (hour < 24) return hour + '시간 전';
    const day = Math.floor(hour / 24);
    if (day === 1) return '어제';
    if (day < 7) return day + '일 전';
    const sameYear = date.getFullYear() === now.getFullYear();
    return (sameYear ? DATE_FORMATS.monthDay : DATE_FORMATS.yearMonthDay).format(date);
  }

  function formatFullDate(iso) {
    return DATE_FORMATS.full.format(new Date(iso));
  }

  function todayStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /** Small helper to build DOM nodes without innerHTML. */
  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((key) => {
        const value = props[key];
        if (key === 'className') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key.startsWith('aria-') || key === 'role' || key === 'title' || key === 'type' || key === 'tabindex') node.setAttribute(key, value);
        else node[key] = value;
      });
    }
    (children || []).forEach((child) => { if (child) node.appendChild(child); });
    return node;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** Builds a trusted, static SVG icon from path strings. */
  function svgIcon(viewBox, paths, className) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('aria-hidden', 'true');
    if (className) svg.setAttribute('class', className);
    paths.forEach((d) => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    return svg;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ============================== SafeStorage ============================== */

  class SafeStorage {
    static read(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (error) {
        return fallback;
      }
    }

    static has(key) {
      try {
        return window.localStorage.getItem(key) != null;
      } catch (error) {
        return false;
      }
    }

    /** Returns true when the value was saved. */
    static write(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        return false;
      }
    }

    /** Returns true when the key is gone (or storage is unavailable). */
    static remove(key) {
      try {
        window.localStorage.removeItem(key);
        return true;
      } catch (error) {
        return false;
      }
    }
  }

  /* ============================== TaskStore ============================== */

  class TaskStore {
    constructor(onSaveError) {
      this.tasks = [];
      this.onSaveError = onSaveError || function () {};
    }

    /** Validates one raw task object; returns a clean task or null. */
    static sanitize(raw, usedIds) {
      if (!raw || typeof raw !== 'object') return null;
      const text = cleanText(raw.text != null ? raw.text : raw.title);
      if (!text) return null;

      let id = typeof raw.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : createId();
      if (usedIds) {
        while (usedIds.has(id)) id = createId();
        usedIds.add(id);
      }

      const created = new Date(raw.createdAt);
      const createdAt = isNaN(created.getTime()) ? new Date().toISOString() : created.toISOString();

      return {
        id: id,
        text: text,
        category: Object.prototype.hasOwnProperty.call(CATEGORIES, raw.category) ? raw.category : 'personal',
        priority: Object.prototype.hasOwnProperty.call(PRIORITIES, raw.priority) ? raw.priority : 'medium',
        completed: raw.completed === true,
        createdAt: createdAt
      };
    }

    static sanitizeList(list) {
      if (!Array.isArray(list)) return [];
      const usedIds = new Set();
      const result = [];
      for (let i = 0; i < list.length && result.length < MAX_TASKS; i += 1) {
        const task = TaskStore.sanitize(list[i], usedIds);
        if (task) result.push(task);
      }
      return result;
    }

    /**
     * Restores the saved task list so tasks survive a reload (PRD p.4, Step 1).
     * Saved data is validated first; if anything had to be repaired the clean
     * list is written back. A first visit simply starts with an empty list.
     */
    load() {
      const saved = SafeStorage.read(STORAGE_KEYS.tasks, []);
      this.tasks = TaskStore.sanitizeList(saved);
      if (SafeStorage.has(STORAGE_KEYS.tasks) && JSON.stringify(saved) !== JSON.stringify(this.tasks)) {
        this.save();
      }
    }

    save() {
      if (!SafeStorage.write(STORAGE_KEYS.tasks, this.tasks)) this.onSaveError();
    }

    get(id) {
      return this.tasks.find((task) => task.id === id) || null;
    }

    add(input) {
      const task = TaskStore.sanitize({
        text: input.text,
        category: input.category,
        priority: input.priority,
        completed: false,
        createdAt: new Date().toISOString()
      });
      if (!task) return null;
      this.tasks.unshift(task); // newest on top (also for manual order)
      this.save();
      return task;
    }

    update(id, patch) {
      const task = this.get(id);
      if (!task) return null;
      if (patch.text !== undefined) {
        const text = cleanText(patch.text);
        if (!text) return null;
        task.text = text;
      }
      if (patch.completed !== undefined) task.completed = Boolean(patch.completed);
      if (patch.category && CATEGORIES[patch.category]) task.category = patch.category;
      if (patch.priority && PRIORITIES[patch.priority]) task.priority = patch.priority;
      this.save();
      return task;
    }

    toggle(id) {
      const task = this.get(id);
      return task ? this.update(id, { completed: !task.completed }) : null;
    }

    /** Removes a task and returns what is needed to undo it. */
    remove(id) {
      const index = this.tasks.findIndex((task) => task.id === id);
      if (index === -1) return null;
      const removed = this.tasks.splice(index, 1)[0];
      this.save();
      return { task: removed, index: index };
    }

    restore(task, index) {
      if (this.get(task.id)) return;
      this.tasks.splice(Math.min(index, this.tasks.length), 0, task);
      this.save();
    }

    clearCompleted() {
      const removed = this.tasks.filter((task) => task.completed);
      this.tasks = this.tasks.filter((task) => !task.completed);
      this.save();
      return removed;
    }

    replaceAll(tasks) {
      this.tasks = tasks.slice(0, MAX_TASKS);
      this.save();
    }

    /** Puts the store into the given id order (used before manual sorting). */
    reorder(ids) {
      const map = new Map(this.tasks.map((task) => [task.id, task]));
      const ordered = ids.map((id) => map.get(id)).filter(Boolean);
      const rest = this.tasks.filter((task) => ids.indexOf(task.id) === -1);
      this.tasks = ordered.concat(rest);
      this.save();
    }

    /** Moves task `id` before or after task `targetId`. */
    move(id, targetId, placeAfter) {
      if (id === targetId) return false;
      const from = this.tasks.findIndex((task) => task.id === id);
      if (from === -1) return false;
      const moving = this.tasks.splice(from, 1)[0];
      let to = this.tasks.findIndex((task) => task.id === targetId);
      if (to === -1) {
        this.tasks.splice(from, 0, moving);
        return false;
      }
      if (placeAfter) to += 1;
      this.tasks.splice(to, 0, moving);
      this.save();
      return true;
    }

    sorted(sortKey) {
      const list = this.tasks.slice();
      const time = (task) => new Date(task.createdAt).getTime();
      switch (sortKey) {
        case 'oldest':
          return list.sort((a, b) => time(a) - time(b));
        case 'category': {
          // 업무 > 개인 > 공부 (CATEGORIES order), newest first inside a category
          const order = Object.keys(CATEGORIES);
          return list.sort((a, b) => (order.indexOf(a.category) - order.indexOf(b.category)) || (time(b) - time(a)));
        }
        case 'priority':
          return list.sort((a, b) => (PRIORITIES[a.priority].rank - PRIORITIES[b.priority].rank) || (time(b) - time(a)));
        case 'status':
          return list.sort((a, b) => (Number(a.completed) - Number(b.completed)) || (time(b) - time(a)));
        case 'manual':
          return list;
        case 'newest':
        default:
          return list.sort((a, b) => time(b) - time(a));
      }
    }

    stats() {
      const now = new Date();
      const result = {
        total: this.tasks.length,
        done: 0,
        today: 0,
        byCategory: {}
      };
      Object.keys(CATEGORIES).forEach((key) => { result.byCategory[key] = { total: 0, done: 0 }; });
      this.tasks.forEach((task) => {
        const bucket = result.byCategory[task.category];
        bucket.total += 1;
        if (task.completed) {
          bucket.done += 1;
          result.done += 1;
        }
        if (isSameLocalDay(new Date(task.createdAt), now)) result.today += 1;
      });
      return result;
    }
  }

  /* ============================== ToastManager ============================== */

  const TOAST_ICONS = {
    success: ['M5 12.5l4.2 4.2L19 7'],
    error: ['M12 7v6', 'M12 17h.01', 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18'],
    info: ['M12 11v6', 'M12 7h.01', 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18']
  };

  class ToastManager {
    constructor(region) {
      this.region = region;
      this.maxVisible = 3;
    }

    show(message, options) {
      const opts = Object.assign({ type: 'success', duration: 2800, actionLabel: '', onAction: null }, options);
      const toast = el('div', { className: 'toast toast--' + opts.type, role: opts.type === 'error' ? 'alert' : 'status' });
      toast.appendChild(svgIcon('0 0 24 24', TOAST_ICONS[opts.type] || TOAST_ICONS.info, 'toast__icon'));
      toast.appendChild(el('span', { className: 'toast__msg', text: message }));

      let timer = null;
      const close = () => {
        if (!toast.isConnected || toast.classList.contains('is-leaving')) return;
        clearTimeout(timer);
        toast.classList.add('is-leaving');
        const done = () => toast.remove();
        toast.addEventListener('animationend', done, { once: true });
        setTimeout(done, 400);
      };

      if (opts.actionLabel && typeof opts.onAction === 'function') {
        const action = el('button', { className: 'toast__action', type: 'button', text: opts.actionLabel });
        action.addEventListener('click', () => {
          opts.onAction();
          close();
        });
        toast.appendChild(action);
      }

      this.region.appendChild(toast);
      while (this.region.children.length > this.maxVisible) this.region.firstElementChild.remove();

      timer = setTimeout(close, opts.duration);
      toast.addEventListener('mouseenter', () => clearTimeout(timer));
      toast.addEventListener('mouseleave', () => { timer = setTimeout(close, 1500); });
      return close;
    }
  }

  /* ============================== ConfirmDialog ============================== */

  class ConfirmDialog {
    constructor(root) {
      this.root = root;
      this.title = root.querySelector('#modal-title');
      this.message = root.querySelector('#modal-message');
      this.code = root.querySelector('#modal-code');
      this.confirmBtn = root.querySelector('#modal-confirm');
      this.cancelBtn = root.querySelector('#modal-cancel');
      this.resolve = null;
      this.lastFocus = null;

      this.confirmBtn.addEventListener('click', () => this.close(true));
      this.cancelBtn.addEventListener('click', () => this.close(false));
      root.querySelector('[data-modal-dismiss]').addEventListener('click', () => this.close(false));
      root.addEventListener('keydown', (event) => this.onKeydown(event));
    }

    get isOpen() {
      return !this.root.hidden;
    }

    /**
     * Opens the dialog and resolves true (confirm) or false (cancel).
     * options: { title, message, confirmLabel, cancelLabel, danger, code, onConfirm }
     */
    open(options) {
      if (this.resolve) this.close(false);
      const opts = Object.assign({ title: '확인', message: '', confirmLabel: '확인', cancelLabel: '취소', danger: false, code: null }, options);
      this.title.textContent = opts.title;
      this.message.textContent = opts.message;
      this.confirmBtn.textContent = opts.confirmLabel;
      this.cancelBtn.textContent = opts.cancelLabel;
      this.cancelBtn.hidden = opts.cancelLabel === '';
      this.confirmBtn.className = 'btn ' + (opts.danger ? 'btn--danger' : 'btn--primary');
      this.code.hidden = opts.code == null;
      this.code.value = opts.code == null ? '' : opts.code;
      this.onConfirm = opts.onConfirm || null;

      this.lastFocus = document.activeElement;
      this.root.hidden = false;
      document.body.style.overflow = 'hidden';
      (opts.danger ? this.cancelBtn : this.confirmBtn).focus();

      return new Promise((resolve) => { this.resolve = resolve; });
    }

    close(result) {
      if (!this.resolve) return;
      if (result && this.onConfirm) {
        // A confirm handler may keep the dialog open (e.g. "copy" in embed mode)
        if (this.onConfirm() === false) return;
      }
      const resolve = this.resolve;
      this.resolve = null;
      this.root.hidden = true;
      document.body.style.overflow = '';
      if (this.lastFocus && typeof this.lastFocus.focus === 'function') this.lastFocus.focus();
      resolve(result);
    }

    onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close(false);
        return;
      }
      if (event.key === 'Tab') { // keep focus inside the dialog
        const focusable = Array.prototype.filter.call(
          this.root.querySelectorAll('button, textarea'),
          (node) => !node.hidden && !node.disabled
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  }

  /* ============================== TodoApp ============================== */

  class TodoApp {
    constructor() {
      this.$ = (id) => document.getElementById(id);
      this.els = {
        todayLabel: this.$('today-label'),
        themeToggle: this.$('theme-toggle'),
        progressText: this.$('progress-text'),
        progressBar: this.$('progress-bar'),
        progressFill: this.$('progress-fill'),
        todayCount: this.$('today-count'),
        catStats: this.$('cat-stats'),
        quoteFigure: document.querySelector('.quote'),
        quoteText: this.$('quote-text'),
        quoteAuthor: this.$('quote-author'),
        quoteRefresh: this.$('quote-refresh'),
        search: this.$('search-input'),
        sort: this.$('sort-select'),
        exportBtn: this.$('export-btn'),
        importBtn: this.$('import-btn'),
        importFile: this.$('import-file'),
        filters: this.$('filters'),
        clearCompleted: this.$('clear-completed'),
        form: this.$('task-form'),
        input: this.$('task-input'),
        resetBtn: this.$('reset-form-btn'),
        category: this.$('category-select'),
        priority: this.$('priority-select'),
        hint: this.$('form-hint'),
        listMeta: this.$('list-meta'),
        list: this.$('task-list'),
        empty: this.$('empty-state'),
        emptyTitle: this.$('empty-title'),
        emptyText: this.$('empty-text')
      };

      this.toast = new ToastManager(this.$('toast-region'));
      this.dialog = new ConfirmDialog(this.$('modal'));
      this.store = new TaskStore(() => this.warnStorage());
      this.storageWarned = false;

      const saved = SafeStorage.read(STORAGE_KEYS.settings, {}) || {};
      this.state = {
        filter: FILTERS.indexOf(saved.filter) !== -1 ? saved.filter : 'all',
        sort: SORTS.indexOf(saved.sort) !== -1 ? saved.sort : 'newest',
        theme: saved.theme === 'dark' || saved.theme === 'light' ? saved.theme : null,
        query: ''
      };

      this.enteringId = null;   // task to animate in on next render
      this.focusAfterRender = null;
      this.dragId = null;
      this.quoteIndex = -1;
      this.lastProgress = -1;
    }

    init() {
      // Snapshot of what storage held before loading (checked by evaluateApp)
      const savedBefore = SafeStorage.read(STORAGE_KEYS.tasks, []);
      this.startSavedTexts = TaskStore.sanitizeList(savedBefore).map((task) => task.text);
      this.store.load();
      this.startTaskTexts = this.store.tasks.map((task) => task.text);
      this.els.sort.value = this.state.sort;
      this.els.todayLabel.textContent = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
      this.applyTheme(this.currentTheme(), false);
      this.showRandomQuote(false);
      this.bindEvents();
      this.render();

      // Every load / reload starts with a clean form and the cursor in the input
      this.resetComposer({ focus: true });
      // Browsers may restore form values or autofill after scripts run:
      // reset again after load and once more on the next frame
      window.addEventListener('load', () => {
        this.resetComposer({ focus: true });
        requestAnimationFrame(() => {
          if (document.activeElement === document.body || document.activeElement === this.els.input) {
            this.resetComposer({ focus: true });
          }
        });
      }, { once: true });

      // Keep "n분 전" labels fresh without re-rendering the whole list
      setInterval(() => this.refreshTimes(), 60 * 1000);

      // Self-check once the page has settled (also callable: evaluateApp())
      const runEvaluation = () => setTimeout(() => this.evaluateApp(), 0);
      if (document.readyState === 'complete') runEvaluation();
      else window.addEventListener('load', runEvaluation, { once: true });
    }

    /* ---------- settings / theme ---------- */

    saveSettings() {
      SafeStorage.write(STORAGE_KEYS.settings, {
        filter: this.state.filter,
        sort: this.state.sort,
        theme: this.state.theme
      });
    }

    systemPrefersDark() {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    currentTheme() {
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'dark' || attr === 'light') return attr;
      return this.state.theme || (this.systemPrefersDark() ? 'dark' : 'light');
    }

    applyTheme(theme, animate) {
      const root = document.documentElement;
      if (animate && !prefersReducedMotion()) {
        root.classList.add('theme-transition');
        clearTimeout(this.themeTimer);
        this.themeTimer = setTimeout(() => root.classList.remove('theme-transition'), 450);
      }
      root.setAttribute('data-theme', theme);
      const dark = theme === 'dark';
      this.els.themeToggle.setAttribute('aria-checked', String(dark));
      this.els.themeToggle.setAttribute('aria-label', dark ? '다크 모드 켜짐' : '다크 모드 꺼짐');
    }

    toggleTheme() {
      const next = this.currentTheme() === 'dark' ? 'light' : 'dark';
      this.state.theme = next;
      this.applyTheme(next, true);
      this.saveSettings();
      this.toast.show(next === 'dark' ? '다크 모드로 바꿨어요' : '라이트 모드로 바꿨어요', { type: 'info', duration: 1600 });
    }

    warnStorage() {
      if (this.storageWarned) return;
      this.storageWarned = true;
      this.toast.show('브라우저 저장소를 쓸 수 없어 새로고침하면 데이터가 사라져요. 내보내기로 백업해 두세요.', { type: 'error', duration: 6000 });
    }

    /* ---------- events ---------- */

    bindEvents() {
      const els = this.els;

      // Step 1: add (button click + Enter key via form submit)
      els.form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.addTask();
      });
      els.input.addEventListener('input', () => { els.hint.textContent = ''; });

      // New entry reset: button + Esc inside the input
      els.resetBtn.addEventListener('click', () => {
        this.resetComposer({ focus: true, flash: true });
      });
      // Esc anywhere in the form (input or the two selects) resets it
      els.form.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.target === els.input && this.composerIsDefault()) {
          els.input.blur(); // nothing to clear: leave the input
        } else {
          this.resetComposer({ focus: true, flash: true });
        }
      });

      // Back/forward cache restores the old page: reset the form again
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) this.resetComposer({ focus: true });
      });

      // List: event delegation (one listener for any number of items)
      els.list.addEventListener('change', (event) => {
        if (event.target.classList.contains('task__check')) {
          const id = event.target.closest('.task').dataset.id;
          this.toggleTask(id);
        }
      });
      els.list.addEventListener('click', (event) => {
        const del = event.target.closest('.task__delete');
        if (del) this.deleteTask(del.closest('.task').dataset.id);
      });
      els.list.addEventListener('dblclick', (event) => {
        const text = event.target.closest('.task__text');
        if (text) this.startEdit(text.closest('.task'));
      });
      els.list.addEventListener('keydown', (event) => this.onListKeydown(event));

      // Step 5: drag and drop (HTML5 DnD API)
      els.list.addEventListener('dragstart', (event) => this.onDragStart(event));
      els.list.addEventListener('dragover', (event) => this.onDragOver(event));
      els.list.addEventListener('dragleave', (event) => {
        const item = event.target.closest && event.target.closest('.task');
        if (item && !item.contains(event.relatedTarget)) item.classList.remove('drop-before', 'drop-after');
      });
      els.list.addEventListener('drop', (event) => this.onDrop(event));
      els.list.addEventListener('dragend', () => this.clearDragState());

      // Step 2: filters
      els.filters.addEventListener('click', (event) => {
        const button = event.target.closest('.filter');
        if (button) this.setFilter(button.dataset.filter);
      });

      // Step 4: live search
      els.search.addEventListener('input', () => {
        this.state.query = cleanText(els.search.value).toLowerCase();
        this.renderList();
      });
      els.search.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && els.search.value) {
          event.stopPropagation();
          els.search.value = '';
          this.state.query = '';
          this.renderList();
        }
      });

      // Step 5: sorting
      els.sort.addEventListener('change', () => {
        this.state.sort = els.sort.value;
        this.saveSettings();
        this.renderList();
      });

      els.clearCompleted.addEventListener('click', () => this.clearCompleted());
      els.themeToggle.addEventListener('click', () => this.toggleTheme());
      els.quoteRefresh.addEventListener('click', () => this.showRandomQuote(true));

      // Step 5: export / import
      els.exportBtn.addEventListener('click', () => this.exportData());
      els.importBtn.addEventListener('click', () => els.importFile.click());
      els.importFile.addEventListener('change', () => this.importData(els.importFile.files[0]));

      // Step 4: keyboard shortcuts
      document.addEventListener('keydown', (event) => this.onShortcut(event));

      // Follow the OS theme while the user has not chosen one
      if (window.matchMedia) {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => { if (!this.state.theme) this.applyTheme(media.matches ? 'dark' : 'light', true); };
        if (media.addEventListener) media.addEventListener('change', onChange);
      }

      // Another tab changed the data: reload it
      window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEYS.tasks) {
          this.store.tasks = TaskStore.sanitizeList(SafeStorage.read(STORAGE_KEYS.tasks, []));
          this.render();
        }
      });
    }

    onShortcut(event) {
      if (this.dialog.isOpen) return;
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      // event.code works with Korean IME and keyboard layouts
      const code = event.code;
      if (code === 'KeyN') {
        event.preventDefault();
        this.resetComposer({ focus: true, flash: true });
      } else if (code === 'KeyD') {
        event.preventDefault();
        this.toggleTheme();
      } else {
        const match = /^(?:Digit|Numpad)([1-4])$/.exec(code);
        if (match) {
          event.preventDefault();
          this.setFilter(FILTERS[Number(match[1]) - 1]);
          const active = this.els.filters.querySelector('.filter.is-active');
          if (active) active.focus({ preventScroll: true });
        }
      }
    }

    /* ---------- composer reset (new entry) ---------- */

    composerIsDefault() {
      return this.els.input.value === '' &&
        this.els.category.value === COMPOSER_DEFAULTS.category &&
        this.els.priority.value === COMPOSER_DEFAULTS.priority;
    }

    /** Clears the text, restores 업무 / 보통 and optionally focuses the input. */
    resetComposer(options) {
      const opts = Object.assign({ focus: false, flash: false }, options);
      const els = this.els;
      els.input.value = '';
      els.category.value = COMPOSER_DEFAULTS.category;
      els.priority.value = COMPOSER_DEFAULTS.priority;
      els.hint.textContent = '';
      els.form.classList.remove('shake');
      if (opts.flash && !prefersReducedMotion()) {
        els.form.classList.remove('is-reset');
        void els.form.offsetWidth;
        els.form.classList.add('is-reset');
      }
      if (opts.focus && !this.dialog.isOpen) els.input.focus({ preventScroll: true });
    }

    /* ---------- actions ---------- */

    addTask() {
      const text = cleanText(this.els.input.value);
      if (!text) {
        this.els.hint.textContent = '할 일 내용을 입력해 주세요.';
        this.els.form.classList.remove('shake');
        void this.els.form.offsetWidth; // restart the animation
        this.els.form.classList.add('shake');
        this.els.input.focus();
        return;
      }
      if (this.store.tasks.length >= MAX_TASKS) {
        this.toast.show('할 일은 최대 ' + MAX_TASKS + '개까지 저장할 수 있어요.', { type: 'error' });
        return;
      }
      const task = this.store.add({ text: text, category: this.els.category.value, priority: this.els.priority.value });
      if (!task) return;

      this.els.input.value = '';
      this.els.hint.textContent = '';
      this.enteringId = task.id;

      // Make sure the new task is visible right away
      if (this.state.filter !== 'all' && this.state.filter !== task.category) this.setFilter('all', false);
      if (this.state.query && task.text.toLowerCase().indexOf(this.state.query) === -1) {
        this.els.search.value = '';
        this.state.query = '';
      }

      this.render();
      this.toast.show('"' + this.shorten(task.text) + '" 추가됨');
    }

    toggleTask(id) {
      const task = this.store.toggle(id);
      if (!task) return;

      // Update the row in place so the check / strike-through animations play
      const item = this.els.list.querySelector('.task[data-id="' + CSS.escape(id) + '"]');
      if (item) {
        item.classList.toggle('is-completed', task.completed);
        item.classList.toggle('just-checked', task.completed);
        item.querySelector('.task__check').setAttribute('aria-label', '"' + task.text + '" ' + (task.completed ? '완료됨' : '완료 표시'));
      }
      this.renderDashboard();
      this.renderFilters();
      this.renderListMeta(this.visibleTasks());
      if (this.state.sort === 'status') {
        clearTimeout(this.resortTimer);
        this.resortTimer = setTimeout(() => this.renderList(), 450);
      }
      if (task.completed) {
        const stats = this.store.stats();
        if (stats.total > 0 && stats.done === stats.total) {
          this.toast.show('모든 할 일을 끝냈어요. 수고했어요!', { type: 'success' });
        }
      }
    }

    deleteTask(id) {
      const item = this.els.list.querySelector('.task[data-id="' + CSS.escape(id) + '"]');
      const finish = () => {
        const removed = this.store.remove(id);
        if (!removed) return;
        this.render();
        this.toast.show('"' + this.shorten(removed.task.text) + '" 삭제됨', {
          type: 'info',
          duration: 5000,
          actionLabel: '실행 취소',
          onAction: () => {
            this.store.restore(removed.task, removed.index);
            this.enteringId = removed.task.id;
            this.render();
            this.toast.show('할 일을 되살렸어요');
          }
        });
      };
      if (item && !prefersReducedMotion()) {
        item.classList.add('is-leaving');
        let done = false;
        const once = () => { if (!done) { done = true; finish(); } };
        item.addEventListener('animationend', once, { once: true });
        setTimeout(once, 350);
      } else {
        finish();
      }
    }

    async clearCompleted() {
      const count = this.store.tasks.filter((task) => task.completed).length;
      if (!count) {
        this.toast.show('완료된 할 일이 없어요.', { type: 'info' });
        return;
      }
      const ok = await this.dialog.open({
        title: '완료 항목 삭제',
        message: '완료된 할 일 ' + count + '개를 모두 삭제할까요?\n삭제 직후에는 알림에서 되돌릴 수 있어요.',
        confirmLabel: count + '개 삭제',
        danger: true
      });
      if (!ok) return;
      const before = this.store.tasks.slice();
      const removed = this.store.clearCompleted();
      this.render();
      this.toast.show('완료된 할 일 ' + removed.length + '개를 삭제했어요', {
        type: 'info',
        duration: 6000,
        actionLabel: '실행 취소',
        onAction: () => {
          this.store.replaceAll(before);
          this.render();
          this.toast.show('삭제한 할 일을 되살렸어요');
        }
      });
    }

    setFilter(filter, rerender) {
      if (FILTERS.indexOf(filter) === -1) return;
      this.state.filter = filter;
      this.saveSettings();
      if (rerender !== false) {
        this.renderFilters();
        this.renderList();
      }
    }

    shorten(text) {
      return text.length > 18 ? text.slice(0, 18) + '…' : text;
    }

    /* ---------- Step 3: inline edit (text + category + priority) ---------- */

    /** Builds a <select> from a { key: { label } } map with `current` selected. */
    buildEditSelect(className, label, map, current) {
      const select = el('select', { className: className, title: label, 'aria-label': label });
      Object.keys(map).forEach((key) => {
        select.appendChild(el('option', { value: key, text: map[key].label, selected: key === current }));
      });
      return select;
    }

    startEdit(item) {
      if (!item || item.classList.contains('is-editing')) return;
      const task = this.store.get(item.dataset.id);
      if (!task) return;
      const textEl = item.querySelector('.task__text');
      const input = el('input', {
        className: 'task__edit',
        type: 'text',
        value: task.text,
        maxLength: MAX_TEXT_LENGTH,
        'aria-label': '할 일 수정 (Enter 저장, Esc 취소)'
      });
      const category = this.buildEditSelect('task__edit-select', '카테고리 변경', CATEGORIES, task.category);
      const priority = this.buildEditSelect('task__edit-select', '우선순위 변경', PRIORITIES, task.priority);
      const editor = el('div', { className: 'task__editor', role: 'group', 'aria-label': '할 일 편집' }, [
        input,
        el('div', { className: 'task__edit-options' }, [category, priority])
      ]);

      item.classList.add('is-editing');
      item.draggable = false;
      textEl.replaceWith(editor);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);

      let finished = false;
      const finish = (save) => {
        if (finished) return;
        finished = true;
        if (save) {
          this.saveEdit(task, { text: input.value, category: category.value, priority: priority.value });
        }
        this.focusAfterRender = { id: task.id, selector: '.task__text' };
        this.render();
      };

      // Enter saves and Esc cancels from any field of the editor
      editor.addEventListener('keydown', (event) => {
        if (event.isComposing) return; // Korean IME: wait for composition end
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      });
      // Leaving the whole editor (not just moving between its fields) saves
      editor.addEventListener('focusout', (event) => {
        if (event.relatedTarget && editor.contains(event.relatedTarget)) return;
        setTimeout(() => {
          if (!editor.contains(document.activeElement)) finish(true);
        }, 0);
      });
    }

    /** Saves the changed fields of an inline edit and reports the result. */
    saveEdit(task, values) {
      const text = cleanText(values.text);
      if (!text) {
        this.toast.show('빈 내용으로는 저장할 수 없어 원래대로 돌렸어요.', { type: 'error' });
        return false;
      }
      const patch = {};
      if (text !== task.text) patch.text = text;
      if (values.category !== task.category && CATEGORIES[values.category]) patch.category = values.category;
      if (values.priority !== task.priority && PRIORITIES[values.priority]) patch.priority = values.priority;
      if (!Object.keys(patch).length) return false;
      this.store.update(task.id, patch);
      this.toast.show('할 일을 수정했어요', { duration: 1800 });
      return true;
    }

    onListKeydown(event) {
      const item = event.target.closest('.task');
      if (!item) return;

      // Enter or F2 on the text starts editing (keyboard alternative to double click)
      if (event.target.classList.contains('task__text') && (event.key === 'Enter' || event.key === 'F2')) {
        event.preventDefault();
        this.startEdit(item);
        return;
      }

      // Arrow keys on the handle move the item (keyboard alternative to drag)
      if (event.target.classList.contains('task__handle') && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        const sibling = event.key === 'ArrowUp' ? item.previousElementSibling : item.nextElementSibling;
        if (!sibling) return;
        this.ensureManualOrder();
        if (this.store.move(item.dataset.id, sibling.dataset.id, event.key === 'ArrowDown')) {
          this.focusAfterRender = { id: item.dataset.id, selector: '.task__handle' };
          this.renderList();
        }
      }
    }

    /* ---------- Step 5: drag and drop ---------- */

    ensureManualOrder() {
      if (this.state.sort === 'manual') return;
      this.store.reorder(this.store.sorted(this.state.sort).map((task) => task.id));
      this.state.sort = 'manual';
      this.els.sort.value = 'manual';
      this.saveSettings();
      this.toast.show('정렬을 "직접 정렬"로 바꿨어요', { type: 'info', duration: 2000 });
    }

    onDragStart(event) {
      const item = event.target.closest && event.target.closest('.task');
      if (!item || item.classList.contains('is-editing')) return;
      this.dragId = item.dataset.id;
      event.dataTransfer.effectAllowed = 'move';
      try { event.dataTransfer.setData('text/plain', this.dragId); } catch (error) { /* IE */ }
      requestAnimationFrame(() => item.classList.add('is-dragging'));
    }

    onDragOver(event) {
      if (!this.dragId) return;
      const item = event.target.closest && event.target.closest('.task');
      if (!item || item.dataset.id === this.dragId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const rect = item.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      item.classList.toggle('drop-after', after);
      item.classList.toggle('drop-before', !after);
    }

    onDrop(event) {
      if (!this.dragId) return;
      const item = event.target.closest && event.target.closest('.task');
      event.preventDefault();
      if (item && item.dataset.id !== this.dragId) {
        const after = item.classList.contains('drop-after');
        const dragId = this.dragId;
        this.ensureManualOrder();
        if (this.store.move(dragId, item.dataset.id, after)) {
          this.enteringId = null;
          this.renderList();
        }
      }
      this.clearDragState();
    }

    clearDragState() {
      this.dragId = null;
      this.els.list.querySelectorAll('.is-dragging, .drop-before, .drop-after').forEach((node) => {
        node.classList.remove('is-dragging', 'drop-before', 'drop-after');
      });
    }

    /* ---------- Step 5: export / import ---------- */

    buildExport() {
      return {
        tasks: this.store.tasks,
        settings: { currentFilter: this.state.filter, currentSort: this.state.sort, isDarkMode: this.currentTheme() === 'dark' },
        metadata: { app: 'My Tasks', version: APP_VERSION, exportDate: new Date().toISOString(), taskCount: this.store.tasks.length }
      };
    }

    exportData() {
      if (!this.store.tasks.length) {
        this.toast.show('내보낼 할 일이 없어요.', { type: 'info' });
        return;
      }
      const json = JSON.stringify(this.buildExport(), null, 2);

      // Inside an embedded preview downloads are blocked, so show the JSON instead
      if (window.__MY_TASKS_EMBED__) {
        this.dialog.open({
          title: '데이터 내보내기',
          message: '이 미리보기에서는 파일 다운로드가 막혀 있어요. 아래 JSON을 복사해 .json 파일로 저장하세요.',
          code: json,
          confirmLabel: '복사',
          cancelLabel: '닫기',
          onConfirm: () => {
            const area = this.dialog.code;
            const fallback = () => { area.focus(); area.select(); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(json)
                .then(() => this.toast.show('JSON을 클립보드에 복사했어요'))
                .catch(fallback);
            } else {
              fallback();
            }
            return false;
          }
        });
        return;
      }

      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = el('a', { href: url, download: 'my-tasks-' + todayStamp() + '.json' });
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast.show(this.store.tasks.length + '개의 할 일을 JSON 파일로 내보냈어요');
    }

    importData(file) {
      const input = this.els.importFile;
      if (!file) return;
      const reset = () => { input.value = ''; };

      if (file.size > MAX_IMPORT_BYTES) {
        this.toast.show('파일이 너무 커요. 1MB 이하의 JSON 파일을 선택해 주세요.', { type: 'error' });
        reset();
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => {
        this.toast.show('파일을 읽지 못했어요. 다시 시도해 주세요.', { type: 'error' });
        reset();
      };
      reader.onload = async () => {
        reset();
        let data;
        try {
          data = JSON.parse(String(reader.result));
        } catch (error) {
          this.toast.show('올바른 JSON 파일이 아니에요. 내보내기로 만든 파일을 선택해 주세요.', { type: 'error', duration: 4500 });
          return;
        }

        const rawList = Array.isArray(data) ? data : (data && Array.isArray(data.tasks) ? data.tasks : null);
        if (!rawList) {
          this.toast.show('파일에서 할 일 목록(tasks)을 찾지 못했어요.', { type: 'error', duration: 4500 });
          return;
        }
        const tasks = TaskStore.sanitizeList(rawList);
        if (!tasks.length) {
          this.toast.show('가져올 수 있는 할 일이 없어요.', { type: 'error' });
          return;
        }
        const skipped = rawList.length - tasks.length;

        const ok = await this.dialog.open({
          title: '데이터 가져오기',
          message: tasks.length + '개의 할 일을 가져올까요?\n' +
            '지금 있는 할 일 ' + this.store.tasks.length + '개는 바뀌기 전에 자동으로 백업돼요.' +
            (skipped > 0 ? '\n(형식이 잘못된 ' + skipped + '개 항목은 제외돼요)' : ''),
          confirmLabel: '가져오기'
        });
        if (!ok) return;

        const backup = this.store.tasks.slice();
        SafeStorage.write(STORAGE_KEYS.backup, { savedAt: new Date().toISOString(), tasks: backup });
        this.store.replaceAll(tasks);

        const settings = data && data.settings;
        if (settings && SORTS.indexOf(settings.currentSort) !== -1) {
          this.state.sort = settings.currentSort;
          this.els.sort.value = this.state.sort;
        }
        this.state.filter = 'all';
        this.saveSettings();
        this.render();

        this.toast.show(tasks.length + '개의 할 일을 복원했어요', {
          duration: 6000,
          actionLabel: '되돌리기',
          onAction: () => {
            this.store.replaceAll(backup);
            this.render();
            this.toast.show('가져오기 전 상태로 되돌렸어요', { type: 'info' });
          }
        });
      };
      reader.readAsText(file);
    }

    /* ---------- Step 5: quote ---------- */

    showRandomQuote(animate) {
      let index = Math.floor(Math.random() * QUOTES.length);
      if (QUOTES.length > 1 && index === this.quoteIndex) index = (index + 1) % QUOTES.length;
      this.quoteIndex = index;
      this.els.quoteText.textContent = QUOTES[index].text;
      this.els.quoteAuthor.textContent = QUOTES[index].author;
      if (animate) {
        const fig = this.els.quoteFigure;
        fig.classList.remove('is-changing');
        void fig.offsetWidth;
        fig.classList.add('is-changing');
      }
    }

    /* ============================== Rendering ============================== */

    render() {
      this.renderDashboard();
      this.renderFilters();
      this.renderList();
    }

    renderDashboard() {
      const stats = this.store.stats();
      const percent = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

      this.els.progressText.textContent = stats.done + '/' + stats.total + ' 완료 (' + percent + '%)';
      this.els.progressBar.setAttribute('aria-valuenow', String(percent));
      this.els.progressBar.setAttribute('aria-valuetext', stats.done + '개 완료, 전체 ' + stats.total + '개');
      this.els.progressFill.style.width = percent + '%';
      if (this.lastProgress !== -1 && this.lastProgress !== percent) {
        const fill = this.els.progressFill;
        fill.classList.remove('is-animating');
        void fill.offsetWidth;
        fill.classList.add('is-animating');
      }
      this.lastProgress = percent;

      const todayEl = this.els.todayCount;
      if (todayEl.textContent !== String(stats.today)) {
        todayEl.textContent = String(stats.today);
        const figure = todayEl.parentElement;
        figure.classList.remove('bump');
        void figure.offsetWidth;
        figure.classList.add('bump');
      }

      Object.keys(CATEGORIES).forEach((key) => {
        const card = this.els.catStats.querySelector('[data-category="' + key + '"]');
        const bucket = stats.byCategory[key];
        const ratio = bucket.total ? Math.round((bucket.done / bucket.total) * 100) : 0;
        card.querySelector('.cat-stat__num').textContent = bucket.done + '/' + bucket.total;
        card.querySelector('.mini-bar__fill').style.width = ratio + '%';
        card.title = CATEGORIES[key].label + ' ' + bucket.done + '/' + bucket.total + ' 완료 (' + ratio + '%)';
      });

      const completed = stats.done;
      this.els.clearCompleted.disabled = completed === 0;
      this.els.clearCompleted.lastChild.textContent = completed ? '완료 항목 삭제 (' + completed + ')' : '완료 항목 삭제';
    }

    renderFilters() {
      const stats = this.store.stats();
      this.els.filters.querySelectorAll('.filter').forEach((button) => {
        const key = button.dataset.filter;
        const active = key === this.state.filter;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
        const count = key === 'all' ? stats.total : stats.byCategory[key].total;
        button.querySelector('.filter__count').textContent = String(count);
      });
    }

    visibleTasks() {
      const { filter, query, sort } = this.state;
      return this.store.sorted(sort).filter((task) =>
        (filter === 'all' || task.category === filter) &&
        (!query || task.text.toLowerCase().indexOf(query) !== -1)
      );
    }

    renderList() {
      const tasks = this.visibleTasks();
      const now = new Date();
      const fragment = document.createDocumentFragment();
      tasks.forEach((task) => fragment.appendChild(this.createTaskElement(task, now)));
      this.els.list.replaceChildren(fragment);
      this.enteringId = null;

      this.renderEmptyState(tasks.length);

      this.renderListMeta(tasks);

      if (this.focusAfterRender) {
        const target = this.els.list.querySelector('.task[data-id="' + CSS.escape(this.focusAfterRender.id) + '"] ' + this.focusAfterRender.selector);
        if (target) target.focus();
        this.focusAfterRender = null;
      }
    }

    renderListMeta(tasks) {
      const remaining = tasks.filter((task) => !task.completed).length;
      this.els.listMeta.textContent = tasks.length
        ? '남은 할 일 ' + remaining + '개 · 표시 ' + tasks.length + '개' + (this.state.sort === 'manual' ? ' · 핸들을 끌어 순서 변경' : '')
        : '';
    }

    renderEmptyState(count) {
      const empty = this.els.empty;
      if (count > 0) {
        empty.hidden = true;
        return;
      }
      let title = '할 일이 없습니다. 추가해보세요!';
      let text = '오늘의 첫 할 일을 적어 볼까요? 작은 일 하나부터 시작하면 하루가 한결 가벼워져요.';
      if (this.state.query) {
        title = '"' + this.shorten(this.els.search.value.trim()) + '"와 맞는 할 일이 없어요';
        text = '다른 낱말로 찾아보거나 Esc로 검색어를 지워 보세요.';
      } else if (this.store.tasks.length > 0 && this.state.filter !== 'all') {
        title = CATEGORIES[this.state.filter].label + ' 카테고리가 비어 있어요';
        text = '이 카테고리의 할 일을 추가하거나 전체 목록으로 돌아가 보세요.';
      }
      this.els.emptyTitle.textContent = title;
      this.els.emptyText.textContent = text;
      empty.hidden = false;
    }

    createTaskElement(task, now) {
      const category = CATEGORIES[task.category];
      const priority = PRIORITIES[task.priority];

      const item = el('li', {
        className: 'task' + (task.completed ? ' is-completed' : '') + (task.id === this.enteringId ? ' is-entering' : ''),
        dataset: { id: task.id, category: task.category },
        draggable: true
      });

      const handle = el('button', {
        className: 'task__handle',
        type: 'button',
        title: '끌어서 순서 바꾸기 (↑/↓ 키로도 이동)',
        'aria-label': '"' + task.text + '" 순서 이동, 위아래 화살표 키 사용'
      });
      const grip = document.createElementNS(SVG_NS, 'svg');
      grip.setAttribute('viewBox', '0 0 12 18');
      grip.setAttribute('aria-hidden', 'true');
      [[3, 3], [9, 3], [3, 9], [9, 9], [3, 15], [9, 15]].forEach((p) => {
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('cx', p[0]);
        dot.setAttribute('cy', p[1]);
        dot.setAttribute('r', 1.6);
        grip.appendChild(dot);
      });
      handle.appendChild(grip);

      const check = el('input', {
        className: 'task__check',
        type: 'checkbox',
        checked: task.completed,
        'aria-label': '"' + task.text + '" ' + (task.completed ? '완료됨' : '완료 표시')
      });

      const text = el('span', {
        className: 'task__text',
        text: task.text,
        tabindex: '0',
        title: '더블클릭(또는 Enter)으로 수정'
      });

      const catBadge = el('span', { className: 'badge badge--cat', text: category.label });
      const prioBadge = el('span', {
        className: 'badge badge--prio',
        dataset: { priority: task.priority },
        title: '우선순위 ' + priority.label
      }, [el('span', { className: 'flag' }), document.createTextNode(priority.label)]);
      const time = el('time', {
        className: 'task__time',
        text: formatRelativeTime(task.createdAt, now),
        dateTime: task.createdAt,
        title: formatFullDate(task.createdAt)
      });

      const body = el('div', { className: 'task__body' }, [
        text,
        el('div', { className: 'task__meta' }, [catBadge, prioBadge, time])
      ]);

      const del = el('button', { className: 'task__delete', type: 'button', title: '삭제', 'aria-label': '"' + task.text + '" 삭제' });
      del.appendChild(svgIcon('0 0 24 24', ['M7 7l10 10', 'M17 7L7 17']));

      item.appendChild(handle);
      item.appendChild(check);
      item.appendChild(body);
      item.appendChild(del);
      return item;
    }

    refreshTimes() {
      const now = new Date();
      this.els.list.querySelectorAll('.task__time').forEach((node) => {
        node.textContent = formatRelativeTime(node.dateTime, now);
      });
      this.renderDashboard(); // "오늘 추가" changes after midnight
    }

    /* ============================== Self-check ============================== */

    /**
     * Inspects the running app and prints a scored report to the console.
     * Read-only: it never changes tasks, settings or the visible page.
     * Run it any time from DevTools with  evaluateApp()  (alias: evaluatePerformance()).
     * Returns { version, score, grade, checks } for further use.
     */
    evaluateApp() {
      const checks = [];
      const add = (area, item, weight, pass, detail) => {
        checks.push({ area: area, item: item, weight: weight, pass: Boolean(pass), detail: detail });
      };

      /* ---------- 1. 데이터 보존 / 안정성 ---------- */
      const probeKey = 'myTasks.__evaluate__';
      let storageOk = false;
      try {
        window.localStorage.setItem(probeKey, '1');
        storageOk = window.localStorage.getItem(probeKey) === '1';
        window.localStorage.removeItem(probeKey);
      } catch (error) { storageOk = false; }
      add('데이터 안정성', 'localStorage 읽기/쓰기', 10, storageOk,
        storageOk ? '정상 동작' : '저장소 차단됨 (메모리에서만 동작)');

      const savedRaw = SafeStorage.read(STORAGE_KEYS.tasks, null);
      const inSync = storageOk
        ? JSON.stringify(savedRaw) === JSON.stringify(this.store.tasks)
        : true;
      add('데이터 안정성', '화면 데이터 ↔ 저장소 동기화', 10, inSync,
        inSync ? '메모리 ' + this.store.tasks.length + '개 = 저장소 ' + (Array.isArray(savedRaw) ? savedRaw.length : 0) + '개' : '메모리와 저장소 내용이 다름');

      const resanitized = TaskStore.sanitizeList(this.store.tasks);
      const schemaOk = JSON.stringify(resanitized) === JSON.stringify(this.store.tasks);
      add('데이터 안정성', '할 일 데이터 형식 검증', 10, schemaOk,
        schemaOk ? '모든 항목이 검증 규칙 통과' : '검증 규칙에 맞지 않는 항목 있음');

      const ids = this.store.tasks.map((task) => task.id);
      const uniqueIds = new Set(ids).size === ids.length;
      add('데이터 안정성', 'ID 중복 없음', 5, uniqueIds,
        uniqueIds ? ids.length + '개 ID 모두 고유' : '중복 ID 발견');

      // Judged on the start-up snapshot, so later adds / imports never affect it
      const restored = JSON.stringify(this.startSavedTexts) === JSON.stringify(this.startTaskTexts);
      add('데이터 안정성', '새로고침 시 데이터 유지(복원)', 5, restored,
        restored ? '저장된 ' + this.startSavedTexts.length + '개 → 시작 시 ' + this.startTaskTexts.length + '개 복원'
          : '저장된 ' + this.startSavedTexts.length + '개 중 ' + this.startTaskTexts.length + '개만 복원됨');

      /* ---------- 2. DOM 렌더링 속도 ---------- */
      const BENCH_COUNT = 200;
      const now = new Date();
      const sampleTasks = [];
      for (let i = 0; i < BENCH_COUNT; i += 1) {
        sampleTasks.push({
          id: 'bench-' + i,
          text: '렌더링 측정용 항목 ' + (i + 1),
          category: FILTERS[1 + (i % 3)],
          priority: Object.keys(PRIORITIES)[i % 3],
          completed: i % 2 === 0,
          createdAt: new Date(now - i * 60000).toISOString()
        });
      }
      const t0 = performance.now();
      const benchFragment = document.createDocumentFragment(); // detached: page untouched
      sampleTasks.forEach((task) => benchFragment.appendChild(this.createTaskElement(task, now)));
      const benchMs = performance.now() - t0;
      add('렌더링 속도', BENCH_COUNT + '개 항목 생성 시간', 15, benchMs < 100,
        benchMs.toFixed(1) + 'ms (기준 100ms 미만, 항목당 ' + (benchMs / BENCH_COUNT).toFixed(2) + 'ms)');

      const listCount = this.els.list.children.length;
      const expected = this.visibleTasks().length;
      add('렌더링 속도', '목록 DOM ↔ 데이터 일치', 5, listCount === expected,
        '화면 ' + listCount + '개 / 표시 대상 ' + expected + '개');

      /* ---------- 3. XSS 방지 ---------- */
      const payload = '<img src=x onerror="alert(1)"><script>alert(2)<\/script>';
      const probeItem = this.createTaskElement({
        id: 'xss-probe', text: payload, category: 'work', priority: 'high',
        completed: false, createdAt: now.toISOString()
      }, now);
      const probeText = probeItem.querySelector('.task__text');
      const escaped = !probeItem.querySelector('img, script') &&
        probeText && probeText.textContent === payload;
      add('XSS 방지', '사용자 입력을 textContent로만 출력', 15, escaped,
        escaped ? '악성 태그가 글자로만 표시됨' : '태그가 실제 요소로 해석됨');

      let inlineHandlers = 0;
      this.els.list.querySelectorAll('*').forEach((node) => {
        for (let i = 0; i < node.attributes.length; i += 1) {
          if (/^on/i.test(node.attributes[i].name)) inlineHandlers += 1;
        }
      });
      const noScripts = !this.els.list.querySelector('script, iframe, object, embed');
      add('XSS 방지', '목록에 인라인 이벤트/스크립트 없음', 5, inlineHandlers === 0 && noScripts,
        inlineHandlers === 0 && noScripts ? '발견되지 않음' : 'on* 속성 ' + inlineHandlers + '개 발견');

      /* ---------- 4. 접근성 ---------- */
      const nameOf = (node) => {
        const labelledBy = node.getAttribute('aria-labelledby');
        if (labelledBy && document.getElementById(labelledBy)) return true;
        if (node.getAttribute('aria-label')) return true;
        if (node.id && document.querySelector('label[for="' + CSS.escape(node.id) + '"]')) return true;
        if (node.closest('label')) return true;
        return Boolean((node.textContent || '').trim() || node.getAttribute('title'));
      };

      const fields = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="file"]), select, textarea'));
      const unlabeledFields = fields.filter((node) => !nameOf(node));
      add('접근성', '입력 요소 레이블', 5, unlabeledFields.length === 0,
        (fields.length - unlabeledFields.length) + '/' + fields.length + '개 레이블 있음');

      const buttons = Array.from(document.querySelectorAll('button'));
      const unnamedButtons = buttons.filter((node) => !nameOf(node));
      add('접근성', '버튼 접근 가능한 이름', 5, unnamedButtons.length === 0,
        (buttons.length - unnamedButtons.length) + '/' + buttons.length + '개 이름 있음');

      const bar = this.els.progressBar;
      const valueNow = Number(bar.getAttribute('aria-valuenow'));
      const barOk = bar.getAttribute('role') === 'progressbar' && valueNow >= 0 && valueNow <= 100;
      const live = document.querySelectorAll('[aria-live]').length;
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
      const lang = document.documentElement.getAttribute('lang');
      const ariaOk = barOk && live > 0 && Boolean(dialog) && Boolean(lang);
      add('접근성', 'ARIA 역할/상태 (진행률·알림·모달·lang)', 5, ariaOk,
        'progressbar ' + (barOk ? '✓' : '✗') + ' · aria-live ' + live + '곳 · dialog ' + (dialog ? '✓' : '✗') + ' · lang=' + (lang || '없음'));

      const svgs = Array.from(document.querySelectorAll('svg'));
      const decorative = svgs.filter((node) => node.getAttribute('aria-hidden') === 'true' || node.getAttribute('role') === 'img');
      add('접근성', '장식용 아이콘 숨김(aria-hidden)', 5, decorative.length === svgs.length,
        decorative.length + '/' + svgs.length + '개 처리됨');

      /* ---------- Score & report ---------- */
      const total = checks.reduce((sum, c) => sum + c.weight, 0);
      const earned = checks.reduce((sum, c) => sum + (c.pass ? c.weight : 0), 0);
      const score = Math.round((earned / total) * 100);
      const grade = score === 100 ? '최적 상태' : score >= 90 ? '우수' : score >= 70 ? '양호' : '개선 필요';
      const color = score === 100 ? '#16a34a' : score >= 70 ? '#d97706' : '#dc2626';

      if (window.console) {
        console.log('%c현재 버전 스크립트 평가 결과: ' + score + '점 (' + grade + ')',
          'font-size:14px;font-weight:700;color:' + color + ';');
        console.log('My Tasks v' + APP_VERSION + ' · 할 일 ' + this.store.tasks.length + '개 · ' +
          new Date().toLocaleString('ko-KR') + ' · 다시 실행: evaluateApp()');
        if (console.table) {
          console.table(checks.map((c) => ({
            '영역': c.area,
            '항목': c.item,
            '결과': c.pass ? '✅ 통과' : '❌ 실패',
            '배점': (c.pass ? c.weight : 0) + '/' + c.weight,
            '세부 내용': c.detail
          })));
        }
        const failed = checks.filter((c) => !c.pass);
        if (failed.length) {
          console.warn('개선이 필요한 항목:\n' + failed.map((c) => '- [' + c.area + '] ' + c.item + ': ' + c.detail).join('\n'));
        } else {
          console.log('모든 항목을 통과했어요. 데이터·렌더링·보안·접근성 모두 정상입니다.');
        }
      }

      return { version: APP_VERSION, score: score, grade: grade, checks: checks };
    }
  }

  /* ============================== Start ============================== */

  function start() {
    try {
      const app = new TodoApp();
      app.init();
      // Console entry points for the self-check (the app itself stays private)
      window.evaluateApp = () => app.evaluateApp();
      window.evaluatePerformance = window.evaluateApp;
    } catch (error) {
      // Last-resort message so the page is never silently blank
      const main = document.querySelector('.app');
      if (main) {
        const note = el('p', { className: 'composer__hint', text: '앱을 시작하지 못했어요. 페이지를 새로고침해 주세요. (' + error.message + ')' });
        main.appendChild(note);
      }
      if (window.console) console.error(error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
