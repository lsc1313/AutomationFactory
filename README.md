# Automation Factory · Money Scout v0.4.2

v0.4.2는 **Demand Fingerprint** 패치입니다.

## 핵심 변경
- Product Demand의 반복수요 기준을 넓은 카테고리에서 **같은 문제 fingerprint**로 변경
- 예: CSV export / Markdown export / PDF export는 모두 reporting 계열이지만 서로 다른 fingerprint로 계산
- TikTok+YouTube처럼 여러 플랫폼이 함께 요구되면 multi_platform_downloader로 묶음
- Discord bot / spreadsheet automation / monitoring / scraping 등 구체 문제별 fingerprint 제공
- 서로 다른 repo에서 같은 fingerprint가 반복될 때만 반복수요로 인정
- 기존 v0.4.1 메타처럼 fingerprint가 없는 legacy demand는 자동 COLD
- unclassified demand도 COLD
- Product 카드에서 GROUP 대신 FINGERPRINT 표시

## 판정 기준
- 동일 fingerprint 1개 repo → SIGNAL / COLD
- 동일 fingerprint 2개 repo → WATCH 후보
- 동일 fingerprint 3개 이상 독립 repo → PRODUCT CANDIDATE / WATCH
- 자동생성 Daily/Trending/Digest → NOISE / COLD

## 검색 호출
- Paid Discovery 3개 query + Product Demand 5개 query로 구성
- 전체 스캔당 GitHub Search 호출 수를 과도하게 늘리지 않도록 제한

## 회귀 테스트
`npm run check`는 문법 검사와 `validator_tests.mjs`를 실행합니다.
테스트에는 CSV/Markdown/PDF fingerprint 분리, multi-platform 인식, legacy demand 하향, 반복 demand 승격이 포함됩니다.

기존 D1 데이터, 사용자 결정값, ADMIN_TOKEN 설정은 유지됩니다.
