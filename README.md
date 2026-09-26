# Automation Factory · Money Scout v0.4.0

v0.4는 **수집망 확장(Opportunity Network)** 버전입니다.

## 핵심 변경
- 기존 공식 claimable Agent Bounties 유지
- GitHub Paid Discovery 추가
  - bounty / paid task 신호 수집
  - 실제 지급 검증 전에는 PAY CHECK
  - 본문 숫자를 실제 보상으로 신뢰하지 않음
- GitHub Product Demand 추가
  - automation / spreadsheet / bot integration 등 반복 불편 신호 수집
  - 직접 일감이 아니라 SaaS·봇·자동화 상품화 후보로 분류
- RemoteOK는 채용 참고 소스로 유지하지만 HOT 대상은 아님
- Judge 버전 type+payout-v0.4.0

## 안전 원칙
- GitHub Paid Discovery는 후보 탐색용입니다.
- 실제 작업 착수 전 원문에서 지급 조건, claim 가능 여부, 마감, 자격 조건을 확인해야 합니다.
- 기존 D1 데이터와 사용자 결정값은 유지됩니다.
