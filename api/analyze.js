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

// Собираем все доступные ключи из env: GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3 ...
function getApiKeys() {
  const keys = [];
  // Основной ключ
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  // Дополнительные ключи: GEMINI_API_KEY_2, GEMINI_API_KEY_3, ...
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) keys.push(k);
  }
  return keys;
}

async function callGeminiWithKey(apiKey, imageParts, attempt = 1) {
  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, ...imageParts] }],
      generationConfig: { temperature: 0, maxOutputTokens: 4096 },
    }),
  });

  // 503 / 500 — перегрузка серверов, повторяем с тем же ключом
  if (response.status === 503 || response.status === 500) {
    if (attempt >= 4) {
      throw { type: "overloaded" };
    }
    await sleep(3000 * Math.pow(2, attempt - 1)); // 3с → 6с → 12с
    return callGeminiWithKey(apiKey, imageParts, attempt + 1);
  }

  // 429 — лимит этого ключа исчерпан, сигнализируем чтобы переключиться
  if (response.status === 429) {
    const body = await response.json().catch(() => ({}));
    const retryDelay = body?.error?.details?.find(
      (d) => d.retryDelay,
    )?.retryDelay;
    throw { type: "quota", retryDelay };
  }

  // 403 — ключ недействителен
  if (response.status === 403) {
    throw { type: "invalid_key" };
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw {
      type: "error",
      message: body?.error?.message ?? `HTTP ${response.status}`,
    };
  }

  return response.json();
}

// Перебирает все ключи по очереди, при 429 переходит к следующему
async function callGemini(imageParts) {
  const keys = getApiKeys();
  if (keys.length === 0) {
    throw new Error(
      "Нет API ключей. Добавь GEMINI_API_KEY в Settings → Environment Variables на Vercel.",
    );
  }

  let lastError = null;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const keyLabel = i === 0 ? "основной" : `#${i + 1}`;

    try {
      const data = await callGeminiWithKey(key, imageParts);
      return data; // успех
    } catch (err) {
      if (err.type === "quota") {
        // Лимит этого ключа — пробуем следующий
        lastError = `Ключ ${keyLabel}: лимит исчерпан`;
        continue;
      }
      if (err.type === "invalid_key") {
        lastError = `Ключ ${keyLabel}: недействителен`;
        continue;
      }
      if (err.type === "overloaded") {
        throw new Error(
          "Серверы Gemini перегружены. Попробуй через несколько секунд.",
        );
      }
      // Любая другая ошибка — пробрасываем
      throw new Error(err.message ?? "Неизвестная ошибка Gemini");
    }
  }

  // Все ключи исчерпаны
  throw new Error(
    `Все ключи исчерпали дневной лимит (RPD). ` +
      `Добавь новые ключи (GEMINI_API_KEY_2, GEMINI_API_KEY_3...) или подожди до полуночи UTC. ` +
      `Детали: ${lastError}`,
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { images } = req.body;
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: "Нет изображений" });
  }

  const imageParts = images.map(({ base64, mimeType }) => ({
    inline_data: { mime_type: mimeType || "image/png", data: base64 },
  }));

  try {
    const geminiData = await callGemini(imageParts);
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    const clean = text.replace(/```json|```/gi, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      // Восстанавливаем обрезанный JSON
      try {
        let fixed = clean;
        const opens =
          (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;
        const openBraces =
          (fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length;
        fixed = fixed.replace(/,?\s*"[^"]*$/, "");
        for (let i = 0; i < opens; i++) fixed += "]";
        for (let i = 0; i < openBraces; i++) fixed += "}";
        parsed = JSON.parse(fixed);
      } catch {
        return res
          .status(502)
          .json({ error: "Gemini вернул не JSON: " + text });
      }
    }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
