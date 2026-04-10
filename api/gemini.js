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

  let originalBody;
  try {
    originalBody = await req.json();
  } catch(e) {
    return new Response(JSON.stringify({ error: '잘못된 데이터 형식입니다.' }), { status: 400 });
  }

  let lastError = null;

  // 💡 제미니에게 요청을 보내는 핵심 함수 (반복 사용을 위해 분리)
  const tryModel = async (key, model, keyIndex, isLiteVersion) => {
    // 원본 데이터를 복사해서 안전하게 조작합니다.
    let currentBody = JSON.parse(JSON.stringify(originalBody));

    // 🎯 [핵심 기능] 3.1 Lite 버전일 때만 프롬프트(명령어)에 특별 지시사항을 몰래 추가합니다.
    if (isLiteVersion) {
      try {
        const litePrompt = "\n\n[🚨시스템 긴급 지시사항🚨]\n현재 할당량 초과로 경량(Lite) 모델이 배정되었습니다. 무리하게 문맥을 다듬지 말고, 선생님이 작성하신 원본 내용과 어투를 최대한 그대로 유지하면서 '맞춤법'과 '띄어쓰기' 위주로만 안전하게 교정하세요.";
        currentBody.contents[0].parts[0].text += litePrompt;
      } catch (e) {
        // 구조가 다르면 무시
      }
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentBody)
    });

    const data = await response.json();

    if (response.ok) {
      // 선생님 화면에 띄워줄 시스템 꼬리표 (isLiteVersion이면 Lite라고 표시)
      const modeName = isLiteVersion ? `${model} (맞춤법 위주 모드)` : model;
      data.usedSystemInfo = `🤖 가동 시스템: ${keyIndex + 1}번 키 / ${modeName}`;
      return { success: true, data };
    }

    // 할당량 초과(429), 서버 과부하(503), 잘못된 요청(400)일 때는 다음으로 넘어갑니다.
    if (response.status === 429 || response.status === 503 || response.status === 400) {
      return { success: false, retry: true, error: `${keyIndex + 1}번 키의 ${model} 실패` };
    }

    // 그 외의 치명적 에러는 즉시 중단
    return { success: false, retry: false, data, status: response.status };
  };

  // ====================================================================
  // 🥇 1단계: 모든 키를 순회하며 고성능 모델(3.0 프리뷰 -> 2.5 플래시)을 먼저 씁니다.
  // ====================================================================
  const highQualityModels = ['gemini-3-flash-preview', 'gemini-2.5-flash'];
  
  for (let i = 0; i < apiKeys.length; i++) {
    for (let model of highQualityModels) {
      const result = await tryModel(apiKeys[i], model, i, false);
      
      if (result.success) {
        return new Response(JSON.stringify(result.data), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (!result.retry) {
        return new Response(JSON.stringify(result.data), { status: result.status, headers: { 'Content-Type': 'application/json' } });
      }
      lastError = result.error;
    }
  }

  // ====================================================================
  // 🥈 2단계: 1단계가 싹 다 막혔을 때, 모든 키를 순회하며 3.1 Lite 버전을 가동합니다.
  // ====================================================================
  const fallbackModel = 'gemini-3.1-flash-lite-preview';
  
  for (let i = 0; i < apiKeys.length; i++) {
    const result = await tryModel(apiKeys[i], fallbackModel, i, true); // true = Lite 모드 켬!
    
    if (result.success) {
      return new Response(JSON.stringify(result.data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (!result.retry) {
      return new Response(JSON.stringify(result.data), { status: result.status, headers: { 'Content-Type': 'application/json' } });
    }
    lastError = result.error;
  }

  // ====================================================================
  // 💥 3단계: 준비한 모든 방어막이 뚫렸을 때의 안내 메시지
  // ====================================================================
  return new Response(JSON.stringify({ 
    error: '모든 API 키와 모델의 무료 할당량이 완전히 소진되었습니다. 내일 다시 시도해주세요.', 
    details: lastError 
  }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}
