# Revenue Factory v1 — Customer app + local operator tools

For the final pilot-ready app with accounts, orders, PWA and optional HTTPS deployment, **start with [README-PRODUCTION.md](README-PRODUCTION.md)**. This earlier README documents the original single-operator local studio (port 8038) and remains for compatibility.

---

# Revenue Factory — 1차 수익사업 운영자용 초기 완성본

독립적으로 작동하는 **AI 커머스 콘텐츠·업무 자동화 사업의 로컬 운영 도구**입니다. 기존 Theme Factory, ShortsAI, GuildCore 코드는 변경하지 않습니다.

> **정확한 범위:** 외부 AI 모델이 없는 환경에서도 실행되는 규칙 기반 광고 카피·이미지 시안·무음 MP4 영상 제작기입니다. 생성형 AI 이미지, 자연스러운 내레이션, 영상 스톡 매칭, 고객별 로그인, 결제, 공개 웹서버는 **포함되어 있지 않습니다.** 상업적으로 무인 운영 가능한 SaaS라고 주장하지 않습니다.

## 현재 실제 동작하는 기능

| 상품 | 작업 | 실제 결과물 |
|---|---|---|
| 쇼핑몰 광고 패키지 | 브랜드, 제품명, 사실 기반 특징, 가격, 사진 입력 | 세로 720×1280 **25초 MP4**, SVG 카드 3장, 25초 대본/스토리보드, 캡션, 검수 HTML |
| 매출 보고서 | UTF-8 CSV 데이터 입력·파일 읽기 | 상품별 매출 및 수량 `summary.csv`, `summary.json`, `report.html` |
| 운영 기능 | 작업 조회, 필수 검수 항목 승인, 다운로드 | 작업 목록·상태 기록·검수 승인·납품 ZIP 패키지 |
| 설치형 웹 UI | PC 브라우저에서 로컬 접속 | PWA 앱 셸/아이콘, 연결 상태 표시 |

- 광고 콘텐츠에 임의의 할인율이나 판매 순위를 추가하지 않습니다. 잠재 과장 광고 표현은 검토 대상으로 표시합니다.
- 별도의 AI API 키·구독료 없이 테스트할 수 있습니다. MP4는 **FFmpeg** 와 한글 글꼴 설치가 필요합니다.
- 광고 영상은 **무음**이며, 사진/텍스트 기반 기본 템플릿을 사용합니다. TTS·음악·화려한 모션은 별도 확장 범위입니다.
- 작업 결과는 로컬 PC의 `revenue_factory/output/` 폴더에 저장됩니다. 자동 외부 전송은 하지 않습니다.

## 실행: Windows 및 Linux/macOS

1. [Node.js](https://nodejs.org/) **20 이상** 설치
2. [FFmpeg](https://ffmpeg.org/download.html) 설치 후 `ffmpeg -version` 실행 확인; Windows는 `PATH` 설정 필요
3. 한글 글꼴 설치(Windows의 `malgunbd.ttf`는 자동 탐색). 다른 폰트는 환경변수 `REVENUE_FONT`로 절대경로 지정
4. 저장소 루트에서:

```bash
node revenue_factory/server.mjs
# 브라우저: http://127.0.0.1:8038
```

Windows에서는 `revenue_factory/start-windows.cmd`를 더블 클릭해도 됩니다.

**작업 순서:** 상품 정보 작성 → 광고 카드 및 MP4 자동 생성 → 작업 목록 확인 → 사실성·사용권·광고 표기 검수 → 승인 → ZIP 생성 및 다운로드. 매출 CSV 보고서는 생성 후 바로 ZIP으로 받을 수 있습니다.

MP4 자동 생성은 기본값입니다. FFmpeg가 없으면 카드/대본을 생성하며 오류 안내를 표시하고, 도구를 설치한 뒤 작업 목록에서 수동 MP4 제작을 실행할 수 있습니다. 영상 자동 생성 비활성화: `REVENUE_AUTO_RENDER=0`.

## 테스트

```bash
node --test revenue_factory/tests/*.test.mjs
node revenue_factory/cli.mjs creative revenue_factory/examples/product.json
node revenue_factory/cli.mjs report revenue_factory/examples/orders.csv
```

테스트는 카드·보고서·검수·ZIP·HTTP API·실제 FFmpeg MP4 제작을 다룹니다. FFmpeg 또는 한글 글꼴이 없는 환경에서는 영상 단독 테스트를 건너뛰지만 다른 테스트는 실행됩니다.

## 앱/PWA 제한

- PC의 `localhost`/`127.0.0.1` 전용 앱 셸입니다. 접근 제어 없이 외부 IP에 서버를 바인딩하지 마세요.
- 휴대폰 원격 사용/공개 HTTPS 웹앱/안드로이드 APK/아이폰 앱스토어 배포는 현재 단계에서 지원하지 않습니다.
- PWA 서비스 워커는 **UI 앱 셸만 캐싱**하고 고객 사진, 매출, API, 결과물은 캐싱하지 않습니다.
- 현재 사용자는 운영자 **한 명**을 전제로 합니다. 다중 고객 데이터를 받을 계획이면 로그인, 고객 데이터 분리, HTTPS, 납품기한/환불/개인정보 정책을 먼저 구현해야 합니다.

## 후속 제품화 로드맵(아직 미구현)

1. 기존 ShortsAI 영상 엔진과 별도 어댑터 연결 및 더 좋은 영상·내레이션 품질 확보
2. 고객 작업 접수·검수 큐·AI 품질 점검 고도화·중복 생성 방지
3. 고객별 계정·데이터 분리·주문·결제·환불·다운로드 만료
4. HTTPS 배포 후 PWA 휴대폰 앱 이용, 실제 수요 확인 시 네이티브 앱 검토

## 운영 안전 수칙

- 고객의 상품 사진을 쓰려면 사용권을 확인하세요. 미검증 효능, 1위·최저가 주장은 게시하지 마세요.
- 고객 개인정보가 포함된 원본 주문 데이터는 입력하지 마세요. 보고서는 세금, 환불, 수수료, 배송비를 반영하지 않습니다.
- 광고 납품 ZIP은 사용권·정확성·광고 주장·채널 규정 4가지 검수 항목을 모두 승인해야 생성할 수 있습니다.
- 서버는 `127.0.0.1`에만 바인딩되며 로컬 작업 폴더가 유출되지 않도록 PC 접근 권한을 관리해야 합니다.