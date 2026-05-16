export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const PROMPT = `Ты анализируешь один или несколько скриншотов таблицы результатов из игры Mount & Blade: Warband.

Твоя задача — извлечь из всех изображений вместе:
1. Счёт команд (два числа, например 3:1 или 5:2) — бери из любого скриншота где он виден
2. Список ВСЕХ уникальных игроков со всех скриншотов (точно как написано, включая [теги], подчёркивания)

Правила:
- Никнеймы часто содержат [TAG]_Nick или просто Nick_Name
- Игнорируй заголовки колонок: Kill, Death, Score, Ping, Player, Name
- Если видишь две команды — выведи игроков обеих, пометив team1 и team2
- Если счёт не виден ни на одном скриншоте — напиши null
- Дубликаты игроков между скриншотами не добавляй

Ответь СТРОГО в формате JSON, без markdown, без пояснений:
{
  "score": { "team1": <число или null>, "team2": <число или null> },
  "players": {
    "team1": ["ник1", "ник2", ...],
    "team2": ["ник1", "ник2", ...]
  }
}

Если команды не разделены — помести всех в team1, team2 оставь пустым массивом.`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callGemini(apiKey, imageParts, attempt = 1) {
  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: PROMPT },
            ...imageParts,
          ],
        },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 1024 },
    }),
  });

  // 429 — превышен лимит, ждём и повторяем (до 3 попыток)
  if (response.status === 429) {
    if (attempt >= 3) {
      const body = await response.json().catch(() => ({}));
      const retryDelay =
        body?.error?.details?.find((d) => d.retryDelay)?.retryDelay;
      const seconds = retryDelay ? parseInt(retryDelay) : 40;
      throw new Error(
        `Превышен лимит Gemini API. Подожди ~${seconds} секунд и попробуй снова.`
      );
    }
    await sleep(35000);
    return callGemini(apiKey, imageParts, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const msg = body?.error?.message ?? (await response.text());
    if (response.status === 403)
      throw new Error(
        "Ключ API недействителен. Создай новый ключ на aistudio.google.com/apikey и обнови GEMINI_API_KEY на Vercel."
      );
    throw new Error(msg);
  }

  return response.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY не задан. Добавь его в Settings → Environment Variables на Vercel.",
    });
  }

  const { images } = req.body;
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: "Нет изображений" });
  }

  // Строим parts: сначала промпт, затем все картинки
  const imageParts = images.map(({ base64, mimeType }) => ({
    inline_data: { mime_type: mimeType || "image/png", data: base64 },
  }));

  try {
    const geminiData = await callGemini(apiKey, imageParts);
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    const clean = text.replace(/```json|```/gi, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return res.status(502).json({ error: "Gemini вернул не JSON: " + text });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
