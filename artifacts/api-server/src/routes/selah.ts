import express, { Router, type IRouter } from "express";
import {
  GetScriptureQueryParams,
  GetScriptureResponse,
  TranscribeAudioResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const bibleApiBase = process.env.VITE_API_BIBLE_ENDPOINT || "https://rest.api.bible/v1";
const whisperModels = [
  process.env.VITE_HF_MODEL_PRIMARY || "openai/whisper-tiny",
  process.env.VITE_HF_MODEL_FALLBACK_1 || "openai/whisper-base",
  process.env.VITE_HF_MODEL_FALLBACK_2 || "openai/whisper-small",
  process.env.VITE_HF_MODEL_FALLBACK_3 || "openai/whisper-medium",
] as const;
const maxAudioBytes = 25 * 1024 * 1024;

type ApiBiblePassage = {
  id?: string;
  bibleId?: string;
  reference?: string;
  content?: string;
  verseCount?: number;
  copyright?: string | null;
};

router.get("/scripture", async (req, res): Promise<void> => {
  const parsed = GetScriptureQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "A Bible ID and passage ID are required." });
    return;
  }

  const apiKey = process.env.API_BIBLE_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Scripture lookup is not configured." });
    return;
  }

  const { bibleId, passageId } = parsed.data;
  const endpoint = new URL(
    `${bibleApiBase}/bibles/${encodeURIComponent(bibleId)}/passages/${encodeURIComponent(passageId)}`,
  );
  endpoint.searchParams.set("content-type", "text");
  endpoint.searchParams.set("include-verse-numbers", "true");
  endpoint.searchParams.set("include-chapter-numbers", "true");
  endpoint.searchParams.set("include-titles", "false");

  try {
    const response = await fetch(endpoint, {
      headers: { "api-key": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      req.log.warn(
        { upstreamStatus: response.status },
        "API.Bible passage request failed",
      );
      if (response.status === 404) {
        res.status(404).json({ error: "The requested passage was not found." });
        return;
      }
      if (response.status === 401) {
        res.status(401).json({ error: "API.Bible rejected the server API key." });
        return;
      }
      if (response.status === 403) {
        res.status(403).json({ error: "This API.Bible key does not have access to the selected translation." });
        return;
      }
      res.status(502).json({ error: "The requested passage could not be loaded." });
      return;
    }

    const payload = (await response.json()) as { data?: ApiBiblePassage };
    const data = payload.data;
    if (
      !data ||
      typeof data.content !== "string" ||
      typeof data.id !== "string" ||
      typeof data.bibleId !== "string" ||
      typeof data.reference !== "string" ||
      typeof data.verseCount !== "number"
    ) {
      req.log.warn("API.Bible returned an incomplete passage");
      res.status(502).json({ error: "The scripture provider returned invalid data." });
      return;
    }

    res.json(
      GetScriptureResponse.parse({
        id: data.id,
        bibleId: data.bibleId,
        reference: data.reference,
        content: data.content,
        verseCount: data.verseCount,
        copyright: data.copyright ?? null,
      }),
    );
  } catch (error) {
    req.log.warn({ err: error }, "API.Bible passage request could not complete");
    res.status(502).json({ error: "The scripture provider is temporarily unavailable." });
  }
});

router.post(
  "/transcribe",
  express.raw({
    type: ["audio/*", "application/octet-stream"],
    limit: maxAudioBytes,
  }),
  async (req, res): Promise<void> => {
    if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
      res.status(400).json({ error: "A non-empty audio recording is required." });
      return;
    }
    if (req.body.byteLength > maxAudioBytes) {
      res.status(413).json({ error: "Audio recordings must be 25 MB or smaller." });
      return;
    }

    const token = process.env.HF_ACCESS_TOKEN;
    if (!token) {
      res.status(503).json({ error: "Voice transcription is not configured." });
      return;
    }

    const contentType = (req.get("content-type") ?? "application/octet-stream")
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    const audioType =
      contentType && contentType.startsWith("audio/")
        ? contentType
        : "application/octet-stream";
    const audioBuffer = new ArrayBuffer(req.body.byteLength);
    new Uint8Array(audioBuffer).set(req.body);
    const audio = new Blob([audioBuffer], { type: audioType });

    for (const model of whisperModels) {
      try {
        const response = await fetch(
          `https://router.huggingface.co/hf-inference/models/${model}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": audioType,
              accept: "application/json",
            },
            body: audio,
            signal: AbortSignal.timeout(25_000),
          },
        );

        if (!response.ok) {
          req.log.warn(
            { model, upstreamStatus: response.status },
            "Whisper model failed; trying the next model",
          );
          continue;
        }

        const result = (await response.json()) as
          | { text?: unknown }
          | Array<{ text?: unknown }>;
        const firstResult = Array.isArray(result) ? result[0] : result;
        if (typeof firstResult?.text !== "string" || !firstResult.text.trim()) {
          req.log.warn({ model }, "Whisper returned an empty transcription");
          continue;
        }

        res.json(
          TranscribeAudioResponse.parse({
            text: firstResult.text.trim(),
            model,
          }),
        );
        return;
      } catch (error) {
        req.log.warn({ model, err: error }, "Whisper failed; trying the next model");
      }
    }

    res.status(502).json({
      error: "Speech transcription failed on all configured models.",
    });
  },
);

export default router;
