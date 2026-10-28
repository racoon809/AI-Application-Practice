# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code에게 프로젝트 정보를 제공합니다.

## 프로젝트 개요
- 이름: 스마트 할 일 관리 앱 (인공지능활용실습 5~6주차, Week05-06-SmartTodo). 4주차 원본은 `../Week04-TodoApp/`
- 목표: 매일 할 일을 기록하고 업무/개인/공부 카테고리별로 관리하는 웹 앱
- 기술: 순수 HTML, CSS, JavaScript (프레임워크·빌드 도구 없음)
- 실행: `week05/index.html` 또는 `week06/index.html`을 브라우저에서 열기 (서버 불필요)
- 테스트: `node --test` (Node.js 18 이상, `tests/core.test.js`)

## 파일 구조
- `core.js` — 두 화면 공통 로직 (상태, CRUD, 렌더링, 자동 분류, 다크 모드, JSON 입출력)
- `week05/` — 모바일 중심 화면 (`index.html`, `style.css`, `ui.js`: 진행률 막대)
- `week06/` — 데스크톱 사이드바 화면 (`index.html`, `style.css`, `ui.js`: 진행률 링, 목록 제목)
- 각 `index.html`은 `../core.js` → `ui.js` 순서로 불러옴
- `ui.js`는 `window.TodoLayout = { renderOverall(pct), renderFilterTitle(filter) }` 형태로 훅만 등록

## 데이터
- localStorage 키: `todoApp.todos.v1`(할 일), `todoApp.settings.v1`(분류 설정), `todoApp.theme`
- 할 일 객체: `{ id, text, category('업무'|'개인'|'공부'), done, createdAt, completedAt, autoClassified }`

## 키워드 기반 자동 카테고리 분류 (5주차)
- `DEFAULT_KEYWORDS` 사전 + 사용자 키워드(`settings.customKeywords`)로 점수 계산 → `analyzeText()`
- 3글자 이상 키워드는 가중치 1.5, 동점이면 추천하지 않음
- `settings.mode`: `confirm`(추천 확인 창) / `auto`(바로 적용)
- 예: 회의·개발·회사 → 업무 / 집·운동·영화 → 개인 / 시험·과제·강의 → 공부

## 작업 규칙
- 중요: 두 화면 공통 기능은 `core.js`에만 작성하고, 한 화면에만 있는 표시는 그 폴더의 `ui.js` 훅으로 작성할 것 (파일 복사 금지)
- `core.js`를 고친 뒤 `node --test`로 분류 로직 테스트 통과 확인
- 화면에 없는 요소는 `$()` 결과를 확인한 뒤 건너뛰도록 작성 (두 레이아웃 공용)
- 브라우저 기본 `alert/confirm` 대신 `<dialog>`와 토스트 사용
- 파일·폴더 이름은 영문, 숫자, `-`, `_`만 사용
