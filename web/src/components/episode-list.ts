import { el } from "./dom.ts";
import { formatTime } from "../utils.ts";
import * as api from "../store/api.ts";
import { getImageUrl } from "../store/jellyfin-client.ts";
import { timestampBulkAddDialog } from "./timestamp-bulk-add-dialog.ts";
import { timestampBulkEditDialog } from "./timestamp-bulk-edit-dialog.ts";
import { timestampEditDialog } from "./timestamp-edit-dialog.ts";
import { chapterPickerDialog } from "./chapter-picker-dialog.ts";
import type { EpisodeItem, TimestampMap, ApiResult, EpisodeChapter } from "../types.ts";

/** Delay before filtering the episode list (ms). */
const FILTER_DEBOUNCE_MS = 120;

const TIMESTAMP_MODES: ReadonlyArray<{ key: string; label: string }> = [
    { key: "Introduction", label: "Intro" },
    { key: "Credits", label: "Credits" },
    { key: "Recap", label: "Recap" },
    { key: "Preview", label: "Preview" },
    { key: "Commercial", label: "Commercial" },
];

type BulkDurationRequest = {
    modeKey: string;
    duration: number;
    target?: "end" | "start";
};

export function episodeList(): {
    container: HTMLElement;
    render: (
        episodes: EpisodeItem[],
        timestamps: Array<ApiResult<TimestampMap> | null>,
        isMovie?: boolean,
        savedSegments?: boolean[],
    ) => void;
    clear: () => void;
    setStatus: (msg: string, color?: string) => void;
    destroy: () => void;
} {
    const container = el("div");

    const filterBar = el("div", { className: "ts-filter-bar" });
    const filterInput = el("input", {
        className: "ts-filter-input",
        type: "text",
        placeholder: "Filter episodes\u2026",
        name: "episode-filter",
    });
    filterInput.setAttribute("aria-label", "Filter episodes by name");
    filterInput.setAttribute("autocomplete", "off");
    const countEl = el("span", { className: "ts-episode-count" });
    countEl.setAttribute("aria-live", "polite");
    const filterActions = el("div", { className: "ts-filter-actions" });
    const selectAllButton = el(
        "button",
        { className: "ts-select-toggle-btn", type: "button" },
        "Select all",
    ) as HTMLButtonElement;
    selectAllButton.setAttribute("aria-label", "Select all loaded episodes for bulk updates");
    const invertSelectionButton = el(
        "button",
        { className: "ts-select-toggle-btn", type: "button" },
        "Invert",
    ) as HTMLButtonElement;
    invertSelectionButton.setAttribute("aria-label", "Invert episode selection for bulk updates");
    const bulkDurationButton = el(
        "button",
        { className: "ts-bulk-edit-btn", type: "button" },
        "Bulk Duration",
    ) as HTMLButtonElement;
    bulkDurationButton.setAttribute("aria-label", "Adjust the duration for selected timestamps");
    const bulkAddButton = el(
        "button",
        { className: "ts-bulk-edit-btn", type: "button" },
        "Bulk Add",
    ) as HTMLButtonElement;
    bulkAddButton.setAttribute("aria-label", "Set timestamps for selected episodes");
    filterActions.append(countEl, selectAllButton, invertSelectionButton, bulkDurationButton, bulkAddButton);
    filterBar.append(filterInput, filterActions);

    const statusEl = el("div", { className: "ts-status-msg" });
    statusEl.style.display = "none";
    statusEl.setAttribute("aria-live", "polite");

    const listEl = el("div");

    container.append(filterBar, statusEl, listEl);

    let currentEpisodes: EpisodeItem[] = [];
    let currentTimestamps: Array<ApiResult<TimestampMap> | null> = [];
    let currentHasSegments: boolean[] = [];
    let externalTimestampsRef: Array<ApiResult<TimestampMap> | null> | null = null;
    let currentCards: HTMLElement[] = [];
    let filterTimer: ReturnType<typeof setTimeout> | null = null;
    let isBatchSaving = false;
    let selectedEpisodeIds = new Set<string>();

    function ticksToMinutes(ticks: number | null): string {
        if (!ticks) return "";
        const minutes = Math.round(ticks / 10_000_000 / 60);
        return minutes + "\u00A0min";
    }

    function getSelectedEpisodeIds(): string[] {
        return currentEpisodes.filter((episode) => selectedEpisodeIds.has(episode.Id)).map((episode) => episode.Id);
    }

    function cloneTimestampResult(result: ApiResult<TimestampMap> | null): ApiResult<TimestampMap> | null {
        if (!result) {
            return null;
        }

        if (!result.ok) {
            return { ...result };
        }

        return {
            ...result,
            data: { ...(result.data ?? {}) },
        };
    }

    function syncHasSegmentState(index: number, result: ApiResult<TimestampMap> | null): void {
        currentHasSegments[index] = !!result?.ok && Object.values(result.data ?? {}).some((segment) => {
            return segment.Start !== 0 || segment.End !== 0;
        });
    }

    function syncBulkButtonState(): void {
        const selectedCount = getSelectedEpisodeIds().length;
        bulkDurationButton.disabled = isBatchSaving || currentEpisodes.length === 0 || selectedCount === 0;
        bulkAddButton.disabled = isBatchSaving || currentEpisodes.length === 0 || selectedCount === 0;
        selectAllButton.disabled =
            isBatchSaving || currentEpisodes.length === 0 || selectedCount === currentEpisodes.length;
        invertSelectionButton.disabled = isBatchSaving || currentEpisodes.length === 0;
    }

    function setStatusMessage(msg: string, color = "var(--is-text-muted)"): void {
        if (!msg) {
            statusEl.style.display = "none";
            statusEl.textContent = "";
            return;
        }

        statusEl.textContent = msg;
        statusEl.style.color = color;
        statusEl.style.display = "block";
    }

    function rebuildList(preserveFilter = false): void {
        listEl.replaceChildren();
        currentCards = [];

        if (currentEpisodes.length === 0) {
            listEl.append(el("div", { className: "ts-status-msg" }, "No episodes found."));
            countEl.textContent = "";
            syncBulkButtonState();
            return;
        }

        for (let i = 0; i < currentEpisodes.length; i++) {
            const card = buildCard(currentEpisodes[i], currentTimestamps[i] ?? null, currentHasSegments[i] ?? false, i);
            currentCards.push(card);
            listEl.append(card);
        }

        if (!preserveFilter) {
            filterInput.value = "";
        }

        applyFilter();
        syncBulkButtonState();
    }

    let isMovieView = false;

    function buildCard(
        ep: EpisodeItem,
        result: ApiResult<TimestampMap> | null,
        hasSavedSegments: boolean,
        index: number,
    ): HTMLElement {
        const card = el("div", { className: "ts-episode-card" });
        const selectCol = el("div", { className: "ts-episode-select" });
        const selectInput = el("input", {
            className: "ts-episode-select-input",
            type: "checkbox",
        }) as HTMLInputElement;
        selectInput.checked = selectedEpisodeIds.has(ep.Id);
        selectInput.disabled = isBatchSaving;
        selectInput.setAttribute("aria-label", "Select " + ep.Name + " for bulk updates");
        selectCol.append(selectInput);
        card.append(selectCol);
        card.classList.toggle("unselected", !selectInput.checked);

        selectInput.addEventListener("change", () => {
            if (selectInput.checked) {
                selectedEpisodeIds.add(ep.Id);
            } else {
                selectedEpisodeIds.delete(ep.Id);
            }

            card.classList.toggle("unselected", !selectInput.checked);
            applyFilter();
            syncBulkButtonState();
        });

        const img = el("img", {
            className: "ts-episode-thumb",
            src: getImageUrl(ep.Id),
            alt: "",
            width: "64",
            height: "38",
        });
        img.loading = "lazy";
        img.onerror = () => {
            img.style.display = "none";
        };
        card.append(img);

        const info = el("div", { className: "ts-episode-info" });

        const header = el("div", { className: "ts-episode-header" });
        const prefix = isMovieView
            ? ""
            : (ep.IndexNumber ?? index + 1).toLocaleString(undefined, { minimumIntegerDigits: 2 }) +
              ": ";
        header.append(el("span", { className: "ts-episode-name" }, prefix + ep.Name));
        if (hasSavedSegments) {
            const savedBadge = el(
                "span",
                {
                    className: "ts-episode-segment-badge",
                    title: "Jellyfin local segments saved",
                },
                "✓",
            );
            savedBadge.setAttribute("aria-label", "Jellyfin local segments saved for " + ep.Name);
            header.append(savedBadge);
        }
        const runtime = ticksToMinutes(ep.RunTimeTicks);
        if (runtime) {
            header.append(el("span", { className: "ts-episode-runtime" }, runtime));
        }
        info.append(header);

        const errorDiv = el("div", { className: "ts-episode-error" });
        errorDiv.append(document.createTextNode("Failed to load timestamps"));

        const retryBtn = el("button", { className: "ts-retry-link", type: "button" }, "Retry");
        retryBtn.setAttribute("aria-label", "Retry loading timestamps for " + ep.Name);

        const timestampsContainer = el("div", { className: "ts-episode-timestamps" });
        let timestampMap: TimestampMap | null = result?.ok === true ? { ...(result.data ?? {}) } : null;

        function commitTimestampResult(nextResult: ApiResult<TimestampMap> | null): void {
            const cloned = cloneTimestampResult(nextResult);
            currentTimestamps[index] = cloned;
            timestampMap = nextResult?.ok === true ? { ...(nextResult.data ?? {}) } : null;
            syncHasSegmentState(index, cloned);
            if (externalTimestampsRef) {
                externalTimestampsRef[index] = cloned;
            }
        }

        function renderTimestampRows(): void {
            if (!timestampMap) {
                card.classList.add("error");
                errorDiv.style.display = "block";
                timestampsContainer.style.display = "none";
                timestampsContainer.replaceChildren();
                return;
            }

            card.classList.remove("error");
            errorDiv.style.display = "none";
            timestampsContainer.style.display = "";
            timestampsContainer.replaceChildren(
                buildTimestampPills(
                    timestampMap,
                    (mode, seg) => {
                        void timestampEditDialog({
                            title: "Edit " + mode.label + " Timestamp",
                            initialStart: seg.Start,
                            initialEnd: seg.End,
                            onSave: async ({ start, end }) => {
                                const response = await api.updateEpisodeTimestamp(ep.Id, {
                                    mode: mode.key,
                                    currentStart: seg.Start,
                                    currentEnd: seg.End,
                                    start,
                                    end,
                                });

                                if (!response.ok) {
                                    return false;
                                }

                                const nextMap = {
                                    ...(timestampMap ?? {}),
                                    [mode.key]: { Start: start, End: end },
                                };
                                commitTimestampResult({ ok: true, status: response.status, data: nextMap });
                                rebuildList(true);
                                return true;
                            },
                            onDelete: async () => {
                                const response = await api.deleteEpisodeTimestamp(ep.Id, {
                                    mode: mode.key,
                                    currentStart: seg.Start,
                                    currentEnd: seg.End,
                                });

                                if (!response.ok) {
                                    return false;
                                }

                                const nextMap = { ...(timestampMap ?? {}) };
                                delete nextMap[mode.key];
                                commitTimestampResult({ ok: true, status: response.status, data: nextMap });
                                rebuildList(true);
                                return true;
                            },
                        });
                    },
                    (mode, range) => {
                        const currentSeg = timestampMap?.[mode.key];
                        const currentStart = currentSeg ? currentSeg.Start : 0;
                        const currentEnd = currentSeg ? currentSeg.End : 0;
                        void api.updateEpisodeTimestamp(ep.Id, {
                            mode: mode.key,
                            currentStart,
                            currentEnd,
                            start: range.start,
                            end: range.end,
                        }).then((response) => {
                            if (response.ok) {
                                const nextMap = {
                                    ...(timestampMap ?? {}),
                                    [mode.key]: { Start: range.start, End: range.end },
                                };
                                commitTimestampResult({ ok: true, status: response.status, data: nextMap });
                                rebuildList(true);
                            }
                        });
                    },
                    ep.RunTimeTicks ? ep.RunTimeTicks / 10_000_000 : undefined,
                    ep.Chapters,
                ),
            );
        }

        retryBtn.addEventListener("click", async () => {
            if (retryBtn.disabled) {
                return;
            }

            retryBtn.disabled = true;
            retryBtn.textContent = "Loading\u2026";
            const retryResult = await api.getEpisodeTimestamps(ep.Id);
            if (retryResult?.ok === true) {
                commitTimestampResult(retryResult);
                rebuildList(true);
            } else {
                retryBtn.textContent = "Retry";
                retryBtn.disabled = false;
            }
        });

        errorDiv.append(retryBtn);
        info.append(errorDiv, timestampsContainer);

        renderTimestampRows();

        card.append(info);
        return card;
    }

    function buildTimestampPills(
        ts: TimestampMap,
        onEdit?: (mode: { key: string; label: string }, seg: { Start: number; End: number }) => void,
        onChapterSelect?: (mode: { key: string; label: string }, range: { start: number; end: number }) => void,
        episodeDurationSeconds?: number,
        chapters?: EpisodeChapter[],
    ): HTMLElement {
        const row = el("div", { className: "ts-episode-timestamps" });
        for (const mode of TIMESTAMP_MODES) {
            const seg = ts[mode.key];
            const entry = el("div", { className: "ts-timestamp-entry" });
            if (seg && (seg.Start !== 0 || seg.End !== 0)) {
                entry.append(
                    el(
                        "span",
                        { className: "ts-timestamp-pill" },
                        mode.label +
                            " " +
                            formatTime(seg.Start) +
                            " \u2013 " +
                            formatTime(seg.End) +
                            " \u00b7 " +
                            formatTime(Math.max(0, seg.End - seg.Start)),
                    ),
                );

                if (onEdit) {
                    const editBtn = el("button", { className: "ts-timestamp-edit", type: "button" }, "Edit");
                    editBtn.setAttribute("aria-label", "Edit " + mode.label + " timestamp");
                    editBtn.addEventListener("click", () => {
                        onEdit(mode, seg);
                    });
                    entry.append(editBtn);
                }
            } else {
                entry.append(el("span", { className: "ts-timestamp-missing" }, mode.label + " \u2013"));
            }

            if (onChapterSelect && episodeDurationSeconds !== undefined && chapters && chapters.length > 0) {
                const chBtn = el("button", { className: "ts-timestamp-chapter-btn", type: "button" }, "Ch.");
                chBtn.setAttribute("aria-label", "Set " + mode.label + " from chapter");
                chBtn.addEventListener("click", () => {
                    chapterPickerDialog({
                        title: "Set " + mode.label + " from Chapter",
                        chapters,
                        episodeDurationSeconds,
                        onSelect: (range) => {
                            onChapterSelect(mode, range);
                        },
                    });
                });
                entry.append(chBtn);
            }

            row.append(entry);
        }
        return row;
    }

    async function applyBulkDuration(
        modeKey: string,
        duration: number,
        target: "end" | "start" = "end",
        selectedEpisodeIds?: string[],
    ): Promise<boolean> {
        const modeLabel = TIMESTAMP_MODES.find((mode) => mode.key === modeKey)?.label ?? modeKey;
        const selectedIdSet = new Set(selectedEpisodeIds ?? getSelectedEpisodeIds());
        const selectedCount = selectedIdSet.size;

        if (selectedCount === 0) {
            setStatusMessage("No episodes selected for bulk update.", "var(--is-warning)");
            return false;
        }

        const eligible = currentEpisodes
            .map((episode, index) => {
                if (!selectedIdSet.has(episode.Id)) {
                    return null;
                }

                const result = currentTimestamps[index];
                const segment = result?.ok === true ? result.data?.[modeKey] : undefined;
                if (!result?.ok || !segment || (segment.Start === 0 && segment.End === 0)) {
                    return null;
                }

                return { episode, index, segment };
            })
            .filter(
                (
                    entry,
                ): entry is {
                    episode: EpisodeItem;
                    index: number;
                    segment: { Start: number; End: number };
                } => entry !== null,
            );

        if (eligible.length === 0) {
            setStatusMessage(
                "No " + modeLabel + " timestamps were found in the selected episodes.",
                "var(--is-warning)",
            );
            return false;
        }
        // When applying to start, negative start times will be clamped to 0.

        isBatchSaving = true;
        syncBulkButtonState();

        let updated = 0;
        let failed = 0;
        let firstError: string | null = null;

        try {
            for (let i = 0; i < eligible.length; i++) {
                const entry = eligible[i];
                setStatusMessage(
                    "Saving " + String(i + 1) + "/" + String(eligible.length) + " " + entry.episode.Name + "…",
                    "var(--is-text-muted)",
                );

                let response: Response;
                if (target === "end") {
                    const end = entry.segment.Start + duration;
                    response = await api.updateEpisodeTimestamp(entry.episode.Id, {
                        mode: modeKey,
                        currentStart: entry.segment.Start,
                        currentEnd: entry.segment.End,
                        start: entry.segment.Start,
                        end,
                    });

                    if (response.ok) {
                        updated += 1;
                        const currentResult = currentTimestamps[entry.index];
                        const nextMap = {
                            ...(currentResult?.ok === true ? currentResult.data ?? {} : {}),
                            [modeKey]: { Start: entry.segment.Start, End: end },
                        };
                        const updatedResult = { ok: true, status: response.status, data: nextMap };
                        currentTimestamps[entry.index] = updatedResult;
                        syncHasSegmentState(entry.index, updatedResult);
                        if (externalTimestampsRef) {
                            externalTimestampsRef[entry.index] = updatedResult;
                        }
                    } else {
                        failed += 1;
                        if (!firstError) {
                            firstError = entry.episode.Name + " (HTTP " + response.status + ")";
                        }
                    }
                } else {
                    const start = Math.max(0, entry.segment.End - duration);
                    response = await api.updateEpisodeTimestamp(entry.episode.Id, {
                        mode: modeKey,
                        currentStart: entry.segment.Start,
                        currentEnd: entry.segment.End,
                        start,
                        end: entry.segment.End,
                    });

                    if (response.ok) {
                        updated += 1;
                        const currentResult = currentTimestamps[entry.index];
                        const nextMap = {
                            ...(currentResult?.ok === true ? currentResult.data ?? {} : {}),
                            [modeKey]: { Start: start, End: entry.segment.End },
                        };
                        const updatedResult = { ok: true, status: response.status, data: nextMap };
                        currentTimestamps[entry.index] = updatedResult;
                        syncHasSegmentState(entry.index, updatedResult);
                        if (externalTimestampsRef) {
                            externalTimestampsRef[entry.index] = updatedResult;
                        }
                    } else {
                        failed += 1;
                        if (!firstError) {
                            firstError = entry.episode.Name + " (HTTP " + response.status + ")";
                        }
                    }
                }
            }
        } finally {
            isBatchSaving = false;
            syncBulkButtonState();
        }

        rebuildList(true);

        const skipped = selectedCount - eligible.length;
        const unselected = currentEpisodes.length - selectedCount;
        const summary =
            "Updated " +
            String(updated) +
            " " +
            modeLabel +
            " timestamps, skipped " +
            String(skipped) +
            (unselected > 0 ? ", left " + String(unselected) + " unselected" : "") +
            (failed > 0 ? ", failed " + String(failed) : "") +
            ".";

        setStatusMessage(
            failed > 0 && firstError ? summary + " First error: " + firstError : summary,
            failed > 0 ? "var(--is-warning)" : "var(--is-success)",
        );

        return true;
    }

    async function applyBulkAdd(
        modeKey: string,
        start: number,
        end: number,
        selectedEpisodeIds?: string[],
    ): Promise<boolean> {
        const modeLabel = TIMESTAMP_MODES.find((mode) => mode.key === modeKey)?.label ?? modeKey;
        const selectedIdSet = new Set(selectedEpisodeIds ?? getSelectedEpisodeIds());
        const selectedCount = selectedIdSet.size;

        if (selectedCount === 0) {
            setStatusMessage("No episodes selected for bulk update.", "var(--is-warning)");
            return false;
        }

        isBatchSaving = true;
        syncBulkButtonState();

        let updated = 0;
        let failed = 0;
        let firstError: string | null = null;

        try {
            for (let i = 0; i < currentEpisodes.length; i++) {
                const episode = currentEpisodes[i];
                if (!selectedIdSet.has(episode.Id)) {
                    continue;
                }

                setStatusMessage(
                    "Saving " + String(updated + failed + 1) + "/" + String(selectedCount) + " " + episode.Name + "\u2026",
                    "var(--is-text-muted)",
                );

                const currentResult = currentTimestamps[i];
                const existingSegment = currentResult?.ok === true ? currentResult.data?.[modeKey] : undefined;
                const currentStart = existingSegment ? existingSegment.Start : 0;
                const currentEnd = existingSegment ? existingSegment.End : 0;

                const response = await api.updateEpisodeTimestamp(episode.Id, {
                    mode: modeKey,
                    currentStart,
                    currentEnd,
                    start,
                    end,
                });

                if (response.ok) {
                    updated += 1;
                    const nextMap = {
                        ...(currentResult?.ok === true ? currentResult.data ?? {} : {}),
                        [modeKey]: { Start: start, End: end },
                    };
                    const updatedResult = { ok: true, status: response.status, data: nextMap };
                    currentTimestamps[i] = updatedResult;
                    syncHasSegmentState(i, updatedResult);
                    if (externalTimestampsRef) {
                        externalTimestampsRef[i] = updatedResult;
                    }
                } else {
                    failed += 1;
                    if (!firstError) {
                        firstError = episode.Name + " (HTTP " + response.status + ")";
                    }
                }
            }
        } finally {
            isBatchSaving = false;
            syncBulkButtonState();
        }

        rebuildList(true);

        const unselected = currentEpisodes.length - selectedCount;
        const summary =
            "Updated " +
            String(updated) +
            " " +
            modeLabel +
            " timestamps" +
            (failed > 0 ? ", failed " + String(failed) : "") +
            (unselected > 0 ? ", left " + String(unselected) + " unselected" : "") +
            ".";

        setStatusMessage(
            failed > 0 && firstError ? summary + " First error: " + firstError : summary,
            failed > 0 ? "var(--is-warning)" : "var(--is-success)",
        );

        return true;
    }

    async function handleBulkDurationClick(): Promise<void> {
        if (isBatchSaving || currentEpisodes.length === 0) {
            return;
        }

        let pendingRequest: BulkDurationRequest | null = null;
        await timestampBulkEditDialog({
            title: "Bulk Update Timestamp Duration",
            modes: TIMESTAMP_MODES,
            defaultModeKey: TIMESTAMP_MODES[0]?.key,
            onSave: async (values) => {
                pendingRequest = values;
                return true;
            },
        });

        const bulkRequest = pendingRequest as BulkDurationRequest | null;
        if (!bulkRequest) {
            return;
        }

        await applyBulkDuration(
            bulkRequest.modeKey,
            bulkRequest.duration,
            bulkRequest.target ?? "end",
            getSelectedEpisodeIds(),
        );
    }

    function applyFilter(): void {
        const query = filterInput.value.toLowerCase();
        let visibleCount = 0;
        currentCards.forEach((card, i) => {
            const name = currentEpisodes[i]?.Name?.toLowerCase() ?? "";
            const visible = !query || name.includes(query);
            card.style.display = visible ? "" : "none";
            if (visible) visibleCount++;
        });

        const totalCount = currentEpisodes.length;
        const selectedCount = getSelectedEpisodeIds().length;
        if (query && visibleCount === 0) {
            countEl.textContent = "No matching episodes · " + String(selectedCount) + " selected";
            return;
        }

        const countText = query
            ? String(visibleCount) + " of " + String(totalCount) + " episodes"
            : String(visibleCount) + " episode" + (visibleCount !== 1 ? "s" : "");
        countEl.textContent = countText + " · " + String(selectedCount) + " selected";
    }

    const handleFilterInput = () => {
        if (filterTimer) clearTimeout(filterTimer);
        filterTimer = setTimeout(() => {
            applyFilter();
        }, FILTER_DEBOUNCE_MS);
    };

    filterInput.addEventListener("input", handleFilterInput);
    const handleSelectAllButtonClick = () => {
        selectedEpisodeIds = new Set(currentEpisodes.map((episode) => episode.Id));
        rebuildList(true);
    };
    selectAllButton.addEventListener("click", handleSelectAllButtonClick);
    const handleInvertSelectionButtonClick = () => {
        selectedEpisodeIds = new Set(
            currentEpisodes.filter((episode) => !selectedEpisodeIds.has(episode.Id)).map((episode) => episode.Id),
        );
        rebuildList(true);
    };
    invertSelectionButton.addEventListener("click", handleInvertSelectionButtonClick);
    const handleBulkDurationButtonClick = () => {
        void handleBulkDurationClick().catch(console.error);
    };
    bulkDurationButton.addEventListener("click", handleBulkDurationButtonClick);

    async function handleBulkAddClick(): Promise<void> {
        if (isBatchSaving || currentEpisodes.length === 0) {
            return;
        }

        let pendingRequest: { modeKey: string; start: number; end: number } | null = null;
        await timestampBulkAddDialog({
            title: "Bulk Add Timestamp",
            modes: TIMESTAMP_MODES,
            defaultModeKey: TIMESTAMP_MODES[0]?.key,
            onSave: async (values) => {
                pendingRequest = values;
                return true;
            },
        });

        const bulkRequest = pendingRequest as { modeKey: string; start: number; end: number } | null;
        if (!bulkRequest) {
            return;
        }

        await applyBulkAdd(bulkRequest.modeKey, bulkRequest.start, bulkRequest.end, getSelectedEpisodeIds());
    }

    const handleBulkAddButtonClick = () => {
        void handleBulkAddClick().catch(console.error);
    };
    bulkAddButton.addEventListener("click", handleBulkAddButtonClick);

    return {
        container,

        render(
            episodes: EpisodeItem[],
            timestamps: Array<ApiResult<TimestampMap> | null>,
            isMovie = false,
            savedSegments: boolean[] = [],
        ) {
            isMovieView = isMovie;
            currentEpisodes = episodes;
            // Keep a reference to the original timestamps array so updates
            // performed by this component (e.g. bulk edits) are reflected
            // for callers that hold the same array (like the action bar).
            externalTimestampsRef = timestamps;
            currentTimestamps = timestamps.map((result) => cloneTimestampResult(result));
            currentHasSegments = episodes.map((_, index) => Boolean(savedSegments[index]));
            selectedEpisodeIds = new Set(episodes.map((episode) => episode.Id));
            if (filterTimer) clearTimeout(filterTimer);
            filterInput.value = "";
            listEl.replaceChildren();
            currentCards = [];

            if (episodes.length === 0) {
                countEl.textContent = "";
                setStatusMessage("");
                syncBulkButtonState();
                listEl.append(el("div", { className: "ts-status-msg" }, "No episodes found."));
                return;
            }

            rebuildList(false);
            setStatusMessage("");
        },

        clear() {
            listEl.replaceChildren();
            currentCards = [];
            currentEpisodes = [];
            currentTimestamps = [];
            currentHasSegments = [];
            externalTimestampsRef = null;
            selectedEpisodeIds = new Set();
            if (filterTimer) clearTimeout(filterTimer);
            countEl.textContent = "";
            filterInput.value = "";
            setStatusMessage("");
            syncBulkButtonState();
        },

        setStatus(msg: string, color = "var(--is-text-muted)") {
            setStatusMessage(msg, color);
        },

        destroy() {
            if (filterTimer) {
                clearTimeout(filterTimer);
                filterTimer = null;
            }
            filterInput.removeEventListener("input", handleFilterInput);
            selectAllButton.removeEventListener("click", handleSelectAllButtonClick);
            invertSelectionButton.removeEventListener("click", handleInvertSelectionButtonClick);
            bulkDurationButton.removeEventListener("click", handleBulkDurationButtonClick);
            bulkAddButton.removeEventListener("click", handleBulkAddButtonClick);
        },
    };
}
