# Revenue Factory — Phase 1 local MVP (한국어)

**기존 ShortsAI·GuildCore·Theme Factory를 변경하지 않는 독립형 모듈입니다.**

## 무엇이 동작하나요?
1. 상품 정보에서 광고용 **SVG 카드 3장**, **25초 쇼츠 스토리보드**, **캡션**, **검토용 HTML**을 생성합니다. 상품 사진(PNG/JPEG/WEBP)을 첨부할 수 있습니다.
2. 주문 CSV를 읽고 **상품별 매출 합계**, **수량**, **주문 행수**를 계산하여 `summary.json`, `summary.csv`, `report.html`을 생성합니다.
3. PWA 설치용 manifest, 앱 아이콘, 제한된 오프라인 화면을 제공합니다. **앱 설치 후에도 제작 API에는 로컬 서버가 필요합니다.**
4. Node.js 내장 기능만 사용합니다. 유료 API, 서버 가입, 자동 게시가 필요하지 않습니다.

**아직 구현되지 않은 기능:** 실제 동영상 렌더링/자막 합성, AI 이미지 생성, 유튜브·인스타그램 자동 게시, 고객별 로그인, 결제, 영업 자동화, 견적/청구, 계약, 실서비스 호스팅. 이 단계는 제품화 이전의 동작 가능한 로컬 MVP입니다.

## 시작
Node.js 20 이상.

```bash
node revenue_factory/server.mjs
# http://127.0.0.1:8038 열기
```

또는 CLI:
```bash
node revenue_factory/cli.mjs creative revenue_factory/examples/product.json
node revenue_factory/cli.mjs report revenue_factory/examples/orders.csv
node --test revenue_factory/tests/*.test.mjs
```

출력은 `revenue_factory/output`에 저장되며 Git에 커밋하지 않습니다. 서버는 오직 127.0.0.1에 바인딩되어 외부 공개되지 않습니다. 고객 개인정보가 포함된 CSV 원본은 업로드하지 마세요.

## PWA / 앱 제공 전략
- PC Chrome/Edge 등에서 `http://127.0.0.1:8038` 접속 후 설치 메뉴를 이용할 수 있습니다. 브라우저 정책에 따라 설치 UI는 다릅니다.
- 현재 서버는 안전을 위해 **127.0.0.1에만 바인딩**합니다. 휴대폰에서 PC에 직접 접속하거나 원격으로 사용하는 기능은 없습니다.
- Android/iPhone 고객용 앱은 향후 **HTTPS + 계정 인증 + 고객 데이터 격리 + 서버 측 작업 큐**가 준비된 후 별도로 배포합니다.
- 서비스 워커는 앱 셸만 캐싱하며 /api, /files, 원본 사진, 매출 데이터를 캐싱하지 않습니다.
- App Store/Play Store 게시, APK·IPA 빌드는 v0.1 범위가 아닙니다.

## 생산 도입 전 필수 단계
- [ ] 기존 ShortsAI 영상 생산 엔진과 **별도 어댑터**로 연결 (운영 버전 직접 수정 금지)
- [ ] 기존 고객 사진 사용권·가격/효능 표시 자동 점검 고도화
- [ ] 승인 기반 게시·전달 / 중복 작업 방지 / 작업 상태 추적
- [ ] 고객별 인증/데이터 격리, 주문 접수/결제, 개인정보 처리 정책
- [ ] 견적·납품 범위·수정 횟수·고객 지원 범위 명시
- [ ] 유료 판매 시험 후 반복성이 확인된 워크플로만 상품화

## 안전 범위
- 광고 문구는 제공된 정보에서만 작성합니다. 실증되지 않은 최저가/1위/완치 등의 주장은 검토 대상으로 표시됩니다.
- 광고 결과물은 `DRAFT_REVIEW_REQUIRED`이고 자동 게시하지 않습니다.
- 판매/정산 보고서는 세금, 반품, 수수료, 배송비를 반영하지 않습니다.
- 원본 주문 데이터는 매출 집계에만 사용하고 보고서에는 포함하지 않습니다.