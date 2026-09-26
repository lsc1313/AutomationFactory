Money Scout v0.4.1

현재 작업 브랜치: v0.4.1-validators
main에는 아직 반영하지 않았습니다.

핵심 패치
- Payout Verifier: 실제 보상 근거/claim 경로/토큰 보상 구분
- Demand Validator: 자동생성 노이즈 제거 + 독립 repo 반복수요 계산
- Product Demand 카드: DEMAND / REPEAT / BUILD / MONETIZE
- validator_tests.mjs 회귀 테스트 추가

배포 후 확인 순서
1. v0.4.1 확인
2. 지금 스캔 실행 (기존 github_paid/github_demand 메타 갱신)
3. 기존 데이터 재채점 실행
4. $1 USDC 같은 초소액은 COLD 확인
5. 토큰 보상은 TOKEN CHECK 확인
6. 보상 없는 paid 오탐은 COLD 확인
7. 자동생성 Trending/Digest는 신규 demand에서 제외 확인

D1/사용자 결정/ADMIN_TOKEN은 유지됩니다.
