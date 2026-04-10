module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Vercel에서 쉼표로 연결된 키들을 가져와 배열로 만듭니다.
  const keysString = process.env.GEMINI_API_KEY;
  if (!keysString) {
    return res.status(500).json({ error: '서버에 API 키가 설정되지 않았습니다.' });
  }
  
  const apiKeys = keysString.split(',').map(key => key.trim());
  let lastError = null;

  // 등록된 키의 개수만큼 순서대로 시도합니다.
  for (let i = 0; i < apiKeys.length; i++) {
    const currentKey = apiKeys[i];
    
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-flash:generateContent?key=${currentKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });

      const data = await response.json();

      // 성공하면 즉시 결과를 HTML로 보내고 끝냅니다.
      if (response.ok) {
        return res.status(200).json(data);
      }

      // 할당량 초과(429) 에러가 나면 다음 키로 넘어갑니다.
      if (response.status === 429) {
        lastError = `${i + 1}번째 키 할당량 초과`;
        continue; // 반복문 계속 (다음 키 시도)
      }

      // 그 외의 치명적인 에러는 그대로 반환합니다.
      return res.status(response.status).json(data);

    } catch (error) {
      lastError = error.message;
      continue; // 네트워크 에러 발생 시에도 다음 키 시도
    }
  }

  // 모든 키를 다 썼는데도 실패했을 경우
  return res.status(500).json({ 
    error: '모든 API 키의 할당량이 소진되었거나 서버 연결에 실패했습니다.', 
    details: lastError 
  });
};
