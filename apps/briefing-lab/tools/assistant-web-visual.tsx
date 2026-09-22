import { createRoot } from 'react-dom/client';
import { BriefingMarkdown } from '../src/briefing-insight-card';
import '../src/styles.css';
import '../src/workspace.css';
createRoot(document.getElementById('root')!).render(
  <main
    style={{
      maxWidth: 720,
      margin: '32px auto',
      padding: 24,
      background: 'white',
      border: '1px solid #d6e0cc',
      borderRadius: 16,
    }}
  >
    <h2>공개 지도 · 이미지 표시 확인</h2>
    <p>합성 화면입니다. 지도/이미지는 버튼을 누를 때만 외부 서비스에서 불러옵니다.</p>
    <BriefingMarkdown
      webMedia
      text={
        '**장소 후보** — 실내 호실은 별도로 확인하세요.\n\n[공개 지도](https://www.openstreetmap.org/?mlat=48.8584&mlon=2.2945)\n\n[공식 문서](https://developers.openai.com/codex/config-reference/)\n\n![공개 이미지 미리보기](https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg)'
      }
    />
  </main>,
);
