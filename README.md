# Automation Factory · Money Scout v0.4.1

v0.4.1은 **Payout Verifier + Demand Validator** 패치입니다.

## Payout Verifier
- GitHub Paid Discovery에서 실제 보상 문구를 우선 확인합니다.
- USD/USDC/USDT 보상은 금액을 추출해 fixed payout으로 평가합니다.
- 알 수 없는 토큰 보상은 USD로 오인하지 않고 TOKEN CHECK로 분리합니다.
- 보상 근거가 없는 `paid` 후보는 COLD로 내립니다.
- 신청/claim/추첨/지갑 조건을 가능한 범위에서 추출합니다.
- 초소액 보상은 실제 bounty여도 COLD 처리합니다.

## Demand Validator
- Product Demand는 일반 Money 점수와 분리합니다.
- 카드 지표를 DEMAND / REPEAT / BUILD / MONETIZE로 표시합니다.
- 자동생성 daily/trending/digest 이슈는 노이즈로 제외합니다.
- 실제 문제/기능요청 신호가 없는 이슈는 신규 수집에서 제외합니다.
- 같은 문제군이 서로 다른 repo에서 반복되는 수를 계산합니다.
- 1개 repo = SIGNAL(COLD), 2개 = WATCH 후보, 3개 이상 = PRODUCT CANDIDATE(WATCH).

## 회귀 테스트
`npm run check`는 문법 검사와 `validator_tests.mjs` 회귀 테스트를 함께 실행합니다.

기존 D1 데이터와 사용자 결정값, ADMIN_TOKEN 설정은 유지됩니다.
