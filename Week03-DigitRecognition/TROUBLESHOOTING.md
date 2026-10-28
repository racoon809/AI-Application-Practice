# run_web_server.bat 트러블슈팅 (3주차 웹 버전)

손글씨 인식 프로그램 **웹 버전**의 `run_web_server.bat`을 더블 클릭했는데 아무 일도 없거나, 창이 바로 닫히거나, 브라우저에 화면이 안 뜰 때 순서대로 확인하는 가이드입니다.

## 0. 정상일 때 배치 파일이 하는 일

`web_version\run_web_server.bat` 은 아래 순서로 동작합니다. **어느 단계에서 멈췄는지** 찾는 것이 해결의 출발점입니다.

| 순서 | 배치 파일 동작 | 실패하면 보이는 증상 |
|---|---|---|
| ① | `cd /d "%~dp0"` — 배치 파일이 있는 폴더로 이동 | `server.py`를 찾지 못함 |
| ② | `python --version` → 안 되면 `py -3 --version` 으로 Python 찾기 | `Python was not found. Install Python 3.10 or newer ...` |
| ③ | `import numpy, sklearn, pandas` 확인 → 없으면 `pip install -r requirements.txt` | `ModuleNotFoundError`, pip 오류 |
| ④ | `python server.py` — `http://localhost:8000` 서버 시작 | 포트 오류, 창이 닫힘 |
| ⑤ | 1초 뒤 기본 브라우저로 `http://localhost:8000` 열기 | 브라우저가 안 열림 |

## 1. 증상별 빠른 진단표

| 증상 | 가장 흔한 원인 | 바로 가기 |
|---|---|---|
| 검은 창이 번쩍하고 사라짐 | 압축 파일 안에서 실행, 또는 오류 메시지를 못 봄 | [단계 1](#단계-1-압축을-풀고-실행했는지-확인), [단계 5](#단계-5-오류-메시지를-눈으로-확인) |
| "Windows의 PC 보호" 파란 창 | 인터넷에서 받은 파일 차단 | [단계 2](#단계-2-windows-보호-창과-파일-차단-해제) |
| `Python was not found` | Python 미설치 또는 PATH 미등록 | [단계 3](#단계-3-python-설치와-path-설정) |
| Microsoft Store가 열림 | 앱 실행 별칭이 가짜 `python`을 가로챔 | [단계 3-3](#3-3-microsoft-store가-열리면-앱-실행-별칭-끄기) |
| `No module named 'sklearn'` 등 | 라이브러리 설치 실패 | [단계 4](#단계-4-필수-라이브러리-설치-requirementstxt) |
| `Port 8000 is busy` | 다른 프로그램이 8000번 포트 사용 | [단계 6](#단계-6-포트-충돌-해결) |
| 서버는 켜졌는데 브라우저가 안 열림 | 기본 브라우저 설정 | [단계 7](#단계-7-브라우저가-열리지-않을-때) |
| bat 말고 직접 실행하고 싶음 | — | [단계 8](#단계-8-수동-실행-방법) |

## 단계 1. 압축을 풀고 실행했는지 확인

Windows는 `.zip` 파일을 폴더처럼 열어 보여 주지만, **그 안에서 `.bat`을 실행하면 임시 폴더에 배치 파일 하나만 풀려서** 옆에 있는 `server.py`, `requirements.txt`를 찾지 못합니다.

1. `.zip` 파일을 마우스 오른쪽 버튼 → **[압축 풀기]** (또는 **[모두 압축 풀기]**)
2. 풀린 폴더의 `Week03-DigitRecognition\web_version` 에서 `run_web_server.bat` 실행
3. 탐색기 주소창이 `...\AppData\Local\Temp\...` 로 시작한다면 아직 압축 안에서 실행 중인 것입니다.

> **권장 위치** `C:\AI-Application-Practice\Week03-DigitRecognition\web_version` 처럼 **짧은 영문 경로**. OneDrive와 동기화되는 바탕화면이나 한글·공백이 많은 경로는 피하세요.

## 단계 2. Windows 보호 창과 파일 차단 해제

인터넷(메일·카카오톡·GitHub)에서 받은 `.bat` 파일은 Windows가 막을 수 있습니다.

- **"Windows의 PC 보호"** 창이 뜨면 → **[추가 정보]** → **[실행]**
- 아무 반응이 없다면 → 파일 마우스 오른쪽 → **[속성]** → 아래쪽 **[차단 해제]** 체크 → **[확인]**
- 백신 프로그램이 막았다면 해당 폴더를 검사 예외로 추가하거나 [단계 8](#단계-8-수동-실행-방법)의 수동 실행을 사용합니다.

## 단계 3. Python 설치와 PATH 설정

**PATH**는 Windows가 명령어(`python`, `pip`)를 찾으러 가는 폴더 목록입니다. Python을 설치했어도 PATH에 없으면 명령 프롬프트와 배치 파일은 `python`을 찾지 못합니다.

### 3-1. 설치 여부 확인
**[시작]** → `cmd` 입력 → 명령 프롬프트에서:
```bat
python --version
py -3 --version
where python
```
| 결과 | 의미 | 다음 행동 |
|---|---|---|
| `Python 3.12.x` 처럼 버전이 나옴 | 정상 | [단계 4](#단계-4-필수-라이브러리-설치-requirementstxt)로 |
| `py -3`만 버전이 나옴 | Python은 있고 PATH만 없음 | 배치 파일은 `py -3`로 동작함. 직접 명령할 때는 `py -3` 사용 또는 3-2 진행 |
| `'python'은(는) 내부 또는 외부 명령...이 아닙니다` | 미설치 또는 PATH 없음 | 3-2 진행 |
| Microsoft Store가 열림 | 앱 실행 별칭 문제 | 3-3 진행 |

### 3-2. Python 다시 설치하며 PATH 등록 (가장 확실)
1. https://www.python.org/downloads/ 에서 Windows 설치 파일을 받습니다. 라이브러리 호환성을 위해 **3.11 또는 3.12** 를 권장합니다. (3.10 이상이면 동작)
2. 설치 첫 화면 아래의 **☑ Add python.exe to PATH** 를 **반드시 체크** → **Install Now**
3. 설치가 끝나면 **열려 있던 명령 프롬프트를 모두 닫고** 새로 엽니다. (PATH는 새 창에서만 반영됨)
4. `python --version` 으로 확인

이미 설치되어 있다면 설치 파일을 다시 실행해 **[Modify]** → 다음 화면에서 **Add Python to environment variables** 를 체크해도 됩니다.

### 3-2-1. 직접 PATH에 추가하는 방법
1. **[시작]** → `환경 변수` 검색 → **[시스템 환경 변수 편집]** → **[환경 변수]**
2. 위쪽 **사용자 변수**의 **Path** 선택 → **[편집]** → **[새로 만들기]** 로 두 줄 추가 (버전 번호는 설치한 버전에 맞게)
```text
%LOCALAPPDATA%\Programs\Python\Python312\
%LOCALAPPDATA%\Programs\Python\Python312\Scripts\
```
3. **[확인]** 으로 모두 닫고 명령 프롬프트를 새로 열어 `python --version` 확인

> 설치 위치를 모르겠다면 `py -3 -c "import sys; print(sys.executable)"` 로 python.exe 경로를 확인할 수 있습니다.

### 3-3. Microsoft Store가 열리면 앱 실행 별칭 끄기
Python이 없는 상태에서 Windows는 `python`을 입력하면 Store로 안내하는 **가짜 python** 을 실행합니다. 이것이 진짜 Python보다 먼저 잡히면 오류가 납니다.
1. **[설정]** → **[앱]** → **[고급 앱 설정]** → **[앱 실행 별칭]**
2. **앱 설치 관리자 python.exe**, **python3.exe** 두 항목을 **끔**
3. 명령 프롬프트를 새로 열어 `python --version` 확인 (Python이 설치되어 있어야 함)

## 단계 4. 필수 라이브러리 설치 (requirements.txt)

웹 버전 서버에는 **numpy, scikit-learn, pandas** 가 필요합니다. 배치 파일이 자동으로 설치를 시도하지만, 실패하면 직접 설치합니다.

### 4-1. requirements.txt란?
프로젝트에 필요한 라이브러리 이름과 버전을 적어 둔 파일입니다. 한 줄 명령으로 같은 환경을 재현할 수 있습니다.
```text
numpy>=1.24
scikit-learn>=1.3
pandas>=2.0
```

### 4-2. 직접 설치
```bat
cd /d C:\AI-Application-Practice\Week03-DigitRecognition\web_version
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```
- `pip` 대신 **`python -m pip`** 을 쓰면 PATH에 `Scripts` 폴더가 없어도 동작하고, 지금 쓰는 Python에 정확히 설치됩니다.
- PATH 없이 `py`만 될 때: `py -3 -m pip install -r requirements.txt`
- 데스크톱·웹 두 버전을 모두 쓰려면 상위 폴더에서: `cd ..` → `python -m pip install -r requirements.txt`

### 4-3. 설치 확인
```bat
python -c "import numpy, sklearn, pandas; print('OK')"
```
`OK` 가 나오면 성공입니다.

### 4-4. 설치가 실패할 때
| 오류 메시지 | 해결 |
|---|---|
| `Could not find a version that satisfies the requirement` / 빌드 오류 | Python 버전이 너무 새로워 미리 빌드된 패키지가 없을 수 있음 → **3.11/3.12** 설치 후 재시도 |
| `Failed to establish a new connection`, 시간 초과 | 인터넷·학교 와이파이 확인, 다른 네트워크에서 재시도 |
| `Permission denied`, `Access is denied` | `python -m pip install --user -r requirements.txt` |
| `'pip'은(는) 내부 또는 외부 명령이 아닙니다` | `python -m pip ...` 형태로 실행 |

> **선택: 가상 환경** 다른 과목 라이브러리와 섞이지 않게 하려면
> ```bat
> python -m venv venv
> venv\Scripts\activate
> python -m pip install -r requirements.txt
> ```
> 가상 환경을 쓰면 서버도 활성화한 창에서 `python server.py` 로 실행해야 합니다.

## 단계 5. 오류 메시지를 눈으로 확인

더블 클릭으로 실행하면 오류가 나도 창이 금방 닫혀 원인을 보기 어렵습니다. **명령 프롬프트에서 배치 파일을 직접 실행**하면 메시지가 남습니다.
```bat
cd /d C:\AI-Application-Practice\Week03-DigitRecognition\web_version
run_web_server.bat
```
화면에 나온 마지막 몇 줄의 영어 메시지로 위 진단표를 다시 확인하세요.

### 깃허브에서 받은 뒤 bat이 이상하게 동작할 때 (줄바꿈 문제)
배치 파일은 Windows 줄바꿈(CRLF)이어야 안정적으로 동작합니다. GitHub의 **[Download ZIP]** 이나 일부 Git 설정으로 받으면 줄바꿈이 LF로 바뀌어 괄호 블록이 오작동할 수 있습니다. 저장소 루트에 `.gitattributes` 파일을 두면 항상 CRLF로 받아집니다.
```text
*.bat text eol=crlf
```

## 단계 6. 포트 충돌 해결

**포트**는 한 컴퓨터 안의 여러 프로그램이 통신할 때 쓰는 번호입니다. 8000번을 다른 프로그램이 이미 쓰고 있으면 서버를 열 수 없습니다.

- `server.py`는 8000번이 사용 중이면 **8001, 8002 … 순서로 빈 포트를 자동으로 찾습니다**. 창에 나온 `Open in your browser: http://localhost:8001` 주소를 확인하세요.
- 직접 포트를 지정: `python server.py --port 5000`
- 8000번을 누가 쓰는지 확인:
```bat
netstat -ano | findstr :8000
tasklist | findstr <위 결과 마지막 숫자(PID)>
```
- 이전에 켜 둔 서버 창이 남아 있다면 그 창에서 `Ctrl + C` 를 누르거나 창을 닫습니다.

## 단계 7. 브라우저가 열리지 않을 때

- 서버 창에 `Open in your browser: http://localhost:8000` 이 보이면 서버는 정상입니다. 브라우저 주소창에 그 주소를 **직접 입력**하세요.
- 화면에 `Training ...` 진행률이 보이면 모델을 학습 중입니다. `model.js` 가 있으면 바로 끝나고, `--retrain` 으로 새로 학습할 때는 몇 분 걸립니다.
- 방화벽 허용 창이 뜨면 **[허용]** 을 누릅니다. (서버는 내 컴퓨터 `127.0.0.1` 에서만 열립니다.)
- 서버는 창을 닫거나 `Ctrl + C` 로 종료합니다. **창을 닫으면 페이지도 동작을 멈춥니다.**

## 단계 8. 수동 실행 방법

배치 파일 없이 직접 실행하는 세 가지 방법입니다. 위에서 아래로 갈수록 준비가 덜 필요합니다.

### 방법 A · server.py 직접 실행 (배치 파일과 같은 결과)
```bat
cd /d C:\AI-Application-Practice\Week03-DigitRecognition\web_version
python -m pip install -r requirements.txt
python server.py
```
| 옵션 | 뜻 |
|---|---|
| `--port 5000` | 다른 포트 사용 |
| `--no-browser` | 브라우저 자동 열기 끄기 |
| `--retrain` | 저장된 `model.js` 를 무시하고 새로 학습 |

### 방법 B · `python -m http.server` (라이브러리 설치 불필요)
`http.server` 는 Python에 **기본으로 들어 있는 정적 파일 서버**입니다. numpy·scikit-learn이 없어도 됩니다. 이미 학습된 가중치 `model.js` 를 브라우저가 읽어 예측하므로 인식 기능은 그대로 동작합니다.
```bat
cd /d C:\AI-Application-Practice\Week03-DigitRecognition\web_version
python -m http.server 8000
```
브라우저에서 `http://localhost:8000` 접속 → 종료는 `Ctrl + C`

> **꼭 확인하세요 · app.js 수정 필요**
> 원래 `app.js` 는 `http://` 로 열리면 무조건 `server.py` 전용 주소(`/api/status`)에 물어봅니다. `http.server` 에는 이 주소가 없어서
> `Cannot reach the server (Unexpected token '<' ... is not valid JSON). Retrying...`
> 메시지만 반복되고 **[Recognize]** 버튼이 계속 비활성 상태로 남습니다. (GitHub Pages에서도 같은 증상)
>
> 이 저장소의 `app.js` 는 `/api/status` 가 없으면 `model.js` 로 바로 전환하도록 고쳤습니다. 직접 고치려면 `pollStatus()` 함수의 `try {` 앞부분을 아래처럼 바꿉니다.
> ```javascript
>   let response;
>   try {
>     response = await fetch("/api/status", { cache: "no-store" });
>   } catch (error) {
>     setStatus(`Cannot reach the server (${error.message}). Retrying...`, 0, true);
>     setTimeout(pollStatus, STATUS_POLL_MS);
>     return;
>   }
>   const isJson = (response.headers.get("content-type") || "").includes("application/json");
>   if (!response.ok || !isJson) {
>     loadModelFromFile();   // 정적 서버: model.js 사용
>     return;
>   }
>   try {
>     const status = await response.json();
> ```

### 방법 C · 서버 없이 파일로 열기
`index.html` 을 더블 클릭합니다. 주소가 `file:///...` 로 열리면 `app.js` 가 자동으로 `model.js` 를 불러옵니다. **설치가 전혀 필요 없는 가장 간단한 방법**입니다.

| 방법 | 필요한 것 | 학습 | 예측 |
|---|---|---|---|
| bat / 방법 A | Python + numpy·scikit-learn·pandas | 가능 (`--retrain`) | 가능 |
| 방법 B | Python만 | 불가 | 가능 (`model.js`) |
| 방법 C | 브라우저만 | 불가 | 가능 (`model.js`) |

## 최종 체크리스트
- [ ] 압축을 풀고, 영문 경로에서 실행했다
- [ ] `python --version` 또는 `py -3 --version` 이 3.10 이상을 보여 준다
- [ ] `python -c "import numpy, sklearn, pandas; print('OK')"` 가 `OK` 를 출력한다
- [ ] 서버 창에 `Open in your browser: http://localhost:8000` 이 보인다
- [ ] 브라우저에서 숫자를 그리면 `Predicted Digit` 과 `Confidence` 가 나온다
- [ ] 그래도 안 되면 방법 C(`index.html` 더블 클릭)로 기능부터 확인한다
