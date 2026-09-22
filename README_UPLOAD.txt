Automation Factory - Job Scout v0.1
====================================

이번 버전 목적
- 새 프로젝트 기준본 만들기
- Job DB 구조
- 기본 자동 분류
- 모바일/PC 공용 Web UI
- 샘플 일감으로 정상 동작 확인

아직 하지 않는 것
- 위시켓 실제 수집
- Freelancer 실제 수집
- AI 선택 Agent
- 고객 응대 Agent
- 자동 지원/메시지

GitHub 업로드
1. 새 저장소 이름 권장: AutomationFactory
2. 이 ZIP을 풉니다.
3. ZIP 안의 파일을 저장소 루트에 그대로 업로드합니다.
4. 폴더를 한 겹 더 만들지 마세요.

정상 구조
AutomationFactory/
  worker.js
  wrangler.jsonc
  schema.sql
  package.json
  .gitignore
  README_UPLOAD.txt

Cloudflare 연결은 다음 단계에서 같이 진행합니다.
D1 database_id는 아직 임의로 만들지 마세요.
GitHub 업로드가 끝난 뒤 실제 D1을 만들고 정확한 ID를 넣습니다.

첫 배포 후 테스트
- 화면 상단에 Job Scout v0.1 표시
- '샘플 일감 넣기' 버튼 클릭
- 후보 / 검토 / 제외로 자동 분류되는지 확인

원칙
- 이 기준본이 정상 동작한 뒤에만 v0.2에서 실제 일감 사이트 1개를 연결합니다.
- 한 버전에서 한 가지 목적만 수정합니다.
