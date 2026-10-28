/* =====================================================================
 * File    : Week05-06-SmartTodo/week06/ui.js
 * Purpose : 6주차 데스크톱 사이드바 화면에만 있는 부분
 *           공통 로직(../core.js)이 렌더링할 때 아래 훅을 호출합니다.
 *   renderOverall(pct)        사이드바 진행률 링(#overallRing)의 --pct 값
 *   renderFilterTitle(filter) 가운데 목록 제목(#listTitle)
 * ===================================================================== */
'use strict';

const FILTER_TITLES = { all: '전체 할 일', active: '진행 중', done: '완료됨' };

window.TodoLayout = {
  renderOverall(pct) {
    const ring = document.getElementById('overallRing');
    if (ring) ring.style.setProperty('--pct', pct);
  },
  renderFilterTitle(filter) {
    const title = document.getElementById('listTitle');
    if (title) title.textContent = FILTER_TITLES[filter] || `${filter} 할 일`;
  }
};
