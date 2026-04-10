// Vercel의 초고속 Edge 런타임 사용
export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { 
      status: 405, headers: { 'Content-Type': 'application/json' } 
    });
  }

  const keysString = process.env.GEMINI_API_KEY;
  if (!keysString) {
    return new Response(JSON.stringify({ error: '서버에 API 키가 없습니다.' }), { 
      status: 500, headers: { 'Content-Type': 'application/json' } 
    });
  }
  const apiKeys = keysString.split(',').map(key => key.trim());

  // 💡 선생님이 원하신 모델 폴백 순서 (3 -> 2.5 -> 3.1 Lite)
  const models = [
    'gemini-3-flash-preview',         // 1순위: 최신 3세대 플래시 프리뷰
    'gemini-2.5-flash',               // 2순위: 안정적인 2.5 플래시
    'gemini-3.1-flash-lite-preview'   // 3순위: 가장 가벼운 3.1 라이트 프리뷰
  ];

  let lastError = null;
  let body;

  try {
    body = await req.json();
  } catch(e) {
    return new Response(JSON.stringify({ error: '잘못된 데이터 형식입니다.' }), { status: 400 });
  }

  // 다중 순환 시스템 시작
  for (let i = 0; i < apiKeys.length; i++) {
    const currentKey = apiKeys[i];

    for (let j = 0; j < models.length; j++) {
      const currentModel = models[j];

      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${currentKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        const data = await response.json();

        if (response.ok) {
          // 🚀 [마법의 코드] 결과물 텍스트 맨 끝에 현재 사용된 키와 모델 정보를 몰래 끼워 넣습니다.
          try {
            if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0]) {
              const debugInfo = `\n\n[🤖 가동 시스템 정보: ${i + 1}번 키 / ${currentModel} 모델 사용됨]`;
              data.candidates[0].content.parts[0].text += debugInfo;
            }
          } catch (e) {
            // 구조가 다를 경우 무시 (오류 방지)
          }

          return new Response(JSON.stringify(data), {
            status: 200, headers: { 'Content-Type': 'application/json' }
          });
        }

        // 할당량 초과(429) 또는 서버 과부하(503) 시 다음 모델로 이동
        if (response.status === 429 || response.status === 503 || response.status === 400) {
          lastError = `${i + 1}번 키의 ${currentModel} 실패`;
          continue; 
        }

        // 기타 에러
        return new Response(JSON.stringify(data), {
          status: response.status, headers: { 'Content-Type': 'application/json' }
        });

      } catch (error) {
        lastError = `네트워크 오류: ${error.message}`;
        continue; 
      }
    }
  }

  return new Response(JSON.stringify({ 
    error: '모든 API 키와 모델의 무료 할당량이 완전히 소진되었습니다. 내일 다시 시도해주세요.', 
    details: lastError 
  }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}
