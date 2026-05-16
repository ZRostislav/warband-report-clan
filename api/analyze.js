export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY не задан в настройках Vercel" });
  }

  const { imageBase64, mimeType } = req.body;
  if (!imageBase64 || !mimeType) {
    return res.status(400).json({ error: "Нет изображения" });
  }

  const prompt = `Ты анализируешь скриншот таблицы результатов из игры Mount & Blade: Warband.

Твоя задача — извлечь из изображения:
1. Счёт команд (два числа, например 3:1 или 5:2)
2. Список ВСЕХ игроков с их никнеймами (точно как написано, включая [теги], подчёркивания и т.д.)

Правила:
- Никнеймы часто содержат [TAG]_Nick или просто Nick_Name
- Игнорируй заголовки колонок: Kill, Death, Score, Ping, Player, Name
- Если видишь две команды — выведи игроков обеих, пометив team1 и team2
- Если счёт не виден — напиши null для обоих значений

Ответь СТРОГО в формате JSON, без markdown, без пояснений:
{
  "score": { "team1": <число или null>, "team2": <число или null> },
  "players": {
    "team1": ["ник1", "ник2", ...],
    "team2": ["ник1", "ник2", ...]
  }
}

Если команды не разделены — помести всех в team1, team2 оставь пустым массивом.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1024,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: "Ошибка Gemini API: " + err });
    }

    const geminiData = await response.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Чистим возможные markdown-обёртки
    const clean = text.replace(/```json|```/gi, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return res.status(502).json({ error: "Gemini вернул не JSON: " + text });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
