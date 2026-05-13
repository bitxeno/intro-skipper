import type { ShowItem, SeasonItem, EpisodeItem, ApiResult, TimestampMap } from "../types.ts";
import * as jellyfinClient from "../store/jellyfin-client.ts";
import * as api from "../store/api.ts";
import { mapWithConcurrency } from "../utils.ts";

const TIMESTAMP_FETCH_CONCURRENCY = 6;

export type LibraryItem = { Id: string; Name: string };

export function getLibraries(): Promise<LibraryItem[]> {
    return jellyfinClient.getLibraries();
}

export function getShowsInLibrary(libraryId: string, libraryName: string): Promise<ShowItem[]> {
    return jellyfinClient.getShowsInLibrary(libraryId, libraryName);
}

export function getSeasons(showId: string): Promise<SeasonItem[]> {
    return jellyfinClient.getSeasons(showId);
}

export async function getEpisodesWithTimestamps(
    showId: string,
    seasonId: string,
): Promise<{
    episodes: EpisodeItem[];
    timestamps: Array<ApiResult<TimestampMap> | null>;
    hasSegments: boolean[];
}> {
    const episodes = await jellyfinClient.getEpisodes(showId, seasonId);

    if (episodes.length === 0) {
        return { episodes: [], timestamps: [], hasSegments: [] };
    }

    const rows = await mapWithConcurrency(episodes, TIMESTAMP_FETCH_CONCURRENCY, async (ep) => {
        const [timestamps, hasSegments] = await Promise.all([
            api.getEpisodeTimestamps(ep.Id),
            api.getEpisodeHasSegments(ep.Id),
        ]);

        return {
            timestamps,
            hasSegments: hasSegments.ok && hasSegments.data === true,
        };
    });

    return {
        episodes,
        timestamps: rows.map((row) => row.timestamps),
        hasSegments: rows.map((row) => row.hasSegments),
    };
}

export async function getMovieTimestamps(showId: string): Promise<{
    timestamps: ApiResult<TimestampMap>;
    hasSegments: boolean;
}> {
    const [timestamps, hasSegments] = await Promise.all([
        api.getEpisodeTimestamps(showId),
        api.getEpisodeHasSegments(showId),
    ]);

    return {
        timestamps,
        hasSegments: hasSegments.ok && hasSegments.data === true,
    };
}
