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
  
  // 1. API 키들을 가져옵니다.
  let apiKeys = keysString.split(',').map(key => key.trim());

  // 🚀 핵심: 버튼을 누를 때마다 8개의 키 순서를 랜덤으로 섞어줍니다! (골고루 사용하기 위함)
  apiKeys.sort(() => Math.random() - 0.5);

  let originalBody;
  try {
    originalBody = await req.json();
  } catch(e) {
    return new Response(JSON.stringify({ error: '잘못된 데이터 형식입니다.' }), { status: 400 });
  }

  let lastError = null;

  // 제미니에게 요청을 보내는 함수
  const tryModel = async (key, model, isLiteVersion) => {
    let currentBody = JSON.parse(JSON.stringify(originalBody));

    // 🎯 3.1 Lite 버전일 때만 맞춤법 위주 특별 지시사항 추가
    if (isLiteVersion) {
      try {
        const litePrompt = "\n\n[🚨시스템 긴급 지시사항🚨]\n현재 할당량 초과로 경량(Lite) 모델이 배정되었습니다. 무리하게 문맥을 다듬지 말고, 선생님이 작성하신 원본 내용과 어투를 최대한 그대로 유지하면서 '맞춤법'과 '띄어쓰기' 위주로만 안전하게 교정하세요.";
        currentBody.contents[0].parts[0].text += litePrompt;
      } catch (e) {}
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentBody)
    });

    const data = await response.json();

    if (response.ok) {
      const modeName = isLiteVersion ? `${model} (맞춤법 위주 모드)` : model;
      data.usedSystemInfo = `🤖 가동 시스템: 랜덤 배정된 키 / ${modeName}`;
      return { success: true, data };
    }

    if (response.status === 429 || response.status === 503 || response.status === 400) {
      return { success: false, retry: true, error: `할당량/서버 지연으로 실패` };
    }

    return { success: false, retry: false, data, status: response.status };
  };

  // ====================================================================
  // 🥇 1단계: 무작위로 섞인 키들을 돌면서 고품질 모델(3 프리뷰 -> 2.5 플래시) 사용
  // ====================================================================
  const highQualityModels = ['gemini-3-flash-preview', 'gemini-2.5-flash'];
  
  for (let i = 0; i < apiKeys.length; i++) {
    for (let model of highQualityModels) {
      const result = await tryModel(apiKeys[i], model, false);
      
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
  // 🥈 2단계: 위 모델들이 전부 막히면 무작위로 섞인 키들로 3.1 Lite 버전 가동
  // ====================================================================
  const fallbackModel = 'gemini-3.1-flash-lite-preview';
  
  for (let i = 0; i < apiKeys.length; i++) {
    const result = await tryModel(apiKeys[i], fallbackModel, true); 
    
    if (result.success) {
      return new Response(JSON.stringify(result.data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (!result.retry) {
      return new Response(JSON.stringify(result.data), { status: result.status, headers: { 'Content-Type': 'application/json' } });
    }
    lastError = result.error;
  }

  // ====================================================================
  // 💥 3단계: 모든 키와 모델이 막혔을 때
  // ====================================================================
  return new Response(JSON.stringify({ 
    error: '모든 API 키와 모델의 무료 할당량이 완전히 소진되었습니다. 내일 다시 시도해주세요.', 
    details: lastError 
  }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}
