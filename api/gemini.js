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

  // 💡 폴백 모델 순서 (3 -> 2.5 -> 3.1 Lite)
  const models = [
    'gemini-3-flash-preview',         
    'gemini-2.5-flash',               
    'gemini-3.1-flash-lite-preview'   
  ];

  let lastError = null;
  let body;

  try {
    body = await req.json();
  } catch(e) {
    return new Response(JSON.stringify({ error: '잘못된 데이터 형식입니다.' }), { status: 400 });
  }

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
          // 🚀 텍스트 칸에 섞지 않고, 분리된 데이터표(usedSystemInfo)에 담아서 HTML로 보냅니다!
          data.usedSystemInfo = `🤖 가동 시스템: ${i + 1}번 키 / ${currentModel}`;
          
          return new Response(JSON.stringify(data), {
            status: 200, headers: { 'Content-Type': 'application/json' }
          });
        }

        if (response.status === 429 || response.status === 503 || response.status === 400) {
          lastError = `${i + 1}번 키의 ${currentModel} 실패`;
          continue; 
        }

        return new Response(JSON.stringify(data), { status: response.status });

      } catch (error) {
        lastError = `네트워크 오류: ${error.message}`;
        continue; 
      }
    }
  }

  return new Response(JSON.stringify({ 
    error: '모든 API 키와 모델의 무료 할당량이 소진되었습니다.', 
    details: lastError 
  }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}
