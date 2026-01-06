import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FillEstimate = z.object({
  fill_fraction: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  needs_manual: z.boolean(),
  reason: z.string(),
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    const { imageDataUrl } = req.body || {};
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return res.status(400).json({
        error: "Missing imageDataUrl. Send a string like data:image/jpeg;base64,....",
      });
    }

    const response = await openai.responses.parse({
      model: "gpt-4o-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Task: estimate how full a transparent bottle/container is.\n" +
                "Return fill_fraction between 0 and 1 (1=full, 0=empty).\n" +
                "If you can't clearly see a waterline due to glare, reflections, labels, background clutter, angle, or opacity, set needs_manual=true and confidence low.\n" +
                "Be conservative. Only high confidence if the waterline is genuinely visible.\n" +
                "Output MUST match the JSON schema.",
            },
            { type: "input_image", image_url: imageDataUrl },
          ],
        },
      ],
      text: { format: zodTextFormat(FillEstimate, "fill_estimate") },
    });

    return res.status(200).json(response.output_parsed);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: "Server error", detail: String(err?.message || err) });
  }
}
