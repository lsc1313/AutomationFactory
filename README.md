# AutomationFactory · Money Scout v0.2

Automation Factory의 첫 실사용 단계입니다.

## 현재 들어있는 것

- Money Scout: 외부 수익 기회 수집
- 실제 소스 2개
  - GitHub Bounty: 공개 `bounty` 라벨 이슈
  - RemoteOK: 공개 원격 일자리 피드
- Opportunity Judge v1
  - 자동화 적합성
  - 금액 신호
  - 반복 가능성
  - 빠른 처리 가능성
  - 최신성
  - 소스 적합성
  - 위험 / 경쟁 패널티
- HOT / WATCH / COLD 자동 분류
- 진행 / 보류 / 제외 수동 결정
- 모바일 우선 Web UI
- D1 저장
- 6시간마다 자동 Scout 실행
- 추후 Profit / Failure Memory용 테이블 준비

## 중요한 원칙

점수는 후보를 빠르게 거르는 보조 도구입니다. 자동 지원/계약/결제/외부 메시지 전송은 아직 하지 않습니다.

## v0.1과의 관계

v0.1의 `jobs` 테이블을 삭제하거나 덮어쓰지 않습니다. v0.2는 `opportunities`, `scout_runs`, `opportunity_outcomes`를 새로 사용합니다.
