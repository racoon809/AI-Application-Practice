# 3주차 · 손글씨 숫자 인식 프로그램 (`Week03-DigitRecognition`)

> 제출자 서승하 (243441) · 컴퓨터공학과 3학년 · GitHub [racoon809](https://github.com/racoon809) · 제출일 2026-10-28 · [전체 목차](../README.md)

마우스로 그린 0~9 숫자를 신경망이 인식해 **예측 숫자, 신뢰도, 0~9별 확률 막대**를 보여 주는 프로그램입니다.
MNIST 데이터세트(28×28 흑백 손글씨 숫자 7만 장)로 학습한 784 → 128 → 10 신경망을 쓰며, Claude Code로 **데스크톱 버전**과 **웹 버전**을 나누어 만들었습니다.

## 폴더 구조

```
Week03-DigitRecognition/
├── README.md                        이 문서
├── CLAUDE.md                        공통 규칙 (/init 생성 + # 으로 추가한 규칙)
├── requirements.txt                 두 버전 공통 라이브러리
├── pytest.ini                       테스트 두 폴더를 한 번에 실행
├── .gitignore                       학습 캐시 제외
├── tests/test_parity.py             데스크톱 ↔ 웹 전처리 일치 테스트
├── desktop_version/
│   ├── CLAUDE.md                    데스크톱 전용 규칙 (ADR 12개)
│   ├── digit_recognition.py         실행 진입점 (옵션 처리 → 창 열기)
│   ├── preprocess.py                획 → 28×28 입력 (순수 함수, tkinter 없음)
│   ├── model.py                     MNIST 캐시 · NumPy 신경망 · 학습
│   ├── gui.py                       Tkinter 창 · 그리기 패드 · 확률 차트
│   ├── run_digit_recognition.bat    ▶ 더블 클릭 실행
│   ├── install_requirements.bat     라이브러리 설치 (numpy, pillow, pytest)
│   ├── requirements.txt
│   └── tests/test_preprocess.py     전처리·신경망 테스트 43개
└── web_version/
    ├── CLAUDE.md                    웹 전용 규칙
    ├── index.html · style.css · app.js   Canvas 그리기, 전처리, 예측
    ├── model.js                     학습된 가중치 (서버 없이 실행 가능)
    ├── server.py                    로컬 서버 + 모델 학습 (scikit-learn)
    ├── run_web_server.bat           ▶ 더블 클릭 → http://localhost:8000
    └── requirements.txt
```

| 버전 | 기술 | 모델 |
|---|---|---|
| 데스크톱 | Python Tkinter, NumPy, Pillow | NumPy로 직접 구현한 MLP, 가중치를 `mnist_mlp_weights.npz`로 저장 |
| 웹 | HTML5 Canvas, JavaScript, Python `http.server` | scikit-learn `MLPClassifier`로 학습해 `model.js`로 내보냄 (테스트 정확도 98.14%) |

**두 방식을 함께 쓰는 이유:** 데스크톱은 NumPy·Pillow만으로 실행되도록 신경망을 직접 구현했고, 웹은 설치·서버 없이 브라우저(GitHub Pages)에서 바로 예측하도록 scikit-learn으로 학습한 가중치를 `model.js`로 내보냈습니다. 두 버전이 신경망에 넣는 28×28 입력이 같은지는 `tests/test_parity.py`가 확인합니다.

## 실행 환경
- Windows 10/11
- Python **3.10 이상** — 설치할 때 **Add python.exe to PATH** 체크 (Tkinter는 Python에 기본 포함)
- 처음 실행할 때 인터넷 연결 필요 (MNIST 데이터 다운로드)

```bat
python --version
```

## 데스크톱 버전 실행

### 방법 1 · 배치 파일 더블 클릭
1. `desktop_version` 폴더를 탐색기에서 엽니다.
2. **처음 한 번** `install_requirements.bat`을 더블 클릭해 라이브러리를 설치합니다.
3. `run_digit_recognition.bat`을 더블 클릭합니다.
4. 처음 실행하면 MNIST를 내려받아 `mnist.npz`로 저장하고 모델을 학습합니다. 진행 상황이 창에 표시되며, 끝나면 바로 그릴 수 있습니다. 두 번째부터는 저장된 가중치를 써서 바로 열립니다.

`run_digit_recognition.bat`이 알아서 해 주는 일
- 실행 위치와 상관없이 배치 파일이 있는 폴더로 이동 (`cd /d "%~dp0"`)
- `python`이 없으면 `py -3`를 찾아 사용, 둘 다 없으면 설치 안내 후 멈춤
- numpy·Pillow가 없으면 `install_requirements.bat`을 자동 호출
- 오류로 끝나면 창이 바로 닫히지 않게 `pause`

### 방법 2 · 명령어
```bat
cd Week03-DigitRecognition
pip install -r requirements.txt
cd desktop_version
python digit_recognition.py
```
| 옵션 | 설명 |
|---|---|
| `python digit_recognition.py --retrain` | 저장된 가중치를 무시하고 새로 학습 |
| `python digit_recognition.py --epochs 15` | 학습 횟수 변경 (기본 10) |
| `python -m pytest -q` | 전처리·신경망 테스트 43개 (tkinter가 없는 환경에서도 실행됨) |

### 사용법
- 흰 상자에 마우스로 숫자를 그리면 획을 그을 때마다 예측이 갱신됩니다.
- **[Recognize]** 또는 `Enter`: 인식 · **[Clear]** 또는 `Esc`: 지우기 · `Ctrl + Z`: 마지막 획 취소

## 웹 버전 실행

| 방법 | 실행 | 설명 |
|---|---|---|
| ① 서버 없이 | `web_version/index.html` 더블 클릭 | `model.js`에 저장된 가중치로 바로 예측. 설치 불필요, GitHub Pages에서도 동작 (https://racoon809.github.io/AI-Application-Practice/Week03-DigitRecognition/web_version/) |
| ② 배치 파일 | `web_version/run_web_server.bat` 더블 클릭 | numpy·scikit-learn·pandas가 없으면 자동 설치 → 서버 시작 → 브라우저가 `http://localhost:8000`을 자동으로 엶 |
| ③ 명령어 | 아래 참고 | 포트 변경 등 옵션 사용 |
| ④ 정적 서버 | `python -m http.server 8000` | 라이브러리 설치 없이 `http://localhost:8000` 에서 `model.js` 로 예측 |

```bat
cd Week03-DigitRecognition\web_version
python -m pip install -r requirements.txt
python server.py
```
| 옵션 | 뜻 |
|---|---|
| `python server.py --port 5000` | 다른 포트 사용 (8000이 사용 중이면 8001, 8002…를 자동으로 찾음) |
| `python server.py --no-browser` | 브라우저 자동 열기 끄기 |
| `python server.py --retrain` | `model.js`를 무시하고 새로 학습 |

서버는 터미널 창을 닫거나 `Ctrl + C`로 종료합니다.

> `run_web_server.bat`이 실행되지 않으면 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)를 단계별로 확인하세요. (Python PATH, 라이브러리 설치, 포트 충돌, 수동 실행)
> `app.js`는 `/api/status`가 없는 정적 서버(`python -m http.server`, GitHub Pages)에서 자동으로 `model.js`를 쓰도록 2026-10-28에 수정했습니다.

## 테스트

`Week03-DigitRecognition` 폴더에서 한 번에 실행합니다.
```bat
python -m pytest -q
```
| 테스트 | 개수 | 확인 내용 |
|---|---|---|
| `desktop_version/tests/test_preprocess.py` | 43 | 색 반전, 크롭, 20×20 정규화, 무게중심 정렬, 빈 캔버스, softmax, 가중치 저장·복원, **tkinter 없이 import 가능** |
| `tests/test_parity.py` | 7 | 같은 획을 Python(`preprocess.py`)과 헤드리스 Chromium(`app.js`)으로 전처리해 비교: 무게중심 차이 0.5px 이하, 평균 픽셀 차이 0.04 미만, 6개 숫자 모두 정답 예측 |

`test_parity.py`는 Playwright와 Chromium이 필요합니다. 설치되어 있지 않으면 자동으로 건너뜁니다(skip).
```bat
pip install playwright
python -m playwright install chromium
```
실측값: 무게중심 차이 최대 0.11px, 평균 픽셀 차이 최대 0.016

## 라이브러리 (`requirements.txt`)

| 파일 | 내용 | 용도 |
|---|---|---|
| `requirements.txt` (루트) | numpy, pillow, scikit-learn, pandas, pytest | 두 버전 전체 |
| `desktop_version/requirements.txt` | numpy, pillow, pytest | 데스크톱만 |
| `web_version/requirements.txt` | numpy, scikit-learn, pandas | 웹 서버만 |

```bat
pip install -r requirements.txt
```
여러 프로젝트의 라이브러리가 섞이지 않게 가상 환경을 써도 됩니다.
```bat
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```
(`venv/`는 루트 `.gitignore`로 제외됩니다.)

## 실습 과정 (사용한 프롬프트)
```
손글씨로 숫자를 입력하면 이것을 인식하는 코드를 만들어서 실행해 줘. 모든 코드와 주석을 영어로 작성해 줘.
```
```
숫자 인식 프로그램을 윈도우 탐색기에서 클릭해서 실행할 수 있게 해 줘.
```
```
/init
```
```
# 앞으로 만드는 모든 파일은 날짜와 시간을 주석으로 표시해 줘.
```
```
손글씨 인식 프로그램을 웹 버전과 데스크톱 버전으로 나누어 개발하고 싶어. web_version과 desktop_version 폴더를 만들고, 각 폴더에 해당하는 CLAUDE.md 파일도 생성해 줘.
```
```
웹 버전 프로그램을 브라우저에서 실행해 줘.
```
- 루트 `CLAUDE.md`에는 공통 규칙, 각 버전 폴더의 `CLAUDE.md`에는 버전별 규칙을 둔 **계층적 구조**입니다.
- `#` 규칙에 따라 모든 파일 머리에 작성·수정 날짜와 시간이 주석으로 들어 있습니다.

## Git에서 제외되는 파일
`Week03-DigitRecognition/.gitignore`가 실행 중에 만들어지는 파일을 제외합니다. 지워져도 다시 실행하면 새로 만들어집니다.
- `desktop_version/mnist.npz` (내려받은 데이터), `desktop_version/mnist_mlp_weights.npz` (학습된 가중치)
- `.pytest_cache/`, `__pycache__/`, `web_version/model.js.tmp`

`web_version/model.js`(약 2MB)는 서버 없이 `index.html`을 열 때 필요하므로 **저장소에 포함**합니다.

## 자주 생기는 문제
| 증상 | 해결 |
|---|---|
| `Python was not found` | Python 설치 시 **Add python.exe to PATH** 체크 후 재설치 |
| 데이터 다운로드 실패 | 인터넷 연결 확인 후 다시 실행 (한 번 받으면 `mnist.npz`로 저장됨) |
| `localhost:8000`이 이미 사용 중 | `python server.py --port 5000` |
| 배치 파일 창이 바로 닫힘 | 명령 프롬프트에서 `.bat` 파일 이름을 직접 입력해 오류 메시지 확인 |
| 한글 경로 오류 | `C:\AI-Application-Practice\Week03-DigitRecognition`처럼 영문 경로로 옮겨 실행 |
