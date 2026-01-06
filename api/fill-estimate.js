// api/fill-estimate.js
// Vercel Function
// POST body: { imageDataUrl: "data:image/jpeg;base64,..." }
// Returns: { percent_full: 0..100, fill_fraction: 0..1 }

function parseDataUrl(dataUrl) {
  const m = String(dataUrl || "").match(/^data:(.+?);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

function extractPercent(text) {
  // Accept "70", "70%", "The bottle is ~70% full"
  const m = String(text || "").match(/(\d{1,3})/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export default async function handler(req, res) {
  // CORS (lets localhost call your Vercel API)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY on Vercel" });
    }

    const { imageDataUrl } = req.body || {};
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return res.status(400).json({ error: "Missing imageDataUrl" });
    }

    const parsed = parseDataUrl(imageDataUrl);
    if (!parsed) {
      return res.status(400).json({
        error: "imageDataUrl must be a data URL like data:image/jpeg;base64,...",
      });
    }

    // Gemini REST endpoint (no SDK)
    const model = "gemini-3-flash-preview";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const prompt = `
Estimate how full the liquid container is in the photo on a 0–100 scale.

Use this method BEFORE deciding the number:
1) Locate the container TOP and BOTTOM.
2) Locate the liquid surface line (waterline/meniscus).
3) Use stable landmarks (labels/logos/handle joints/printed text) as anchors.
4) Consider container geometry: tapering means height ≠ volume.
5) Consider camera angle and glare; compensate conservatively.

Return ONLY a single integer from 0 to 100.
No words. No % sign. No extra characters.
`.trim();

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: parsed.mimeType,
                data: parsed.data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 20
      }
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(body),
    });

    const json = await resp.json().catch(() => null);

    if (!resp.ok) {
      return res.status(resp.status).json({
        error: "Gemini API error",
        detail: json || null,
      });
    }

    const text =
      json?.candidates?.[0]?.content?.parts
        ?.map((p) => p?.text)
        .filter(Boolean)
        .join(" ") || "";

    const percent = extractPercent(text);
    if (percent == null) {
      return res.status(500).json({
        error: "Could not parse percent from Gemini output",
        raw: text,
        detail: json,
      });
    }

    return res.status(200).json({
      percent_full: percent,
      fill_fraction: percent / 100,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Serverless function crashed",
      detail: err?.message || String(err),
    });
  }
}