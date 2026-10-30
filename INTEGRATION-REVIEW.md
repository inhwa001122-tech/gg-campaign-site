# 기존 홈페이지 최종 통합 검토

대상은 기존 `inhwa001122-tech/gg-campaign-site`와
`https://thethe-up-2.netlify.app/`입니다. 새 사이트/Netlify 프로젝트를 만들거나
운영 환경변수·관리자 비밀번호를 변경하는 작업은 하지 않았습니다.
운영 배포와 `main` 병합은 수행하지 않습니다.

## 브랜치 통합

- 기준 main: `ffdfcd1` (작업 시작 시 원격 HEAD).
- SNS 브랜치와 PR #1의 HEAD: `e7bbbca`. PR은 Open, base `main`, head `sns-photo-preview`임을 GitHub 페이지와 Git 참조에서 확인했습니다.
- main의 후보 사진·이름·약력·공약·정책자료집·디자인을 보존합니다.
- SNS 브랜치의 인스타그램·유튜브 주소와 자동 반영 기능을 통합했습니다. 페이스북·텔레그램 주소는 기존 값 그대로입니다.
- main의 `videoUrl`에는 개별 영상이 아닌 기존 유튜브 **채널** 주소가 있었습니다. 그 주소를 `youtubeUrl`에 유지하고 후보영상은 요청대로 비워두었습니다.
- CMS backend branch는 `main`입니다. SNS 브랜치의 `sns-photo-preview` 설정을 운영 설정에 가져오지 않았습니다.
- 명확한 테스트 소식 ‘테스트 자동반영 최종 확인’과 `preview-check.txt`는 제외했습니다. 출처가 테스트용이라고 확정되지 않은 기존 업로드 사진 2장은 보존했습니다.
- 기존 ZIP 자료는 원본으로 보존하며 배포 파일 위에 다시 풀지 않았습니다.

## 변경 파일과 동작

| 파일 | 변경 |
| --- | --- |
| `gg-campaign-site/index.html` | 기존 섹션을 유지하며 관리 폼·세로형 쇼츠 영역·영상 재생 영역 추가 |
| `gg-campaign-site/live-content.js`, `live-content.css` | 로그인, 다중 사진 압축·편집, 소식/쇼츠 CRUD, 후보영상, 반응형 화면 |
| `gg-campaign-site/server/campaign.mjs` | 서버 인증·입력 제한·Blobs 저장·버전 충돌 검사 |
| `gg-campaign-site/netlify/functions/campaign.mjs` | 기존 사이트의 새 Function 진입점, 미리보기 저장소 격리 |
| `gg-campaign-site/campaign-shared.js` | YouTube 주소 검증, 사진 제한 상수 |
| `gg-campaign-site/live-sync.js` | main CMS 읽기와 배포본 fallback. 전역 fetch를 바꾸지 않음 |
| `gg-campaign-site/campaign-updates.js` | 기존 SNS 4개 유지, 바로 아래 응원 계좌/복사 버튼 |
| `gg-campaign-site/script.js` | 기존 후보·공약 표시 유지, 여러 사진 상세 표시와 실시간 소식 연결 |
| `gg-campaign-site/content/site.json` | 기존 주소 통합, 후보영상 비움, 테스트 소식 제외 |
| `gg-campaign-site/admin/config.yml` | main 저장 유지, 신규 소식은 홈페이지 관리 메뉴로 안내 |
| `gg-campaign-site/package.json`, `package-lock.json` | 재현 가능한 의존성과 테스트 명령 |
| `netlify.toml` | 기존 publish/functions 경로 유지, 잠금 파일 기준 production 설치 |
| `tests/`, `.gitignore` | 보안·브라우저 회귀 테스트, 로컬 산출물 제외 |

## 관리자 사용 방법

1. 홈페이지 ‘선거운동 소식’ 아래 ‘선본 관리자 · 활동사진 / 쇼츠 / 후보영상 관리’를 엽니다.
2. 기존 게시판 관리자 비밀번호로 로그인합니다. 새 비밀번호나 외부 유료 서비스가 필요하지 않습니다.
3. 소식 제목·날짜·본문을 입력하고 사진을 여러 장 선택한 뒤 ‘소식 공개 저장’을 누릅니다.
4. 목록의 수정/삭제 버튼으로 관리합니다. 기존 사진 중 필요한 사진만 남기거나 새 사진을 추가할 수 있습니다.
5. 쇼츠는 제목과 유튜브 개별 영상 주소를 등록합니다. 채널 주소는 허용하지 않습니다.
6. 후보 홍보영상 주소를 비워서 저장하면 원래 영역에 ‘공개 예정’이 표시됩니다.

이 관리 기능은 GitHub 커밋이나 재배포 없이 공개됩니다. 현재 관리자 화면은 저장 즉시,
다른 방문자는 새로고침/탭 재진입/최대 약 60초의 주기적 갱신으로 변경을 확인합니다.
기존 Decap CMS는 후보·공약 등 기존 내용 관리용이며 계속 `main`에 저장합니다.
CMS의 기존 news 필드는 배포 초기 자료이며, 새 소식은 홈페이지 관리 메뉴를 사용합니다.
실시간 Blobs 콘텐츠가 만들어진 뒤 CMS news/videoUrl로 이를 덮어쓰지 않습니다.

## 저장·인증·용량

- `BOARD_ADMIN_SECRET`의 **기존 값**을 서버에서 해시한 후 상수 시간 비교합니다. 환경변수나 값을 생성/변경/노출하지 않습니다.
- 새 관리 화면의 비밀번호는 해당 페이지 메모리에만 두며 로그아웃/새로고침하면 사라집니다. 요청마다 서버가 인증합니다.
- 새 저장소는 site-scoped `gg-campaign-content-v1`과 `gg-campaign-media-v1`입니다. 배포가 바뀌어도 유지되는 `getStore`를 사용합니다.
- 새 기능의 deploy-preview/branch-deploy 저장소에는 별도 suffix를 붙여 운영 소식·사진과 격리합니다. 기존 게시판의 미리보기 동작은 변경하지 않았으므로 **미리보기 게시판에는 실제 테스트 글을 쓰지 마세요**.
- 기존 게시판 `board.mjs`, `voice-board.js`, `voice-board.css`는 main과 동일합니다. `gg-voice-public-board-v1`, `gg-voice-board-rate-v1`을 새 코드에서 읽거나 초기화하지 않습니다.
- 동시 관리 시 Blobs ETag와 `onlyIfMatch` / `onlyIfNew`로 덮어쓰기를 막고 HTTP 409를 반환합니다. 충돌하면 입력을 유지한 채 목록을 새로고침해 다시 저장합니다.
- 로컬 Blobs SDK 11.1.7 에뮬레이터는 GET ETag를 누락합니다. 이 경우 두 listing 사이에 strong read를 두고 동일한 버전인지 확인합니다. 버전을 추측하거나 무조건 쓰기로 바꾸지 않습니다.
- 사진은 원본 장당 20MB 이하 JPG/PNG/WebP, 소식당 최대 8장입니다. 브라우저에서 최대 1,600px, **장당 1MiB 이하 WebP**로 압축합니다. WebP 변환으로 원본 EXIF 등 메타데이터를 복사하지 않습니다.
- 사진은 한 요청에 한 장씩 전송합니다. 서버도 실제 읽은 바이트 수와 WebP 시그니처를 검사하며 1MiB를 넘으면 413을 반환합니다. 8장을 하나의 거대한 JSON/base64 요청으로 묶지 않습니다.
- 메타데이터 요청은 32KiB, 소식 200개, 쇼츠 100개, 전체 JSON 4MiB 이하로 제한합니다. 한국어 UTF-8 바이트 수로 전체 용량을 검사합니다.
- 일반 buffered Netlify Functions의 6MB 요청/응답 제한과 바이너리 base64 오버헤드를 고려해 그보다 낮은 자체 제한을 사용합니다. 계정별 실행 시간·사용량·요금제 한도와 현재 공식 문서의 실시간 확인은 아래 접근 제한 때문에 미확인입니다.
- 삭제는 공개 항목을 제거합니다. 사진 Blob은 진행 중인 요청이나 재사용 사진을 손상시키지 않도록 자동 삭제하지 않습니다. 실패한 저장의 업로드 사진도 남을 수 있습니다. 장기 운영 시 사용하지 않는 사진은 백업/참조 확인 후 별도 정리해야 합니다. 기존 게시판 데이터에는 정리 작업을 하지 않습니다.
- 업로드 및 이미지 제공에는 기존 Netlify Functions/Blobs 사용량이 발생합니다. 추가 서비스를 도입하지 않았으며, 무제한 무료 사용을 보장하지 않습니다.

## 실행과 검증

Node 24.19.0 / npm 11.9.0 / Netlify CLI 27.16.1 / Chromium으로 검증했습니다.
기존 격리 체크아웃을 사용하며 별도 Git worktree는 필요하지 않습니다.

```sh
cd /workspace/gg-campaign-site
npm ci --prefix gg-campaign-site
npm test --prefix gg-campaign-site
NETLIFY_CLI_JS=/workspace/.onboarding-tools/node_modules/netlify-cli/bin/run.js npm run test:integration --prefix gg-campaign-site
```

다른 환경에서는 Netlify CLI 27.16.1을 설치하고 PATH에 `netlify`가 있으면
`npm run test:integration --prefix gg-campaign-site`로 실행할 수 있습니다.
Chromium 위치는 `CHROMIUM_PATH`로 지정할 수 있습니다.

- **단위 테스트 15개 통과**: 인증 우회 거부, cross-origin 거부, YouTube allowlist, CRUD, 잘못된 날짜/용량/이미지, 동시 쓰기 충돌, 로컬 ETag, 미리보기 격리, 저장 장애 시 초기화 방지.
- **실제 로컬 통합 테스트 10묶음 통과**: Netlify Dev의 두 함수 번들링, 실제 로컬 Blobs, 로그인 실패/성공, 사진 2장 압축/업로드/조회, 소식 수정/삭제, 쇼츠 CRUD, 후보영상 설정/해제, 기존 SNS href 4개, 클립보드 성공/실패 안내.
- PC 1440px 및 모바일 390px/320px 확인. 기존 후보사진 3개·단체사진·정책 이미지 로딩 확인, 가로 넘침 없음, 브라우저 스크립트 오류 0개.
- 원본 게시판 함수로 로컬 글쓰기·관리자 답변·숨김/재공개·삭제 확인.
- 서버 종료 후 같은 로컬 저장소로 재시작하여 소식·쇼츠·게시판 데이터 유지 확인.
- 외부 계정과 연결하지 않은 임시 복사본에서 실제 `netlify build --offline`의 production `npm ci --omit=dev`와 두 Functions 패키징 통과.
- 테스트는 운영과 연결되지 않은 임시 디렉터리에서 무작위 로컬 전용 비밀번호로 실행합니다. 테스트 데이터는 삭제하고 임시 디렉터리도 제거합니다. 이미지 검토 결과는 ignored `test-results/`에 남깁니다.

## 배포 전에 남은 확인

현재 네트워크 정책이 운영 도메인과 `docs.netlify.com`, `api.github.com` 접근을 403으로 차단했습니다.
세 도메인은 클라우드 환경 설정 초안에 추가했으나 실행 환경 반영·게시를 했다고 주장하지 않습니다.
GitHub PR HTML과 Git 읽기는 가능하지만 GitHub API로 PR 제목/설명/배포 상태를 조회·갱신하는 작업은 제한됩니다.

따라서 다음은 **미검증**이며 배포 승인의 전제입니다.

- 실제 운영 배포 페이지·Netlify 배포 상태·설정된 기존 site ID·production branch가 `main`인지.
- Netlify에서 기존 `BOARD_ADMIN_SECRET`이 새 Function에도 Functions 범위로 전달되는지. 기존 값을 보존하고 값 자체를 채팅/코드/로그에 노출하지 않아야 합니다.
- 운영 Blobs의 실제 게시판 데이터와 권한, 계정 사용량/요금제 제한. 로컬 테스트가 운영 데이터 보존의 백업 검증을 대신하지 않습니다.
- YouTube 영상 자체의 공개/임베드 허용 상태와 실제 스트리밍. 테스트는 올바른 iframe URL 생성까지 확인했으며 외부 영상 요청은 차단했습니다.
- SNS 서비스 로그인/접근성. 등록된 원래 URL 4개가 그대로 링크되는 것은 확인했습니다.
- 실제 Decap OAuth 로그인 및 main 저장. 설정 파일의 `branch: main`은 확인했습니다.

운영 확인이 가능해진 뒤 기존 프로젝트의 미리보기/배포 정보를 읽기 전용으로 확인하고,
변경 승인 후에만 기존 PR을 main에 병합합니다. 새 프로젝트/사이트/주소는 만들지 않습니다.
롤백이 필요하면 기존 프로젝트에서 직전 배포를 재게시하고 새 Blobs와 기존 게시판 저장소를 삭제하지 않습니다.
