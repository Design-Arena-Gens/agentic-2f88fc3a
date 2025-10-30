"use client";

import { useEffect, useMemo, useState } from "react";

type GeneratedNews = {
  title: string;
  content: string;
  author?: string;
  readMoreUrl?: string;
};

type GenerateResponse = {
  videoBase64: string;
  mimeType: string;
  title: string;
  description: string;
  script: string;
  durationSeconds: number;
  slideCount: number;
  secondsPerSlide: number;
  newsItems: GeneratedNews[];
};

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "success"; url: string }
  | { status: "error"; message: string };

export default function Home() {
  const [category, setCategory] = useState("national");
  const [secondsPerSlide, setSecondsPerSlide] = useState(30);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({
    status: "idle",
  });

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [accessToken, setAccessToken] = useState("");

  useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  const formattedDuration = useMemo(() => {
    if (!result) return "";
    const minutes = Math.floor(result.durationSeconds / 60);
    const seconds = result.durationSeconds % 60;
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }, [result]);

  async function handleGenerate() {
    try {
      setIsGenerating(true);
      setLastError(null);
      setUploadState({ status: "idle" });

      const response = await fetch("/api/generate-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category,
          secondsPerSlide: Number.isFinite(secondsPerSlide)
            ? secondsPerSlide
            : 30,
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.error ?? "Failed to generate video.");
      }

      const data = (await response.json()) as GenerateResponse;
      const binary = atob(data.videoBase64);
      const length = binary.length;
      const bytes = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }

      const blob = new Blob([bytes], { type: data.mimeType });
      const file = new File([blob], "india-update.mp4", {
        type: data.mimeType,
      });
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      setVideoFile(file);
      setResult(data);
    } catch (error) {
      setLastError(
        error instanceof Error ? error.message : "Unable to build the video."
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleUpload() {
    if (!videoFile || !result) {
      setUploadState({
        status: "error",
        message: "Generate a video before uploading.",
      });
      return;
    }

    if (!clientId || !clientSecret || !refreshToken) {
      setUploadState({
        status: "error",
        message: "Provide OAuth client ID, client secret, and refresh token.",
      });
      return;
    }

    try {
      setUploadState({ status: "uploading" });
      const formData = new FormData();
      formData.append("file", videoFile);
      formData.append("title", result.title);
      formData.append("description", result.description);
      formData.append("tags", JSON.stringify(["India", "News", "Updates"]));
      formData.append("clientId", clientId);
      formData.append("clientSecret", clientSecret);
      formData.append("refreshToken", refreshToken);
      if (accessToken) {
        formData.append("accessToken", accessToken);
      }

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Upload failed.");
      }

      const payload = await response.json();
      setUploadState({
        status: "success",
        url: payload.youtubeUrl,
      });
    } catch (error) {
      setUploadState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Unexpected upload error.",
      });
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 pb-24 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-sky-400">
              India Update Video Generator
            </h1>
            <p className="max-w-2xl text-sm text-slate-300">
              Build a 4+ minute ready-to-upload YouTube briefing covering India&apos;s
              latest national headlines, complete with narration, slides, and
              publishing workflow.
            </p>
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="inline-flex items-center justify-center rounded-full bg-sky-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-sky-500/30 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-600"
          >
            {isGenerating ? "Generating…" : "Generate Latest Video"}
          </button>
        </div>
      </header>

      <main className="mx-auto mt-10 flex max-w-6xl flex-col gap-10 px-6">
        <section className="grid gap-8 md:grid-cols-[2fr,3fr]">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-lg font-semibold text-sky-300">
              Generation Settings
            </h2>
            <div className="mt-4 space-y-5 text-sm">
              <label className="block space-y-2">
                <span className="text-slate-300">News category</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-400/30"
                >
                  <option value="national">National</option>
                  <option value="business">Business</option>
                  <option value="technology">Technology</option>
                  <option value="sports">Sports</option>
                  <option value="entertainment">Entertainment</option>
                  <option value="science">Science</option>
                  <option value="world">World</option>
                </select>
              </label>

              <label className="block space-y-2">
                <span className="text-slate-300">Seconds per slide</span>
                <input
                  type="number"
                  min={10}
                  max={45}
                  value={secondsPerSlide}
                  onChange={(event) =>
                    setSecondsPerSlide(Number(event.target.value))
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-400/30"
                />
              </label>

              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow shadow-sky-400/25 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-600"
              >
                {isGenerating ? "Building video…" : "Generate video"}
              </button>

              {lastError && (
                <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                  {lastError}
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-6">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
              <h2 className="text-lg font-semibold text-sky-300">Preview</h2>
              {videoUrl && result ? (
                <div className="mt-4 space-y-4">
                  <video
                    className="w-full overflow-hidden rounded-2xl border border-slate-800"
                    controls
                    src={videoUrl}
                  />
                  <div className="grid gap-2 text-sm">
                    <p className="text-slate-200">
                      <span className="font-semibold text-sky-200">
                        Title:
                      </span>{" "}
                      {result.title}
                    </p>
                    <p className="text-slate-200">
                      <span className="font-semibold text-sky-200">
                        Duration:
                      </span>{" "}
                      {formattedDuration}
                    </p>
                    <p className="text-slate-200">
                      <span className="font-semibold text-sky-200">
                        Slides:
                      </span>{" "}
                      {result.slideCount} slides at {result.secondsPerSlide}s each
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <a
                      href={videoUrl}
                      download="india-update.mp4"
                      className="inline-flex items-center justify-center rounded-full border border-sky-500 px-4 py-2 text-sm font-semibold text-sky-300 transition hover:bg-sky-500/10"
                    >
                      Download MP4
                    </a>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(result.script)}
                      className="inline-flex items-center justify-center rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-slate-800/70"
                    >
                      Copy narration script
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-400">
                  Generate a video to preview narration, slides, and download.
                </p>
              )}
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
              <h2 className="text-lg font-semibold text-sky-300">
                YouTube Upload
              </h2>
              <p className="mt-2 text-xs text-slate-400">
                Provide OAuth credentials from your Google Cloud project. The
                refresh token must include `youtube.upload` scope.
              </p>

              <div className="mt-4 space-y-3 text-xs">
                <input
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  placeholder="OAuth client ID"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-400/30"
                />
                <input
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                  placeholder="OAuth client secret"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-400/30"
                />
                <input
                  value={refreshToken}
                  onChange={(event) => setRefreshToken(event.target.value)}
                  placeholder="Refresh token"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-400/30"
                />
                <input
                  value={accessToken}
                  onChange={(event) => setAccessToken(event.target.value)}
                  placeholder="Access token (optional)"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-400/30"
                />

                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={uploadState.status === "uploading"}
                  className="w-full rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow shadow-red-500/20 transition hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-slate-600"
                >
                  {uploadState.status === "uploading"
                    ? "Uploading to YouTube…"
                    : "Upload to YouTube"}
                </button>

                {uploadState.status === "success" && (
                  <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    Upload complete!{" "}
                    <a
                      href={uploadState.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Watch on YouTube
                    </a>
                  </p>
                )}

                {uploadState.status === "error" && (
                  <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    {uploadState.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {result && (
          <section className="grid gap-6 lg:grid-cols-[3fr,2fr]">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
              <h2 className="text-lg font-semibold text-sky-300">
                Narration Script
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                {result.script}
              </p>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6">
              <h2 className="text-lg font-semibold text-sky-300">
                Headlines Covered
              </h2>
              <ul className="mt-3 space-y-3 text-sm text-slate-200">
                {result.newsItems.map((item, index) => (
                  <li
                    key={`${item.title}-${index.toString()}`}
                    className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3"
                  >
                    <p className="text-xs uppercase tracking-wide text-sky-300">
                      Update {index + 1}
                    </p>
                    <p className="mt-1 font-semibold text-slate-100">
                      {item.title}
                    </p>
                    <p className="mt-1 text-slate-300">{item.content}</p>
                    {item.readMoreUrl && (
                      <a
                        href={item.readMoreUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-xs text-sky-300 underline"
                      >
                        Read original coverage
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
