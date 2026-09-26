# Automation Factory · Money Scout v0.3.1

v0.3 HOT 검증에서 발견된 **연봉/시간제/본문 숫자를 1회 일감 보상으로 오인하는 문제**를 수정한 버전입니다.

## v0.3.1 핵심 변경
- 점수 계산 전에 `Opportunity Type Classifier` 실행
  - bounty / fixed_project / freelance_gig / hourly_contract / employment / content / affiliate / business
- `Payout Normalizer` 추가
  - fixed_total / hourly / annual_salary / variable / unverified_text_amount 구분
- RemoteOK의 salary_min/max는 **연봉**으로 취급하여 HOT 산정에서 제외
- 시간제 계약은 단발 자동납품과 분리하고 기본 COLD 처리
- 기존 `github_bounty` 데이터의 본문 달러 숫자는 지급액으로 신뢰하지 않고 `PAY CHECK` 처리
- 신규 bounty 수집은 GitHub issue 검색 대신 Agent Bounties의 **공식 claimable-only API** 사용
- 카드에 TYPE / payout kind / payout trust 표시
- 기존 D1 70건은 삭제하지 않고 `기존 데이터 재채점`으로 새 기준 적용

## 중요
기존 D1과 사용자 결정(진행/보류/제외)은 유지됩니다.
새 D1을 만들 필요가 없습니다.
