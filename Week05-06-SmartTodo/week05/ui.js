/* =====================================================================
 * File    : Week05-06-SmartTodo/week05/ui.js
 * Purpose : 5주차 모바일 중심 화면에만 있는 부분
 *           공통 로직(../core.js)이 렌더링할 때 아래 훅을 호출합니다.
 *   renderOverall(pct)  전체 진행률 → 가로 막대(#overallBar) 너비
 * ===================================================================== */
'use strict';

window.TodoLayout = {
  renderOverall(pct) {
    const bar = document.getElementById('overallBar');
    if (bar) bar.style.width = pct + '%';
  }
};
