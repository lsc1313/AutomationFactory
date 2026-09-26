# Automation Factory · Money Scout v0.3

Money Scout의 Opportunity Judge를 **Money-first** 방식으로 교체한 버전입니다.

## v0.3 핵심 변경
- 보상 미확인 항목은 `PAY CHECK` 표시, HOT 금지
- 1~9 USD는 자동 COLD
- 10~29 USD는 자동 COLD
- 30~99 USD는 자동화/처리속도가 매우 높은 경우에만 WATCH 가능
- 일반 원격 채용형(RemoteOK 등)은 우선순위 대폭 하향
- 카드에 MONEY / AUTO / SPEED / SCALE 세부 점수 표시
- 기존 D1 데이터 삭제 없이 `기존 데이터 재채점` 버튼으로 전체 재평가
- 기존 진행/보류/제외 결정은 유지

## 배포
기존 GitHub 저장소의 파일을 이 패키지 파일들로 교체/추가 후 커밋합니다.
Cloudflare Git 연결이 되어 있으면 자동으로 재배포됩니다.

기존 D1 데이터는 삭제하지 않습니다.
