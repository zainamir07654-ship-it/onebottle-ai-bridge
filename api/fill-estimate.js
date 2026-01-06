import { GoogleGenAI, MediaResolution } from "@google/genai";
import { z } from "zod";

// Output: ONLY one integer 0..100
const OutputSchema = z.object({
  percent_full: z.number().int().min(0).max(100),
});

function parseDataUrl(dataUrl) {
  // Expected: data:image/jpeg;base64,AAAA...
  const m = String(dataUrl || "").match(/^data:(.+);base64,(.*)$/);
  if (!m) return null;
  return { mimeType: m[1], base64: m[2] };
}

export default async function handler(req, res) {
  // Basic CORS (helps when calling from localhost / browser)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
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

    const ai = new GoogleGenAI({});

    // Gemini 3 Flash (preview)
    const model = "gemini-3-flash-preview";

    // Prompt: force the “Gemini-app-like” landmark reasoning, but return ONLY the number.
    const prompt =
      "Estimate the water level in this bottle/container on a scale of 0–100%.\n" +
      "\n" +
      "Use this method BEFORE deciding the number:\n" +
      "1) Find the container TOP boundary and BOTTOM boundary.\n" +
      "2) Find the liquid surface line (waterline/meniscus).\n" +
      "3) Use stable landmarks (labels/logos/printed text/handle joints) as anchors.\n" +
      "4) Consider geometry: tapering means height is not perfectly proportional to volume.\n" +
      "5) Consider camera angle: if shot from above/below, compensate conservatively.\n" +
      "\n" +
      "Return ONLY JSON in this exact format: { \"percent_full\": <integer 0..100> }.\n" +
      "Do not include any extra keys or text.";

    // Zod v4 -> JSON Schema for Gemini structured outputs
    const responseJsonSchema = z.toJSONSchema(OutputSchema);

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: parsed.mimeType, data: parsed.base64 } },
          ],
        },
      ],
      config: {
        // Make Gemini “look harder” at the image
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,

        // Make responses deterministic (less creative)
        temperature: 0.2,

        // Gemini 3 Flash supports these levels; "high" can be slower but more careful
        thinkingConfig: { thinkingLevel: "medium" },

        // Force strict JSON output
        responseMimeType: "application/json",
        responseJsonSchema,

        // Keep output short
        maxOutputTokens: 80,
      },
    });

    const raw = JSON.parse(response.text);
    const out = OutputSchema.parse(raw);

    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({
      error: "Gemini request failed",
      detail: err?.message || String(err),
    });
  }
}