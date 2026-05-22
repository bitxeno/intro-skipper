import type { ApiResult, EpisodeItem, TimestampMap } from "../types.ts";
import { loadPluginConfig } from "./api.ts";

const API_BASE_URL = "https://api.theintrodb.org/v3";
const END_OF_MEDIA_TOLERANCE_SEC = 1;

type SupportedTimestampKey = "Introduction" | "Recap" | "Credits" | "Preview";
type IntroDbSegmentType = "intro" | "recap" | "credits" | "preview";

const SEGMENT_MAPPINGS: ReadonlyArray<{
    source: SupportedTimestampKey;
    target: IntroDbSegmentType;
}> = [
    { source: "Introduction", target: "intro" },
    { source: "Recap", target: "recap" },
    { source: "Credits", target: "credits" },
    { source: "Preview", target: "preview" },
];

export type IntroDbSubmissionPayload = {
    tmdb_id: number;
    type: "tv";
    season: string;
    episode: string;
    segment: IntroDbSegmentType;
    start_ms: number | null;
    end_ms: number | null;
    imdb_id?: string;
    video_duration_ms?: number | null;
};

export type IntroDbSubmissionPlanEntry = {
    episodeId: string;
    episodeName: string;
    episodeNumber: number;
    segmentLabel: string;
    payload: IntroDbSubmissionPayload;
};

export type IntroDbSubmissionResult = {
    submitted: number;
    conflicts: number;
    failed: number;
    unauthorized: boolean;
    errors: string[];
};

function getRuntimeSeconds(episode: EpisodeItem): number | null {
    if (!episode.RunTimeTicks) {
        return null;
    }

    return episode.RunTimeTicks / 10_000_000;
}

function isTimestampPresent(segment: { Start: number; End: number } | undefined): segment is {
    Start: number;
    End: number;
} {
    return !!segment && (segment.Start !== 0 || segment.End !== 0);
}

function normalizeStart(
    segment: IntroDbSegmentType,
    start: number,
): number | null {
    if (segment === "intro" || segment === "recap") {
        return start <= 0 ? null : start;
    }

    return start;
}

function normalizeEnd(
    segment: IntroDbSegmentType,
    end: number,
    runtimeSeconds: number | null,
): number | null {
    if (
        (segment === "credits" || segment === "preview") &&
        runtimeSeconds !== null &&
        Math.abs(runtimeSeconds - end) <= END_OF_MEDIA_TOLERANCE_SEC
    ) {
        return null;
    }

    return end;
}

export async function getConfiguredApiKey(): Promise<string> {
    const config = await loadPluginConfig();
    return config.TheIntroDbApiKey?.trim() ?? "";
}

export function getExternalIds(providerIds: Record<string, string> | undefined): {
    tmdbId: number | null;
    imdbId: string | undefined;
} {
    const tmdbRaw =
        providerIds?.Tmdb ?? providerIds?.TMDB ?? providerIds?.tmdb ?? null;
    const imdbId =
        providerIds?.Imdb ?? providerIds?.IMDb ?? providerIds?.IMDB ?? providerIds?.imdb;

    if (!tmdbRaw) {
        return { tmdbId: null, imdbId };
    }

    const tmdbId = Number(tmdbRaw);
    return {
        tmdbId: Number.isInteger(tmdbId) && tmdbId > 0 ? tmdbId : null,
        imdbId,
    };
}

export function buildSeasonSubmissionPlan(opts: {
    tmdbId: number;
    imdbId?: string;
    seasonNumber: number;
    episodes: EpisodeItem[];
    timestamps: Array<ApiResult<TimestampMap> | null>;
}): IntroDbSubmissionPlanEntry[] {
    const plan: IntroDbSubmissionPlanEntry[] = [];

    for (let index = 0; index < opts.episodes.length; index++) {
        const episode = opts.episodes[index];
        const result = opts.timestamps[index];

        if (!result?.ok || !result.data || episode.IndexNumber == null) {
            continue;
        }

        const runtimeSeconds = getRuntimeSeconds(episode);

        for (const mapping of SEGMENT_MAPPINGS) {
            const segment = result.data[mapping.source];
            if (!isTimestampPresent(segment)) {
                continue;
            }

            const normalizedStart = normalizeStart(mapping.target, segment.Start);
            const normalizedEnd = normalizeEnd(mapping.target, segment.End, runtimeSeconds);

            plan.push({
                episodeId: episode.Id,
                episodeName: episode.Name,
                episodeNumber: episode.IndexNumber,
                segmentLabel: mapping.source,
                payload: {
                    tmdb_id: opts.tmdbId,
                    type: "tv",
                    season: String(opts.seasonNumber),
                    episode: String(episode.IndexNumber),
                    segment: mapping.target,
                    start_ms: normalizedStart == null ? null : Math.round(normalizedStart * 1000),
                    end_ms: normalizedEnd == null ? null : Math.round(normalizedEnd * 1000),
                    ...(opts.imdbId ? { imdb_id: opts.imdbId } : {}),
                    ...(runtimeSeconds != null ? { video_duration_ms: Math.round(runtimeSeconds * 1000) } : {}),
                },
            });
        }
    }

    return plan;
}

export async function submitSeasonPlan(
    apiKey: string,
    plan: IntroDbSubmissionPlanEntry[],
    onProgress?: (current: number, total: number, entry: IntroDbSubmissionPlanEntry) => void,
): Promise<IntroDbSubmissionResult> {
    const result: IntroDbSubmissionResult = {
        submitted: 0,
        conflicts: 0,
        failed: 0,
        unauthorized: false,
        errors: [],
    };

    for (let index = 0; index < plan.length; index++) {
        const entry = plan[index];
        onProgress?.(index + 1, plan.length, entry);

        const response = await fetch(API_BASE_URL + "/submit", {
            method: "POST",
            headers: {
                Authorization: "Bearer " + apiKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(entry.payload),
        });

        if (response.ok) {
            result.submitted += 1;
            continue;
        }

        let errorMessage = "HTTP " + response.status;
        try {
            const data = await response.json();
            if (data) {
                if (typeof data.error === 'string' && data.error.trim() !== '') {
                    errorMessage = data.error;
                } else if (typeof data.message === 'string' && data.message.trim() !== '') {
                    errorMessage = data.message;
                } else if (typeof data.details === 'string' && data.details.trim() !== '') {
                    errorMessage = data.details;
                } else if (Array.isArray((data as any).errors) && (data as any).errors.length > 0) {
                    const errs = (data as any).errors.map((e: any) => (typeof e === 'string' ? e : e?.message ?? String(e)));
                    errorMessage = errs.join('; ');
                }
            }
        } catch {
            // Leave the generic HTTP error in place when the response is not JSON or cannot be parsed.
        }

        if (response.status === 401) {
            result.unauthorized = true;
            result.errors.push("TheIntroDB API key was rejected.");
            break;
        }

        if (response.status === 409) {
            result.conflicts += 1;
            continue;
        }

        result.failed += 1;
        result.errors.push(
            "E" +
                String(entry.episodeNumber).padStart(2, "0") +
                " " +
                entry.segmentLabel +
                ": " +
                errorMessage,
        );
    }

    return result;
}
