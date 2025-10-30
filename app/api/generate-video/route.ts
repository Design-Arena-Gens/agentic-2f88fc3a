import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import gTTS from "gtts";
import { parseFile } from "music-metadata";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const maxDuration = 300;

type NewsItem = {
  title: string;
  content: string;
  author?: string;
  readMoreUrl?: string;
  date?: string;
};

type Segment = {
  item: NewsItem;
  start: number;
  end: number;
  index: number;
};

export async function POST(request: NextRequest) {
  let tempRoot: string | undefined;

  try {
    const body = await request
      .json()
      .catch(() => ({ category: "national", secondsPerSlide: 30 }));

    const category =
      typeof body?.category === "string" && body.category.trim().length > 0
        ? body.category.trim().toLowerCase()
        : "national";
    const secondsPerSlide =
      typeof body?.secondsPerSlide === "number" && body.secondsPerSlide >= 10
        ? Math.min(body.secondsPerSlide, 45)
        : 30;

    const newsItems = await fetchIndiaNews(category);
    if (newsItems.length === 0) {
      throw new Error("No current updates are available right now.");
    }

    const now = new Date();
    const formattedDate = now.toLocaleDateString("en-IN", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "Asia/Kolkata",
    });

    const title = `India News Briefing • ${formattedDate}`;
    const intro = `Welcome to your India news briefing for ${formattedDate}.`;
    const outro =
      "Thanks for watching. Subscribe for more daily updates from across India.";

    const scriptSegments = newsItems.map((item, index) => {
      const ordinal = index + 1;
      return `Update ${ordinal}: ${item.title}. ${sanitizeText(item.content)}`;
    });

    const script = [intro, ...scriptSegments, outro].join(" ");

    tempRoot = path.join(tmpdir(), `ytgen-${randomUUID()}`);
    await fs.mkdir(tempRoot, { recursive: true });

    const narrationPath = path.join(tempRoot, "narration.mp3");
    await synthesizeSpeech(script, narrationPath);

    const narrationMeta = await parseFile(narrationPath);
    const audioDuration = narrationMeta.format.duration ?? 0;
    const finalDurationSeconds = Math.max(240, Math.ceil(audioDuration));
    const paddedNarrationPath = path.join(tempRoot, "narration-padded.mp3");

    if (audioDuration < finalDurationSeconds - 1) {
      const paddingSeconds = finalDurationSeconds - audioDuration;
      await runFfmpeg([
        "-y",
        "-i",
        narrationPath,
        "-af",
        `apad=pad_dur=${Math.ceil(paddingSeconds)}`,
        "-t",
        `${finalDurationSeconds}`,
        paddedNarrationPath,
      ]);
    } else {
      await fs.copyFile(narrationPath, paddedNarrationPath);
    }

    const segmentCount = Math.max(
      newsItems.length,
      Math.ceil(finalDurationSeconds / secondsPerSlide)
    );

    const segments = createSegments({
      items: newsItems,
      secondsPerSlide,
      finalDurationSeconds,
      segmentCount,
    });

    const videoPath = path.join(tempRoot, "india-updates.mp4");
    await buildVideo({
      paddedAudioPath: paddedNarrationPath,
      finalDurationSeconds,
      segments,
      title,
      videoOutput: videoPath,
    });

    const videoBuffer = await fs.readFile(videoPath);
    const base64Video = videoBuffer.toString("base64");

    const descriptionLines = [
      `Latest national updates from India on ${formattedDate}.`,
      "",
      ...newsItems.map((item, index) => {
        const parts = [`${index + 1}. ${item.title}`];
        if (item.readMoreUrl) {
          parts.push(`More: ${item.readMoreUrl}`);
        }
        return parts.join(" ");
      }),
      "",
      "Generated automatically by the India Update Generator.",
    ];

    return NextResponse.json({
      videoBase64: base64Video,
      mimeType: "video/mp4",
      title,
      description: descriptionLines.join("\n"),
      script,
      durationSeconds: finalDurationSeconds,
      slideCount: segmentCount,
      secondsPerSlide,
      newsItems,
    });
  } catch (error) {
    console.error("[generate-video]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to build the requested video.",
      },
      { status: 500 }
    );
  } finally {
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function fetchIndiaNews(category: string): Promise<NewsItem[]> {
  const response = await fetch(
    `https://inshorts.deta.dev/news?category=${encodeURIComponent(category)}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("Unable to reach the India news service.");
  }

  const payload = (await response.json()) as {
    data?: NewsItem[];
  };

  return Array.isArray(payload?.data)
    ? payload.data
        .filter((item) => Boolean(item?.title) && Boolean(item?.content))
        .slice(0, 12)
    : [];
}

async function synthesizeSpeech(text: string, outputPath: string) {
  const voice = new gTTS(text, "en");

  await new Promise<void>((resolve, reject) => {
    voice.save(outputPath, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function sanitizeText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/["“”]/g, "'").trim();
}

function createSegments(options: {
  items: NewsItem[];
  secondsPerSlide: number;
  finalDurationSeconds: number;
  segmentCount: number;
}): Segment[] {
  const { items, secondsPerSlide, finalDurationSeconds, segmentCount } =
    options;

  return Array.from({ length: segmentCount }, (_, index) => {
    const start = index * secondsPerSlide;
    const end = Math.min(start + secondsPerSlide, finalDurationSeconds);
    const item = items[index % items.length];
    return { item, start, end, index };
  });
}

async function buildVideo(params: {
  paddedAudioPath: string;
  finalDurationSeconds: number;
  segments: Segment[];
  title: string;
  videoOutput: string;
}) {
  const {
    paddedAudioPath,
    finalDurationSeconds,
    segments,
    title,
    videoOutput,
  } = params;

  if (!ffmpegStatic) {
    throw new Error("FFmpeg binary was not resolved.");
  }

  const fontsBase = path.join(process.cwd(), "public", "fonts");
  const regularFont = path.join(fontsBase, "Manrope-Regular.ttf");
  const boldFont = path.join(fontsBase, "Manrope-Bold.ttf");

  const filterGraph = composeFilterGraph({
    segments,
    title,
    regularFont,
    boldFont,
  });

  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x020617:s=1280x720:d=${finalDurationSeconds}`,
    "-i",
    paddedAudioPath,
    "-filter_complex",
    filterGraph,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "-r",
    "30",
    "-t",
    `${finalDurationSeconds}`,
    videoOutput,
  ]);
}

function composeFilterGraph(options: {
  segments: Segment[];
  title: string;
  regularFont: string;
  boldFont: string;
}): string {
  const { segments, title, regularFont, boldFont } = options;

  const escapedRegularFont = escapePathForFfmpeg(regularFont);
  const escapedBoldFont = escapePathForFfmpeg(boldFont);

  const baseFilters = [
    "drawbox=t=fill:x=0:y=0:w=iw:h=ih:color=0x020617",
    "drawbox=t=fill:x=40:y=40:w=iw-80:h=ih-80:color=0x040c1f",
    "drawbox=t=fill:x=80:y=140:w=iw-160:h=ih-260:color=0x030a18aa",
    `drawtext=fontfile='${escapedBoldFont}':text='${escapeTextForFfmpeg(
      title
    )}':x=(w-text_w)/2:y=70:fontsize=54:fontcolor=0xE0F2FE`,
  ];

  const filters: string[] = [...baseFilters];

  segments.forEach((segment) => {
    const start = Number(segment.start.toFixed(2));
    const end = Number(segment.end.toFixed(2));
    const enable = `enable='between(t,${start},${end})'`;

    filters.push(
      `drawtext=${enable}:fontfile='${escapedBoldFont}':text='${escapeTextForFfmpeg(
        `Update ${segment.index + 1}`.toUpperCase()
      )}':x=120:y=180:fontsize=34:fontcolor=0x38BDF8`
    );

    const headlineLines = wrapText(segment.item.title, 30).slice(0, 3);
    headlineLines.forEach((line, index) => {
      const yPosition = 240 + index * 52;
      filters.push(
        `drawtext=${enable}:fontfile='${escapedBoldFont}':text='${escapeTextForFfmpeg(
          line
        )}':x=120:y=${yPosition}:fontsize=48:fontcolor=0xF8FAFC`
      );
    });

    const summaryLines = wrapText(sanitizeText(segment.item.content), 60).slice(
      0,
      5
    );
    summaryLines.forEach((line, summaryIndex) => {
      const yPosition = 400 + summaryIndex * 34;
      filters.push(
        `drawtext=${enable}:fontfile='${escapedRegularFont}':text='${escapeTextForFfmpeg(
          line
        )}':x=120:y=${yPosition}:fontsize=32:fontcolor=0xCBD5F5`
      );
    });
  });

  return filters.join(",");
}

function wrapText(source: string, maxCharactersPerLine: number): string[] {
  const words = source.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  words.forEach((word) => {
    const candidate = current.length ? `${current} ${word}` : word;
    if (candidate.length > maxCharactersPerLine && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

function escapeTextForFfmpeg(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/'/g, "\\\\'")
    .replace(/:/g, "\\\\:")
    .replace(/%/g, "\\\\%")
    .replace(/\[/g, "\\\\[")
    .replace(/\]/g, "\\\\]")
    .replace(/\n/g, "\\\\n");
}

function escapePathForFfmpeg(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/'/g, "'\\\\''");
}

async function runFfmpeg(args: string[]) {
  if (!ffmpegStatic) {
    throw new Error("FFmpeg binary missing.");
  }

  await execFileAsync(ffmpegStatic, args);
}
