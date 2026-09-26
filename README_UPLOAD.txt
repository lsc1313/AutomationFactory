Money Scout v0.4.2

현재 작업 브랜치: v0.4.2-demand-fingerprint
main에는 아직 반영하지 않았습니다.

핵심 패치
- broad demand group 반복수요 폐기
- 같은 문제의 demand_fingerprint가 독립 repo에서 반복될 때만 PRODUCT 후보
- legacy/unknown fingerprint demand는 COLD
- Product 카드에 FINGERPRINT 표시
- validator_tests.mjs 갱신

배포 후 확인 순서
1. v0.4.2 확인
2. 지금 스캔 실행
3. 기존 데이터 재채점 실행
4. WATCH 수가 v0.4.1보다 줄어드는지 확인
5. GitHub Product Demand 상단에서 FINGERPRINT와 REPEAT 확인
6. 서로 다른 export 종류가 같은 반복수요로 묶이지 않는지 확인

D1/사용자 결정/ADMIN_TOKEN은 유지됩니다.
