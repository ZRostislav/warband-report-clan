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

const PROMPT_24TH_BAV = `Ты анализируешь один или несколько скриншотов таблицы результатов из игры Mount & Blade: Warband для полка 24th Bavarian.

Твоя задача — извлечь из всех изображений вместе:
1. Счёт команд (два числа, например 3:1 или 5:2) — бери из любого скриншота где он виден
2. Список ВСЕХ уникальных игроков нашей команды со всех скриншотов с их ВОИНСКИМИ ЗВАНИЯМИ

=== ПОЛНАЯ ИЕРАРХИЯ ЗВАНИЙ ===

Секция "Ст.Офіцерський склад":
  Colonel       (теги в нике: Col, Cln, Colonel)
  Oberstleutnant (теги: ObstLt, OLt, Oberstlt)
  Sachbearbeiter (теги: Sach, Sbr)
  Major         (теги: Maj, Major)

Секция "Офіцерський склад":
  Hauptmann     (теги: Hpt, Hptm, Hauptm)
  Oberleutnant  (теги: OLnt, OLt, Oberlnt)
  Leutnant      (теги: Lnt, Lt, Leutnant)
  Feldwebelleutnant (теги: FwLnt, FwLt)
  Fahnrich      (теги: Fhr, Fhn, Fahnrich)
  Offiziersstellvertreter (теги: OStv, Ostv)

Секция "Мл.Офіцерський склад":
  Oberfeldwebel (теги: OFw, OFW, Obfw)
  Feldwebel     (теги: Fw, FW, Feldw)
  Unterfeldwebel (теги: UFw, UFW)
  Senior Sergeant (теги: SSgt, SrSgt, SSrg)
  Sergeant      (теги: Sgt, Srg)
  Korporal      (теги: Kpl, Korp, Cpl)

Секція "Гренадерський склад":
  OberGrenadier (теги: OGrd, OGrn, OberGrd)
  Grenadier     (теги: Grd, Grn, Gren)

Секція "Рядовий склад":
  Stabsgefreiter (теги: StGfr, SGfr)
  Hauptgefreiter (теги: HGfr, Hgfr)
  Obergefreiter  (теги: OGfr, Ogfr)
  Giefraitor    (теги: Gfr, Gfr)
  Fusilier      (теги: Fus, Fsl, Fzl)
  Schutze       (теги: Stz, Scht, Sch)

Секція "Кадетський склад":
  Oberkadett    (теги: OKdt, OKad)
  Kadett        (теги: Kdt, Kad)
  Unterkadett   (теги: UKdt, UKad)

Секція "Найманці":
  Mercenary     (тег [Merc] в нікнеймі — це завжди найманець)

=== ПРАВИЛА РОЗПІЗНАВАННЯ ===
- Нікнейми зазвичай виглядають як [24th_Lnt]Vulf або [24th_OGrd]Adam
- Частина після тегу [] — це ім'я гравця (бери лише її)
- Скорочення звання знаходиться всередині дужок після префіксу полку (24th_, 24_)
- Приклади: [24th_Lnt]Vulf → Leutnant, Vulf, Офіцерський склад
             [24th_OGrd]Adam → OberGrenadier, Adam, Гренадерський склад
             [Merc]Boris → Mercenary, Boris, Найманці
- Якщо звання не вдається розпізнати — ставь "Schutze", секція "Рядовий склад"
- Ігноруй заголовки колонок: Kill, Death, Score, Ping, Player, Name
- Не додавай дублікати
- Якщо рахунок не видно — пиши null

Ответь СТРОГО в формате JSON, без markdown, без пояснений:
{
  "score": { "team1": <число або null>, "team2": <число або null> },
  "players": {
    "team1": [
      {"name": "Vulf", "rank": "Leutnant", "section": "Офіцерський склад"},
      {"name": "Adam", "rank": "OberGrenadier", "section": "Гренадерський склад"},
      {"name": "Boris", "rank": "Mercenary", "section": "Найманці"}
    ],
    "team2": []
  }
}

Допустимі значення секцій: "Ст.Офіцерський склад", "Офіцерський склад", "Мл.Офіцерський склад", "Гренадерський склад", "Рядовий склад", "Кадетський склад", "Найманці"
Якщо секція невідома — "Рядовий склад".`;

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

async function callGeminiWithKey(apiKey, imageParts, prompt, attempt = 1) {
  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, ...imageParts] }],
      generationConfig: { temperature: 0, maxOutputTokens: 4096 },
    }),
  });

  // 503 / 500 — перегрузка серверов, повторяем с тем же ключом
  if (response.status === 503 || response.status === 500) {
    if (attempt >= 4) {
      throw { type: "overloaded" };
    }
    await sleep(3000 * Math.pow(2, attempt - 1)); // 3с → 6с → 12с
    return callGeminiWithKey(apiKey, imageParts, prompt, attempt + 1);
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
async function callGemini(imageParts, prompt) {
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
      const data = await callGeminiWithKey(key, imageParts, prompt);
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

  const { images, mode } = req.body;
  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: "Нет изображений" });
  }

  const imageParts = images.map(({ base64, mimeType }) => ({
    inline_data: { mime_type: mimeType || "image/png", data: base64 },
  }));

  const selectedPrompt = mode === "24thBav" ? PROMPT_24TH_BAV : PROMPT;

  try {
    const geminiData = await callGemini(imageParts, selectedPrompt);
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
