import { getJson } from "./api.ts";
import type {
    JellyfinItemsResponse,
    JellyfinLibraryItem,
    JellyfinMediaItem,
    JellyfinSeasonItem,
    JellyfinEpisodeItem,
    LibraryInfo,
    ShowItem,
    SeasonItem,
    EpisodeItem,
    SupportedCollectionType,
} from "../types.ts";

// Libraries whose collection type explicitly targets movies or TV shows, plus
// "folders" and untyped (null/undefined) views which cover VFS-backed libraries
// that Jellyfin exposes without a specific CollectionType but may still contain
// shows and movies analysed by the plugin.
const SUPPORTED_COLLECTION_TYPES = new Set<string>(["movies", "tvshows", "folders"]);

function hasId<T extends { Id?: string }>(item: T): item is T & { Id: string } {
    return typeof item.Id === "string" && item.Id.length > 0;
}

function isSupportedCollectionType(
    collectionType: string | null | undefined,
): collectionType is SupportedCollectionType {
    return collectionType == null || SUPPORTED_COLLECTION_TYPES.has(collectionType);
}

export async function getLibraries(): Promise<LibraryInfo[]> {
    const result = await getJson<JellyfinItemsResponse<JellyfinLibraryItem>>("UserViews");
    if (!result.ok) {
        console.error("Failed to load libraries", result.error);
        return [];
    }
    const items = result.data?.Items ?? [];
    return items
        .filter((item): item is JellyfinLibraryItem & { Id: string } =>
            hasId(item) && isSupportedCollectionType(item.CollectionType),
        )
        .map((item) => ({
            Id: item.Id,
            Name: item.Name ?? "Unknown",
            CollectionType: (item.CollectionType ?? null) as SupportedCollectionType,
        }));
}

export async function getShowsInLibrary(
    libraryId: string,
    libraryName: string,
): Promise<ShowItem[]> {
    const params = new URLSearchParams({
        parentId: libraryId,
        includeItemTypes: "Series,Movie",
        sortBy: "SortName",
        sortOrder: "Ascending",
        recursive: "true",
    });
    const result = await getJson<JellyfinItemsResponse<JellyfinMediaItem>>(
        `Items?${params.toString()}`,
    );
    if (!result.ok) {
        console.error("Failed to load shows for library", libraryId, result.error);
        return [];
    }
    return (result.data?.Items ?? [])
        .filter(hasId)
        .map((item) => ({
            Id: item.Id,
            Name: item.Name ?? "Unknown",
            ProductionYear: item.ProductionYear ?? null,
            Type: item.Type === "Movie" ? "Movie" : "Series",
            LibraryId: libraryId,
            LibraryName: libraryName,
        }));
}

export async function getProviderIds(itemId: string): Promise<Record<string, string>> {
    const params = new URLSearchParams({
        ids: itemId,
        fields: "ProviderIds",
    });
    const result = await getJson<JellyfinItemsResponse<JellyfinMediaItem>>(
        `Items?${params.toString()}`,
    );

    if (!result.ok) {
        console.error("Failed to load provider ids for item", itemId, result.error);
        return {};
    }

    return result.data?.Items?.[0]?.ProviderIds ?? {};
}

export async function getSeasons(seriesId: string): Promise<SeasonItem[]> {
    const result = await getJson<JellyfinItemsResponse<JellyfinSeasonItem>>(
        `Shows/${encodeURIComponent(seriesId)}/Seasons`,
    );
    if (!result.ok) {
        console.error("Failed to load seasons for series", seriesId, result.error);
        return [];
    }
    return (result.data?.Items ?? [])
        .filter(hasId)
        .map((item) => ({
            Id: item.Id,
            Name: item.Name ?? "Unknown",
            IndexNumber: item.IndexNumber ?? null,
        }));
}

export async function getEpisodes(seriesId: string, seasonId: string): Promise<EpisodeItem[]> {
    const params = new URLSearchParams({
        seasonId,
        enableImages: "true",
    });
    const result = await getJson<JellyfinItemsResponse<JellyfinEpisodeItem>>(
        `Shows/${encodeURIComponent(seriesId)}/Episodes?${params.toString()}`,
    );
    if (!result.ok) {
        console.error("Failed to load episodes for series", seriesId, result.error);
        return [];
    }
    return (result.data?.Items ?? [])
        .filter(hasId)
        .map((item) => ({
            Id: item.Id,
            Name: item.Name ?? "Unknown",
            IndexNumber: item.IndexNumber ?? null,
            RunTimeTicks: item.RunTimeTicks ?? null,
            SeriesName: item.SeriesName ?? null,
        }));
}

export function getImageUrl(itemId: string, height = 60): string {
    return (
        window.ApiClient.serverAddress() +
        "/Items/" +
        itemId +
        "/Images/Primary?fillHeight=" +
        height +
        "&quality=90"
    );
}
