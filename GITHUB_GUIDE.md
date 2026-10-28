# GitHub 업로드 가이드 (Windows 기준)

## 0. 준비 (처음 한 번만)
1. Git 설치: https://git-scm.com → 기본 옵션으로 설치
2. 명령 프롬프트에서 사용자 정보 등록
```bash
git config --global user.name "서승하"
git config --global user.email "깃허브 가입 이메일"
git config --global core.quotepath false
```
3. GitHub 저장소: https://github.com/racoon809/AI-Application-Practice
   - 새로 만들 때는 오른쪽 위 **+ → New repository** → Repository name `AI-Application-Practice`, **Public**, README 추가 체크는 하지 않기 (이미 있음)

## 1. 폴더 배치
압축을 풀어 `C:\AI-Application-Practice`처럼 **짧은 영문 경로**에 둡니다. 1주차부터 8주차까지 아래 6개 폴더가 모두 들어 있습니다.

| 폴더 | 주차 |
|---|---|
| `Week01-StartPage` | 1 |
| `Week02-Portfolio` | 2 |
| `Week03-DigitRecognition` | 3 |
| `Week04-TodoApp` | 4 |
| `Week05-06-SmartTodo` | 5 (`week05/`) · 6 (`week06/`) |
| `Week07-08-QuizGame` | 7 · 8 (`.claude/commands/`) |

## 2. 주차별로 커밋하기
`AI-Application-Practice` 폴더에서 주소창에 `cmd` 입력 → Enter

```bash
git init
git branch -M main

git add README.md .gitignore .gitattributes .nojekyll GITHUB_GUIDE.md
git commit -m "docs: 저장소 소개와 폴더 구조"

git add Week01-StartPage
git commit -m "week01: 클로드 아티팩트 시작 홈페이지 (시계·날씨·검색·기술 뉴스)"

git add Week02-Portfolio
git commit -m "week02: PRD와 4단계 전략으로 마케팅 포트폴리오 제작"

git add Week03-DigitRecognition
git commit -m "week03: 손글씨 인식 프로그램 (데스크톱·웹, 테스트 50개)"

git add Week04-TodoApp
git commit -m "week04: 단계별 프롬프트로 만든 할 일 관리 앱 (제출 원본)"

git add Week05-06-SmartTodo/core.js Week05-06-SmartTodo/week05 Week05-06-SmartTodo/tests Week05-06-SmartTodo/CLAUDE.md Week05-06-SmartTodo/README.md
git commit -m "week05: 키워드 기반 자동 카테고리 분류 (공통 core.js)"

git add Week05-06-SmartTodo/week06
git commit -m "week06: 데스크톱 사이드바 레이아웃 (core.js 공유, ui.js)"

git add Week07-08-QuizGame/index.html Week07-08-QuizGame/style.css Week07-08-QuizGame/script.js Week07-08-QuizGame/quiz-data.js Week07-08-QuizGame/CLAUDE.md Week07-08-QuizGame/README.md
git commit -m "week07: 상식 퀴즈 40문제 + 교차 검증 가이드라인"

git add Week07-08-QuizGame/.claude
git commit -m "week08: 퀴즈 커스텀 명령어 quiz-validate · quiz-range · quiz-add"
```

> `.claude` 폴더는 점(.)으로 시작해 탐색기에서 숨겨질 수 있습니다. `git status`로 `Week07-08-QuizGame/.claude/commands/` 3개 파일이 올라갔는지 꼭 확인하세요.

### 이미 예전 폴더 이름으로 올린 저장소라면
예전 이름(한글 폴더)으로 이미 push했다면, 저장소 폴더에서 예전 폴더를 지우고 새 폴더를 넣은 뒤 한 번에 커밋합니다. Git이 이름 변경으로 인식합니다.
```bash
git add -A
git commit -m "refactor: 폴더 이름을 WeekNN 규칙으로 통일, 링크·경로 정리"
git push
```

## 3. GitHub에 올리기
```bash
git remote add origin https://github.com/racoon809/AI-Application-Practice.git
git push -u origin main
```
처음 push할 때 브라우저 로그인 창이 뜨면 GitHub 계정으로 로그인합니다.

## 4. (선택) GitHub Pages로 웹 게시
저장소 **Settings → Pages → Source: Deploy from a branch → Branch: `main`, `/(root)` → Save**
1~2분 뒤 https://racoon809.github.io/AI-Application-Practice/Week01-StartPage/ 로 접속합니다.
루트의 빈 `.nojekyll` 파일이 Jekyll 변환을 막아 파일이 그대로 게시됩니다. 지웠다면 `type nul > .nojekyll`로 다시 만드세요.

## 5. 이후 수정할 때
```bash
git add .
git commit -m "fix: 수정한 내용"
git push
```

## 자주 생기는 문제
| 증상 | 해결 |
|---|---|
| `fatal: not a git repository` | `AI-Application-Practice` 폴더 안에서 명령을 실행했는지 확인 |
| `remote origin already exists` | 이미 연결된 저장소 → `git remote -v`로 주소 확인 후 바로 `git push` |
| `rejected ... fetch first` | 저장소를 만들 때 README를 체크한 경우 → `git pull origin main --allow-unrelated-histories` 후 다시 push |
| 한글 파일명이 깨짐 | `git config --global core.quotepath false` |
| `.claude` 폴더가 안 보임 | 탐색기 **보기 → 표시 → 숨긴 항목** 체크 |

## 제출 전 마지막 확인
아티팩트 공개, GitHub Pages 활성화, 숨김 폴더 포함, 테스트 통과 여부는 [README의 최종 제출 체크리스트](README.md#채점자를-위한-최종-제출-체크리스트-및-실행-안내)를 따라 확인하세요.
