# Automation Factory · Money Scout v0.4.3

v0.4.3은 **Evidence Context Filter** 패치입니다.

## Payout Evidence Context
- GitHub Paid Discovery에서 숫자만 있는 시장가격·월수익·급여 참고값을 bounty 보상으로 인정하지 않습니다.
- `Bounty`, `Reward`, `Payout`, `Payment`, `Compensation` 같은 명시적 지급 라벨과 가까운 금액만 보상 evidence로 채택합니다.
- `$1 USDC`, `Reward: 500 USDC` 같은 스테이블 보상과 `25-150 RTC`, `5.2 $ANSEM` 같은 토큰 보상을 분리합니다.
- 일반 문장의 `claim` 단어는 신청/claim 경로로 인정하지 않습니다.
- `Applications are open`, `Apply on ...`, `Claim this bounty/job/task` 같은 구체 문구만 action evidence로 인정합니다.

## Demand Evidence Context
- Product Demand fingerprint는 긴 본문 전체가 아니라 제목 + 본문 앞부분 + Problem/Motivation/Proposal 같은 핵심 섹션 중심으로 생성합니다.
- 긴 문서 뒤쪽에 우연히 등장한 `spreadsheet`, `automation` 같은 단어로 Product 후보가 되는 문제를 줄입니다.
- position paper / abstract / prior papers / literature review 같은 문서형 이슈는 Product Demand에서 제외합니다.
- 기존 Demand Fingerprint 반복수요 규칙은 유지합니다.

## 회귀 테스트
- 월 `$500-1,500` 시장가격 참고 → paid 보상 아님
- `Bounty: $1 USDC` → 실제 보상 evidence
- `25-150 RTC` bounty → TOKEN CHECK
- `capability to claim` → claim 경로 아님
- position paper + 뒤쪽 spreadsheet 언급 → document noise / COLD
- 동일 `csv_export` 3개 독립 repo → PRODUCT CANDIDATE / WATCH

`npm run check`는 문법 검사와 `validator_tests.mjs`를 함께 실행합니다.

기존 D1 데이터, 사용자 결정값, ADMIN_TOKEN 설정은 유지됩니다.
