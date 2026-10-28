/* =====================================================================
 * File    : Week05-06-SmartTodo/tests/core.test.js
 * Purpose : core.js 의 5주차 자동 분류 로직 단위 테스트 (DOM 없이 실행)
 * Run     : cd Week05-06-SmartTodo  ->  node --test
 *           (Node.js 18 이상, 별도 설치 없음)
 * ===================================================================== */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');

test.beforeEach(() => core.setSettings({ customKeywords: { 업무: [], 개인: [], 공부: [] } }));

test('README 확인 포인트: 회사 스케줄 → 업무', () => {
  const r = core.analyzeText('내일 회사 스케줄 확인');
  assert.equal(r.category, '업무');
  assert.deepEqual(r.matched.업무, ['회사', '스케줄']);
});

test('README 확인 포인트: 영화 → 개인, 중간고사 공부 → 공부', () => {
  assert.equal(core.analyzeText('영화 보러 가기').category, '개인');
  assert.equal(core.analyzeText('중간고사 공부').category, '공부');
});

test('일치하는 키워드가 없으면 추천하지 않음', () => {
  const r = core.analyzeText('우유 사기');
  assert.equal(r.category, null);
  assert.deepEqual(r.scores, { 업무: 0, 개인: 0, 공부: 0 });
});

test('동점이면 추천하지 않음', () => {
  assert.equal(core.analyzeText('회의 끝나고 운동').category, null);
});

test('3글자 이상 키워드는 가중치 1.5', () => {
  assert.equal(core.analyzeText('프로젝트').scores.업무, 1.5);
  assert.equal(core.analyzeText('회의').scores.업무, 1);
});

test('영문 대소문자·공백 차이를 무시', () => {
  core.setSettings({ customKeywords: { 업무: ['Jira'], 개인: [], 공부: [] } });
  assert.equal(core.analyzeText('  JIRA   티켓 정리 ').category, '업무');
});

test('사용자 키워드가 기본 사전에 합쳐지고 중복은 제거됨', () => {
  core.setSettings({ customKeywords: { 업무: [], 개인: ['낚시', '집'], 공부: [] } });
  const dict = core.getKeywordDictionary();
  assert.ok(dict.개인.includes('낚시'));
  assert.equal(dict.개인.filter((k) => k === '집').length, 1);
  assert.equal(core.analyzeText('주말 낚시').category, '개인');
});

test('자동 재분류 후보는 카테고리가 바뀌는 항목만', () => {
  core.setTodos([
    { id: 1, text: '팀 회의 자료 정리', category: '개인', done: false, createdAt: 1 },
    { id: 2, text: '저녁에 운동하기', category: '개인', done: false, createdAt: 2 },
    { id: 3, text: '우유 사기', category: '업무', done: false, createdAt: 3 }
  ]);
  const ids = core.findReclassifyCandidates().map((c) => [c.todo.id, c.result.category]);
  assert.deepEqual(ids, [[1, '업무']]);
});

test('필터·검색·정렬이 함께 적용됨', () => {
  core.setTodos([
    { id: 1, text: 'b 회의', category: '업무', done: true, createdAt: 1 },
    { id: 2, text: 'a 보고서', category: '업무', done: false, createdAt: 2 },
    { id: 3, text: '운동', category: '개인', done: false, createdAt: 3 }
  ]);
  core.setView({ filter: '업무', search: '', sort: 'alpha' });
  assert.deepEqual(core.visibleTodos().map((t) => t.id), [2, 1]);
  core.setView({ filter: 'active', search: '', sort: 'oldest' });
  assert.deepEqual(core.visibleTodos().map((t) => t.id), [2, 3]);
  core.setView({ filter: 'all', search: '보고', sort: 'newest' });
  assert.deepEqual(core.visibleTodos().map((t) => t.id), [2]);
});
