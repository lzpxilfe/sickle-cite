# 지원 경로와 검증 기록

검증일: 2026-09-09. 목록은 기능 구현 범위를 나타내며 모든 논문의 다운로드 성공을 뜻하지 않습니다.

## 서비스 조사

RISS가 제공하는 [원문제공처 분류](https://www.riss.or.kr/search/Search.do?colName=re_a_kor&isDetailSearch=Y&queryText=znSubject%2C%ED%85%8D%EC%8A%A4%ED%8A%B8%EB%A7%88%EC%9D%B4%EB%8B%9D&searchGubun=true)와 [UNIST 도서관의 국내 DB 안내](https://library.unist.ac.kr/e-resource/databases/?pub_location=kor)를 기준으로 주요 학술 DB를 선정했습니다. 학위논문·대학 저장소는 [dCollection](https://www.dcollection.net/), 의학 논문은 [KAMJE의 KoreaMed 안내](https://www.kamje.or.kr/service/koreamed)를 함께 확인했습니다.

## 코드 경로와 실제 점검

| 서비스 | 구현 경로 | 확인 결과 |
|---|---|---|
| RISS | 기존 파서 + DC/모바일 표기 + 원문제공처 버튼 + 새 탭 연결 | 공개 상세페이지 서지/원문 버튼 점검 |
| KCI·KOAJ | 기존 파서 + citation + fncDown 1/2인자 | 공개 상세페이지 서지/버튼, 상세페이지 쿠키·Referer 조건 PDF 헤더 확인 |
| KISS | 기존 파서 + citation 보완 | 공개 상세페이지 서지 확인. 선택 표본은 서지만 제공하며 다운로드 불가 안내 |
| DBpia | 기존 상세/학위 파서 + 표준 서지 보완 + 뷰어 연결 | 검색 결과 서비스 존재 확인. 직접 표본 요청은 HTTP 410으로 실페이지 검증 불가 |
| eArticle | 기존 파서 + citation + 기존 원문 동작 | 공개 상세페이지 서지 확인. 익명 표본에 다운로드 버튼 없음 |
| 교보 스콜라 | 기존 파서 + 표준 서지 + 원문보기/저장 클릭 추적 | 공개 상세페이지 서지/원문 버튼 점검, 기관인증 저장은 미검증 |
| 코리아스칼라 | citation + 발행기관 표기 + 기존 사이트 동작 | 공개 상세페이지 서지 확인, 표본은 구독 인증 필요 |
| KoreaScience | 새·옛 도메인 + 한글 제목/저자/학술지 + citation PDF | 공개 상세페이지 서지/버튼 및 PDF 헤더 확인 |
| ScienceON | citation + 숨겨진 로그인 모달 예외 + 원문 링크 | 공개 상세페이지 서지/버튼 점검, 원문 최종 저장 미검증 |
| dCollection | DC/표시 서지 + 검색결과 행 + 새 탭 + StreamDocs | 공개 상세페이지 서지/원문 버튼, 실제 viewer HTML의 SDK 사용 확인. SDK 연결은 모의 API 테스트 |
| AccessON | 언어별 citation/DC + PDF | 공개 상세페이지 서지/버튼 및 PDF 본문 응답 확인 |
| KoreaMed Synapse | citation + PDF | 공개 상세페이지 서지/버튼 및 PDF 본문 응답 확인 |
| AURIC | citation + 권호 분리 + 기존 PDF URL | 공개 상세페이지 서지/버튼 확인, 포인트/로그인 원문은 미검증 |
| 국회도서관·국립중앙도서관 | 도메인 인식 + DC/citation/표시 필드 + 뷰어 연결 | 도서관 서비스 조사. 인증·관내·DRM 원문 저장 미검증 |
| KRM·KMbase | 도메인 인식 + 공통 표준 서지/링크 | 공통 코드 경로만 포함, 사이트별 실사용 미검증 |
| ScholarWorks·대학 기관 저장소 | 대학 저장소 호스트 + DC/citation/JSON-LD + PDF 링크 | 도메인/공통 파서 테스트. 개별 기관 저장 미검증 |
| Google Scholar | 개별 검색결과 행 제목/저자/연도와 PDF 연결 | 복수 행의 다른 논문 오인 방지 DOM 테스트 |
| 학회 독립 홈페이지 | citation 또는 DC+PDF 또는 ScholarlyArticle/Thesis 표식 | 공통 DOM 테스트. 표식 없는 독립 사이트는 작동 안 함 |
| 대학 프록시 | ac.kr/edu 기관의 점·하이픈 인코딩 호스트 | 프록시 URL 파싱·도메인 경계 테스트. 기관 로그인 세션 미검증 |

## 사용한 공개 표본

- [RISS](https://m.riss.kr/search/detail/DetailView.do?control_no=e3f4c3f1258cfb8be9810257f7042666&p_mat_type=1a0202e37d52c72d)
- [KCI](https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART003342986)
- [KISS](https://kiss.kstudy.com/Detail/Ar?key=4196034)
- [DBpia — 직접 요청 실패](https://www.dbpia.co.kr/journal/articleDetail?nodeId=NODE10773724)
- [eArticle](https://www.earticle.net/Article/A187319)
- [교보 스콜라](https://scholar.kyobobook.co.kr/article/detail/4010071829978)
- [코리아스칼라](https://db.koreascholar.com/Article/Detail/419085)
- [KoreaScience](https://koreascience.kr/article/JAKO202125141250148.page)
- [ScienceON](https://scienceon.kisti.re.kr/srch/selectPORSrchArticle.do?cn=JAKO201020733098474)
- [dCollection](https://scholar.dcollection.net/srch/srchDetail/200000611177)
- [AccessON](https://accesson.kr/kbiblia/v.33/3/179/24644)
- [KoreaMed Synapse](https://synapse.koreamed.org/articles/1516086586)
- [AURIC](https://www.auric.or.kr/User/Rdoc/DocRdoc.aspx?dn=455170&returnVal=RD_R)

표본 HTML을 로컬 DOM에 넣어 전체 콘텐츠 스크립트를 실행했습니다. 공개 HTML은 배포 파일에 포함하지 않았습니다. 실제 네트워크 응답 검증은 Safari UI에서 파일이 최종 저장되었다는 검증과 다릅니다.

## Safari 확인 항목

- 기존 앱의 서명/Bundle Identifier를 유지하며 새 리소스를 포함하고 Safari 사이트 접근 권한 허용.
- 상세페이지의 원문 버튼 → PDF 내용과 인용 파일명 확인.
- 새 탭 뷰어 → 확장 팝업의 현재 뷰어 PDF 또는 저장 화면 경로 확인.
- 여러 논문 탭을 동시에 열고 잘못된 파일명 연결이 없는지 확인.
- 로그인/구독/관내 전용 자료는 해당 서비스 권한 범위에서 확인.

StreamDocs 연결 근거: [제조사 document.download(fileName) 예제](https://technet.epapyrus.com/guide-assets/streamdocs/5.3.2/frontend-api/samples/document/download.html).
