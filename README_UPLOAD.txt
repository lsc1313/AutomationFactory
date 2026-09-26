Automation Factory - Money Scout v0.2
=====================================

이 패키지는 GitHub의 현재 AutomationFactory v0.1 위에 올리는 v0.2 전체 파일 세트입니다.

추가되는 파일
- judge.js
- sources.js

교체되는 파일
- worker.js
- package.json
- schema.sql
- wrangler.jsonc
- README.md
- README_UPLOAD.txt

휴대폰 GitHub 업로드
1. 기존 AutomationFactory 저장소의 main을 기준으로 새 브랜치 v0.2-money-scout 생성 권장
2. 이 ZIP을 휴대폰에서 압축 해제
3. 안의 파일 8개를 저장소 루트에 업로드
4. 같은 이름 파일은 교체
5. judge.js, sources.js는 새 파일로 추가

Cloudflare 배포 전에 꼭 확인
- wrangler.jsonc의 database_id는 현재 실제 D1 ID로 바꿔야 합니다.
- 아직 D1을 만들지 않았다면 임의 ID를 넣지 마세요.

보안 권장
- 처음 테스트는 ADMIN_TOKEN 없이 가능하지만 공개 URL이면 누구나 '스캔/상태변경'을 누를 수 있습니다.
- 실사용 배포 때 Cloudflare Worker secret `ADMIN_TOKEN`을 설정하세요.
- 설정하면 대시보드의 '관리키' 칸에 같은 값을 한 번 저장하면 됩니다.

동작
- 첫 화면: Money Scout v0.2
- '지금 스캔': GitHub Bounty + RemoteOK 수집
- Judge가 각 후보를 0~100으로 계산
- HOT / WATCH / COLD 표시
- 각 카드에서 진행 / 보류 / 제외 선택
- 매 6시간 자동 수집

이번 버전에서 하지 않는 것
- 자동 지원 / 자동 제안서 전송
- 고객과 자동 대화
- 결제 / 계약 자동화
- Profit / Failure Memory 학습 적용
- 집 PC Worker 연결

다음 버전 후보
- 국내 수익 기회 Source 추가
- Product Detector
- Profit / Failure Memory 실제 기록
- 집 PC Browser Worker 연결
