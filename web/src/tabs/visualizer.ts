import type {
    ChromaprintVisualizationComparison,
    EpisodeItem,
    SeasonItem,
    ShowItem,
    Tab,
    VisualizerMode,
} from "../types.ts";
import * as api from "../store/api.ts";
import * as jellyfinClient from "../store/jellyfin-client.ts";
import { createStatusMessage, withDashboardLoading } from "../components/async-feedback.ts";
import { el, htmlEl } from "../components/dom.ts";
import { appendTabContent } from "../components/tab-layout.ts";
import { formatTime } from "../utils.ts";

type MatchRange = {
    pointStart: number;
    pointEnd: number;
    similarity: number;
    duration: number;
    lhsStart: number;
    lhsEnd: number;
    rhsStart: number;
    rhsEnd: number;
};

type DiffData = {
    diff: number[];
    similarity: number[];
    leftOffset: number;
    rightOffset: number;
};

let activeVisualizer: { destroy: () => void } | null = null;

export const visualizerTab: Tab = {
    id: "visualizer",
    label: "Visualizer",

    render(container) {
        activeVisualizer?.destroy();
        activeVisualizer = createChromaprintVisualizer(container);
    },

    destroy() {
        activeVisualizer?.destroy();
        activeVisualizer = null;
    },
};

function createChromaprintVisualizer(container: HTMLElement): { destroy: () => void } {
    let destroyed = false;
    let selectionVersion = 0;
    let comparisonVersion = 0;
    let currentComparison: ChromaprintVisualizationComparison | null = null;
    let currentOffset = 0;

    const status = createStatusMessage({ display: "block" });

    const intro = htmlEl(
        "div",
        { className: "field-description viz-description" },
        "<p>Compare two episodes' Chromaprint fingerprints side by side. The canvas shows the left fingerprint, the right fingerprint, their XOR diff, and a similarity strip based on the current offset.</p>" +
            "<p>Use this to inspect where two episodes align and which contiguous regions satisfy the plugin's current Chromaprint matching threshold.</p>" +
            "<p>Suggested offsets show the alignment delta between the two fingerprint windows. The possible intro match below uses TimeAdjustmentHelper on top of ChromaprintAnalyzer.CompareEpisodes, so chapter, silence, and keyframe adjustments are included.</p>",
    );

    const libraryField = createSelectControl("viz-library", "Library");
    const showField = createSelectControl("viz-show", "Series");
    const seasonField = createSelectControl("viz-season", "Season");
    const modeField = createSelectControl("viz-mode", "Mode");
    modeField.select.append(
        el("option", { value: "Introduction" }, "Introduction"),
        el("option", { value: "Credits" }, "Credits"),
    );

    const episodeLeftField = createSelectControl("viz-episode-left", "Episode A");
    const episodeRightField = createSelectControl("viz-episode-right", "Episode B");

    const loadButton = el(
        "button",
        { className: "action-button", type: "button" },
        "Load Comparison",
    ) as HTMLButtonElement;

    const selectorGrid = el("div", { className: "viz-grid" });
    selectorGrid.append(
        libraryField.container,
        showField.container,
        seasonField.container,
        modeField.container,
        episodeLeftField.container,
        episodeRightField.container,
    );

    const controlsBar = el("div", { className: "viz-actions" });
    controlsBar.append(loadButton);

    const offsetRange = el("input", {
        id: "viz-offset-range",
        type: "range",
        min: "0",
        max: "0",
        value: "0",
    }) as HTMLInputElement;
    const offsetNumber = el("input", {
        id: "viz-offset-number",
        type: "number",
        step: "1",
        min: "0",
        max: "0",
        value: "0",
    }) as HTMLInputElement;

    const offsetInfo = el("div", { className: "field-description" });
    const offsetSection = el("section", { className: "viz-panel" });
    const offsetHeading = el("h3", { className: "checkbox-list-label" }, "Alignment Offset");
    const offsetControls = el("div", { className: "viz-offset-controls" });
    const rangeWrap = el("label", { className: "viz-offset-range-wrap", for: offsetRange.id }, "Offset (points)");
    rangeWrap.append(offsetRange);
    const numberWrap = el("label", { className: "input-label viz-offset-number-wrap", for: offsetNumber.id }, "Offset (points)");
    numberWrap.append(offsetNumber);
    offsetControls.append(rangeWrap, numberWrap);
    offsetSection.append(offsetHeading, offsetControls, offsetInfo);

    const suggestionsSection = el("section", { className: "viz-panel" });
    const suggestionsHeading = el("h3", { className: "checkbox-list-label" }, "Suggested Alignment Offsets");
    const suggestionsBody = el("div", { className: "viz-suggestions" });
    const suggestionsHelp = el(
        "div",
        { className: "field-description" },
        "This is the start-position delta needed to align episode B against episode A. It is not the duration of the matched OP.",
    );
    suggestionsSection.append(suggestionsHeading, suggestionsHelp, suggestionsBody);

    const metricsSection = el("section", { className: "viz-panel" });
    const metricsHeading = el("h3", { className: "checkbox-list-label" }, "Comparison Summary");
    const metricsGrid = el("div", { className: "viz-metrics" });
    metricsSection.append(metricsHeading, metricsGrid);

    const likelyIntroSection = el("section", { className: "viz-panel" });
    const likelyIntroHeading = el("h3", { className: "checkbox-list-label" }, "Possible Intro Match");
    const likelyIntroHelp = el(
        "div",
        { className: "field-description" },
        "This uses the plugin's TimeAdjustmentHelper-adjusted result, based on ChromaprintAnalyzer.CompareEpisodes.",
    );
    const likelyIntroBody = el("div", { className: "viz-match-list" });
    likelyIntroSection.append(likelyIntroHeading, likelyIntroHelp, likelyIntroBody);

    const canvas = el("canvas", { className: "viz-canvas" }) as HTMLCanvasElement;
    const canvasScroll = el("div", { className: "viz-canvas-scroll" });
    canvasScroll.append(canvas);

    const legend = el("div", { className: "viz-legend" });
    legend.append(
        createLegendItem("viz-legend-left", "Episode A"),
        createLegendItem("viz-legend-right", "Episode B"),
        createLegendItem("viz-legend-diff", "XOR Diff"),
        createLegendItem("viz-legend-match", "Detected Match Block"),
        createLegendItem("viz-legend-perfect", "100% Similarity"),
        createLegendItem("viz-legend-threshold", "Above Threshold"),
        createLegendItem("viz-legend-below", "Below Threshold"),
    );

    const canvasSection = el("section", { className: "viz-panel" });
    const canvasHeading = el("h3", { className: "checkbox-list-label" }, "Fingerprint Diff");
    canvasSection.append(canvasHeading, legend, canvasScroll);

    const matchesSection = el("section", { className: "viz-panel" });
    const matchesHeading = el("h3", { className: "checkbox-list-label" }, "Raw Matched Regions");
    const matchesList = el("div", { className: "viz-match-list" });
    const matchesHelp = el(
        "div",
        { className: "field-description" },
        "These ranges come directly from raw Chromaprint similarity at the current offset. They can be wider than the final intro because later analysis may snap boundaries to chapters, silence, or keyframes.",
    );
    matchesSection.append(matchesHeading, matchesHelp, matchesList);

    const results = el("div", { className: "viz-results" });
    results.append(offsetSection, suggestionsSection, metricsSection, likelyIntroSection, canvasSection, matchesSection);
    results.style.display = "none";

    appendTabContent(container, intro, selectorGrid, controlsBar, status.element, results);

    setSelectState(showField.select, true, "Load a library first");
    setSelectState(seasonField.select, true, "Load a series first");
    setSelectState(episodeLeftField.select, true, "Load a season first");
    setSelectState(episodeRightField.select, true, "Load a season first");

    const handleLibraryChange = () => {
        void loadShows().catch(console.error);
    };

    const handleShowChange = () => {
        void loadSeasons().catch(console.error);
    };

    const handleSeasonChange = () => {
        void loadEpisodes().catch(console.error);
    };

    const handleCompareClick = () => {
        void loadComparison().catch(console.error);
    };

    const handleOffsetInput = (value: number) => {
        if (!currentComparison) {
            return;
        }

        currentOffset = clampOffset(currentComparison, value);
        syncOffsetInputs(currentComparison, currentOffset, offsetRange, offsetNumber, offsetInfo);
        renderComparison();
    };

    libraryField.select.addEventListener("change", handleLibraryChange);
    showField.select.addEventListener("change", handleShowChange);
    seasonField.select.addEventListener("change", handleSeasonChange);
    loadButton.addEventListener("click", handleCompareClick);
    offsetRange.addEventListener("input", () => {
        handleOffsetInput(Number.parseInt(offsetRange.value, 10) || 0);
    });
    offsetNumber.addEventListener("input", () => {
        handleOffsetInput(Number.parseInt(offsetNumber.value, 10) || 0);
    });

    void loadLibraries().catch(console.error);

    async function loadLibraries(): Promise<void> {
        const version = ++selectionVersion;
        loadButton.disabled = true;
        status.show("Loading libraries…");

        const libraries = await withDashboardLoading(() => jellyfinClient.getLibraries());
        if (destroyed || version !== selectionVersion) {
            return;
        }

        if (libraries.length === 0) {
            populateSelect(libraryField.select, [], "No libraries available");
            status.show("No supported libraries were found.", "var(--is-warning)");
            return;
        }

        populateSelect(
            libraryField.select,
            libraries.map((library) => ({ value: library.Id, label: library.Name })),
        );

        await loadShows();
    }

    async function loadShows(): Promise<void> {
        const libraryId = libraryField.select.value;
        const libraryName = libraryField.select.selectedOptions[0]?.textContent ?? "";
        const version = ++selectionVersion;

        currentComparison = null;
        results.style.display = "none";
        setSelectState(showField.select, true, "Loading series…");
        setSelectState(seasonField.select, true, "Load a series first");
        setSelectState(episodeLeftField.select, true, "Load a season first");
        setSelectState(episodeRightField.select, true, "Load a season first");
        loadButton.disabled = true;
        status.show("Loading series…");

        const shows = (await withDashboardLoading(() =>
            jellyfinClient.getShowsInLibrary(libraryId, libraryName),
        )).filter((show) => show.Type === "Series");

        if (destroyed || version !== selectionVersion) {
            return;
        }

        if (shows.length === 0) {
            populateSelect(showField.select, [], "No series available");
            status.show("No series were found in the selected library.", "var(--is-warning)");
            return;
        }

        populateSelect(
            showField.select,
            shows.map((show) => ({ value: show.Id, label: formatShowLabel(show) })),
        );
        showField.select.disabled = false;

        await loadSeasons();
    }

    async function loadSeasons(): Promise<void> {
        const showId = showField.select.value;
        const version = ++selectionVersion;

        currentComparison = null;
        results.style.display = "none";
        setSelectState(seasonField.select, true, "Loading seasons…");
        setSelectState(episodeLeftField.select, true, "Load a season first");
        setSelectState(episodeRightField.select, true, "Load a season first");
        loadButton.disabled = true;
        status.show("Loading seasons…");

        const seasons = await withDashboardLoading(() => jellyfinClient.getSeasons(showId));
        if (destroyed || version !== selectionVersion) {
            return;
        }

        if (seasons.length === 0) {
            populateSelect(seasonField.select, [], "No seasons available");
            status.show("The selected series has no seasons.", "var(--is-warning)");
            return;
        }

        populateSelect(
            seasonField.select,
            seasons.map((season) => ({ value: season.Id, label: formatSeasonLabel(season) })),
        );
        seasonField.select.disabled = false;

        await loadEpisodes();
    }

    async function loadEpisodes(): Promise<void> {
        const showId = showField.select.value;
        const seasonId = seasonField.select.value;
        const version = ++selectionVersion;

        currentComparison = null;
        results.style.display = "none";
        setSelectState(episodeLeftField.select, true, "Loading episodes…");
        setSelectState(episodeRightField.select, true, "Loading episodes…");
        loadButton.disabled = true;
        status.show("Loading episodes…");

        const episodes = await withDashboardLoading(() => jellyfinClient.getEpisodes(showId, seasonId));
        if (destroyed || version !== selectionVersion) {
            return;
        }

        if (episodes.length < 2) {
            populateSelect(episodeLeftField.select, [], "Need at least two episodes");
            populateSelect(episodeRightField.select, [], "Need at least two episodes");
            status.show("Select a season with at least two episodes.", "var(--is-warning)");
            return;
        }

        const options = episodes.map((episode) => ({
            value: episode.Id,
            label: formatEpisodeLabel(episode),
        }));

        populateSelect(episodeLeftField.select, options);
        populateSelect(episodeRightField.select, options);
        episodeLeftField.select.disabled = false;
        episodeRightField.select.disabled = false;

        episodeRightField.select.selectedIndex = Math.min(1, episodeRightField.select.options.length - 1);
        loadButton.disabled = false;
        status.show("Ready to compare two episodes.", "var(--is-success)");
    }

    async function loadComparison(): Promise<void> {
        const leftEpisodeId = episodeLeftField.select.value;
        const rightEpisodeId = episodeRightField.select.value;
        const mode = modeField.select.value as VisualizerMode;

        if (!leftEpisodeId || !rightEpisodeId) {
            status.show("Select two episodes first.", "var(--is-warning)");
            return;
        }

        if (leftEpisodeId === rightEpisodeId) {
            status.show("Pick two different episodes.", "var(--is-warning)");
            return;
        }

        const version = ++comparisonVersion;
        loadButton.disabled = true;
        status.show("Computing Chromaprint comparison…");

        const response = await withDashboardLoading(() =>
            api.getChromaprintComparison(leftEpisodeId, rightEpisodeId, mode),
        );

        if (destroyed || version !== comparisonVersion) {
            return;
        }

        loadButton.disabled = false;

        if (!response.ok || !response.data) {
            currentComparison = null;
            results.style.display = "none";
            status.show(
                "Failed to load Chromaprint data" +
                    (response.error ? ": " + response.error : "."),
                "var(--is-error)",
            );
            return;
        }

        currentComparison = response.data;
        currentOffset = pickDefaultOffset(currentComparison);
        syncOffsetInputs(currentComparison, currentOffset, offsetRange, offsetNumber, offsetInfo);
        renderComparison();
        results.style.display = "grid";
        status.show("Chromaprint comparison loaded.", "var(--is-success)");
    }

    function renderComparison(): void {
        if (!currentComparison) {
            return;
        }

        const diffData = buildDiffData(currentComparison, currentOffset);
        const ranges = buildMatchRanges(currentComparison, diffData, currentOffset);

        renderSuggestions(suggestionsBody, currentComparison, currentOffset, (offset) => {
            const activeComparison = currentComparison;
            if (!activeComparison) {
                return;
            }

            currentOffset = clampOffset(activeComparison, offset);
            syncOffsetInputs(activeComparison, currentOffset, offsetRange, offsetNumber, offsetInfo);
            renderComparison();
        });
        renderMetrics(metricsGrid, currentComparison, ranges, currentOffset);
        renderLikelyIntro(likelyIntroBody, currentComparison);
        renderMatches(matchesList, currentComparison, ranges);
        drawComparison(canvas, currentComparison, diffData, currentOffset, ranges);
    }

    return {
        destroy() {
            destroyed = true;
            libraryField.select.removeEventListener("change", handleLibraryChange);
            showField.select.removeEventListener("change", handleShowChange);
            seasonField.select.removeEventListener("change", handleSeasonChange);
            loadButton.removeEventListener("click", handleCompareClick);
        },
    };
}

function createSelectControl(id: string, label: string): {
    container: HTMLElement;
    select: HTMLSelectElement;
} {
    const container = el("div", { className: "select-container" });
    const labelEl = el("label", { className: "select-label", for: id }, label);
    const select = el("select", { id, name: id }) as HTMLSelectElement;
    container.append(labelEl, select);
    return { container, select };
}

function setSelectState(select: HTMLSelectElement, disabled: boolean, text: string): void {
    populateSelect(select, [], text);
    select.disabled = disabled;
}

function populateSelect(
    select: HTMLSelectElement,
    options: Array<{ value: string; label: string }>,
    placeholder = "Select…",
): void {
    select.replaceChildren();
    if (options.length === 0) {
        select.append(el("option", { value: "" }, placeholder));
        return;
    }

    for (const option of options) {
        select.append(el("option", { value: option.value }, option.label));
    }
}

function renderSuggestions(
    container: HTMLElement,
    comparison: ChromaprintVisualizationComparison,
    currentOffset: number,
    onSelect: (offset: number) => void,
): void {
    container.replaceChildren();

    if (comparison.SuggestedOffsets.length === 0) {
        container.append(
            el(
                "div",
                { className: "field-description" },
                "No exact-match offsets were found. Try a manual offset.",
            ),
        );
        return;
    }

    for (const offset of comparison.SuggestedOffsets) {
        const button = el(
            "button",
            {
                className: "viz-chip" + (offset === currentOffset ? " active" : ""),
                type: "button",
            },
            formatOffsetLabel(offset, comparison.SampleDuration),
        ) as HTMLButtonElement;
        button.addEventListener("click", () => onSelect(offset));
        container.append(button);
    }
}

function renderMetrics(
    container: HTMLElement,
    comparison: ChromaprintVisualizationComparison,
    ranges: MatchRange[],
    currentOffset: number,
): void {
    container.replaceChildren();

    const averageSimilarity = ranges.length === 0
        ? 0
        : ranges.reduce((sum, range) => sum + range.similarity, 0) / ranges.length;
    const likelyIntroDuration = getLikelyIntroDuration(comparison);

    container.append(
        createMetricCard(
            "Fingerprint Window",
            formatRange(
                comparison.LeftEpisode.FingerprintStartSeconds,
                comparison.LeftEpisode.FingerprintEndSeconds,
            ) +
                " vs " +
                formatRange(
                    comparison.RightEpisode.FingerprintStartSeconds,
                    comparison.RightEpisode.FingerprintEndSeconds,
                ),
        ),
        createMetricCard("Offset", formatOffsetLabel(currentOffset, comparison.SampleDuration)),
        createMetricCard(
            "Possible Intro Length",
            likelyIntroDuration == null ? "No intro candidate" : formatTime(likelyIntroDuration),
        ),
        createMetricCard("Raw Similarity Regions", String(ranges.length)),
        createMetricCard(
            "Threshold",
            comparison.SimilarityThresholdPercent.toFixed(1) + "% similarity",
        ),
        createMetricCard(
            "Avg Match Similarity",
            ranges.length === 0 ? "None" : averageSimilarity.toFixed(1) + "%",
        ),
    );
}

function renderLikelyIntro(
    container: HTMLElement,
    comparison: ChromaprintVisualizationComparison,
): void {
    container.replaceChildren();

    const leftIntro = comparison.LikelyLeftIntro;
    const rightIntro = comparison.LikelyRightIntro;
    const duration = getLikelyIntroDuration(comparison);

    if (!leftIntro || !rightIntro || duration == null) {
        container.append(
            el(
                "div",
                { className: "field-description" },
                "No Chromaprint intro candidate was found for this pair.",
            ),
        );
        return;
    }

    const card = el("article", { className: "viz-match-card" });
    card.append(
        el("h4", { className: "viz-match-title" }, "Duration " + formatTime(duration)),
        el(
            "div",
            { className: "viz-match-meta" },
            "Adjusted by TimeAdjustmentHelper after ChromaprintAnalyzer.CompareEpisodes.",
        ),
        el(
            "div",
            { className: "viz-match-line" },
            formatVisualizationEpisodeLabel(comparison.LeftEpisode) + ": " + formatRange(leftIntro.Start, leftIntro.End),
        ),
        el(
            "div",
            { className: "viz-match-line" },
            formatVisualizationEpisodeLabel(comparison.RightEpisode) + ": " + formatRange(rightIntro.Start, rightIntro.End),
        ),
    );

    container.append(card);
}

function renderMatches(
    container: HTMLElement,
    comparison: ChromaprintVisualizationComparison,
    ranges: MatchRange[],
): void {
    container.replaceChildren();

    if (ranges.length === 0) {
        container.append(
            el(
                "div",
                { className: "field-description" },
                "No contiguous regions met the current similarity and duration thresholds.",
            ),
        );
        return;
    }

    for (const range of ranges) {
        const card = el("article", { className: "viz-match-card" });
        const title = el(
            "h4",
            { className: "viz-match-title" },
            formatRange(range.lhsStart, range.lhsEnd) + " / " + formatRange(range.rhsStart, range.rhsEnd),
        );
        const similarity = el(
            "div",
            { className: "viz-match-meta" },
            "Similarity " + range.similarity.toFixed(1) + "% · Duration " + formatTime(range.duration),
        );
        const lhs = el(
            "div",
            { className: "viz-match-line" },
            formatVisualizationEpisodeLabel(comparison.LeftEpisode) + ": " + formatRange(range.lhsStart, range.lhsEnd),
        );
        const rhs = el(
            "div",
            { className: "viz-match-line" },
            formatVisualizationEpisodeLabel(comparison.RightEpisode) + ": " + formatRange(range.rhsStart, range.rhsEnd),
        );
        card.append(title, similarity, lhs, rhs);
        container.append(card);
    }
}

function createMetricCard(label: string, value: string): HTMLElement {
    const card = el("div", { className: "viz-metric-card" });
    card.append(
        el("div", { className: "viz-metric-label" }, label),
        el("div", { className: "viz-metric-value" }, value),
    );
    return card;
}

function createLegendItem(className: string, label: string): HTMLElement {
    const item = el("div", { className: "viz-legend-item" });
    item.append(
        el("span", { className: "viz-legend-swatch " + className }, ""),
        el("span", {}, label),
    );
    return item;
}

function syncOffsetInputs(
    comparison: ChromaprintVisualizationComparison,
    offset: number,
    rangeInput: HTMLInputElement,
    numberInput: HTMLInputElement,
    info: HTMLElement,
): void {
    const limit = getOffsetLimit(comparison);
    rangeInput.min = String(-limit);
    rangeInput.max = String(limit);
    numberInput.min = String(-limit);
    numberInput.max = String(limit);
    rangeInput.value = String(offset);
    numberInput.value = String(offset);
    info.textContent =
        "1 point = " +
        comparison.SampleDuration.toFixed(4) +
        "s. Current shift: " +
        formatOffsetLabel(offset, comparison.SampleDuration);
}

function buildDiffData(
    comparison: ChromaprintVisualizationComparison,
    offset: number,
): DiffData {
    const left = comparison.LeftEpisode.Fingerprint;
    const right = comparison.RightEpisode.Fingerprint;
    let leftOffset = 0;
    let rightOffset = 0;

    if (offset < 0) {
        leftOffset = -offset;
    } else {
        rightOffset = offset;
    }

    const length = Math.max(0, Math.min(left.length, right.length) - Math.abs(offset));
    const diff = new Array<number>(length);
    const similarity = new Array<number>(length);

    for (let i = 0; i < length; i++) {
        const xor = (left[i + leftOffset] ^ right[i + rightOffset]) >>> 0;
        diff[i] = xor;
        similarity[i] = 100 - (countBits(xor) * 100) / 32;
    }

    return { diff, similarity, leftOffset, rightOffset };
}

function buildMatchRanges(
    comparison: ChromaprintVisualizationComparison,
    diffData: DiffData,
    offset: number,
): MatchRange[] {
    const ranges: MatchRange[] = [];
    const matchingIndexes: number[] = [];
    const threshold = comparison.SimilarityThresholdPercent;

    for (let i = 0; i < diffData.similarity.length; i++) {
        if (diffData.similarity[i] >= threshold) {
            matchingIndexes.push(i);
        }
    }

    if (matchingIndexes.length === 0) {
        return ranges;
    }

    let startIndex = matchingIndexes[0];
    let endIndex = matchingIndexes[0];
    let lastTime = startIndex * comparison.SampleDuration;

    const finalizeRange = () => {
        const startTime = startIndex * comparison.SampleDuration;
        const endTime = endIndex * comparison.SampleDuration;
        const duration = endTime - startTime;
        if (duration < comparison.MinimumMatchDuration) {
            return;
        }

        const offsetSeconds = offset * comparison.SampleDuration;
        const lhsBase = comparison.LeftEpisode.FingerprintStartSeconds;
        const rhsBase = comparison.RightEpisode.FingerprintStartSeconds;
        const lhsStart = offset < 0 ? startTime - offsetSeconds + lhsBase : startTime + lhsBase;
        const lhsEnd = offset < 0 ? endTime - offsetSeconds + lhsBase : endTime + lhsBase;
        const rhsStart = offset < 0 ? startTime + rhsBase : startTime + offsetSeconds + rhsBase;
        const rhsEnd = offset < 0 ? endTime + rhsBase : endTime + offsetSeconds + rhsBase;
        const similarity = average(diffData.similarity.slice(startIndex, endIndex + 1));

        ranges.push({
            pointStart: startIndex,
            pointEnd: endIndex,
            similarity,
            duration,
            lhsStart,
            lhsEnd,
            rhsStart,
            rhsEnd,
        });
    };

    for (let i = 1; i < matchingIndexes.length; i++) {
        const currentIndex = matchingIndexes[i];
        const currentTime = currentIndex * comparison.SampleDuration;
        if (currentTime - lastTime <= comparison.MaximumTimeSkip) {
            endIndex = currentIndex;
            lastTime = currentTime;
            continue;
        }

        finalizeRange();
        startIndex = currentIndex;
        endIndex = currentIndex;
        lastTime = currentTime;
    }

    finalizeRange();
    return ranges;
}

function drawComparison(
    canvas: HTMLCanvasElement,
    comparison: ChromaprintVisualizationComparison,
    diffData: DiffData,
    offset: number,
    ranges: MatchRange[],
): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return;
    }

    const leftFingerprint = comparison.LeftEpisode.Fingerprint;
    const rightFingerprint = comparison.RightEpisode.Fingerprint;
    if (leftFingerprint.length === 0 || rightFingerprint.length === 0) {
        canvas.width = 0;
        canvas.height = 0;
        return;
    }

    const pixelsLeft = renderFingerprintData(ctx, leftFingerprint);
    const pixelsRight = renderFingerprintData(ctx, rightFingerprint);
    const pixelsDiff = renderFingerprintData(ctx, diffData.diff);
    const border = 8;
    const similarityWidth = 8;
    const diffX = pixelsLeft.width + border + pixelsRight.width + border;
    const similarityX = diffX + pixelsDiff.width + border;
    const verticalOffset = Math.abs(offset);

    canvas.width = pixelsLeft.width + border + pixelsRight.width + border + pixelsDiff.width + border + similarityWidth + border;
    canvas.height = Math.max(pixelsLeft.height, pixelsRight.height) + verticalOffset;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#C5C5C5";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.putImageData(pixelsLeft, 0, diffData.rightOffset);
    ctx.putImageData(pixelsRight, pixelsLeft.width + border, diffData.leftOffset);
    ctx.putImageData(pixelsDiff, diffX, verticalOffset);

    for (let i = 0; i < diffData.similarity.length; i++) {
        const point = diffData.similarity[i];
        const y = verticalOffset + i;
        if (point >= 100) {
            ctx.fillStyle = "#002FFF";
        } else if (point >= comparison.SimilarityThresholdPercent) {
            ctx.fillStyle = "#2C92EF";
        } else {
            ctx.fillStyle = "#EA3535";
        }
        ctx.fillRect(similarityX, y, similarityWidth, 1);
    }

    ctx.fillStyle = "rgba(44, 146, 239, 0.22)";
    for (const range of ranges) {
        const y = verticalOffset + range.pointStart;
        const height = Math.max(1, range.pointEnd - range.pointStart + 1);
        ctx.fillRect(diffX, y, pixelsDiff.width, height);
        ctx.fillRect(similarityX, y, similarityWidth, height);
    }
}

function renderFingerprintData(ctx: CanvasRenderingContext2D, fingerprint: number[]): ImageData {
    const pixels = ctx.createImageData(32, Math.max(1, fingerprint.length));
    let index = 0;

    for (let i = 0; i < fingerprint.length; i++) {
        const point = fingerprint[i] >>> 0;
        for (let bit = 0; bit < 32; bit++) {
            const isOn = (point & (1 << bit)) !== 0;
            const value = isOn ? 255 : 0;
            pixels.data[index + 0] = value;
            pixels.data[index + 1] = value;
            pixels.data[index + 2] = value;
            pixels.data[index + 3] = 255;
            index += 4;
        }
    }

    return pixels;
}

function countBits(value: number): number {
    let bits = value >>> 0;
    let count = 0;
    while (bits !== 0) {
        count += bits & 1;
        bits >>>= 1;
    }
    return count;
}

function pickDefaultOffset(comparison: ChromaprintVisualizationComparison): number {
    if (comparison.SuggestedOffsets.length === 0) {
        return 0;
    }

    return comparison.SuggestedOffsets.reduce((best, current) =>
        Math.abs(current) < Math.abs(best) ? current : best,
    );
}

function clampOffset(comparison: ChromaprintVisualizationComparison, offset: number): number {
    const limit = getOffsetLimit(comparison);
    return Math.max(-limit, Math.min(limit, Math.trunc(offset)));
}

function getOffsetLimit(comparison: ChromaprintVisualizationComparison): number {
    return Math.max(
        0,
        Math.min(
            comparison.LeftEpisode.Fingerprint.length,
            comparison.RightEpisode.Fingerprint.length,
        ) - 1,
    );
}

function average(values: number[]): number {
    if (values.length === 0) {
        return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getLikelyIntroDuration(comparison: ChromaprintVisualizationComparison): number | null {
    const leftIntro = comparison.LikelyLeftIntro;
    const rightIntro = comparison.LikelyRightIntro;
    if (!leftIntro || !rightIntro || !leftIntro.Valid || !rightIntro.Valid) {
        return null;
    }

    return Math.min(leftIntro.End - leftIntro.Start, rightIntro.End - rightIntro.Start);
}

function formatShowLabel(show: ShowItem): string {
    return show.ProductionYear ? `${show.Name} (${String(show.ProductionYear)})` : show.Name;
}

function formatSeasonLabel(season: SeasonItem): string {
    return season.IndexNumber == null ? season.Name : `Season ${String(season.IndexNumber)} · ${season.Name}`;
}

function formatEpisodeLabel(episode: EpisodeItem): string {
    return episode.IndexNumber == null
        ? episode.Name
        : `E${String(episode.IndexNumber).padStart(2, "0")} · ${episode.Name}`;
}

function formatRange(start: number, end: number): string {
    return formatTime(start) + " – " + formatTime(end);
}

function formatVisualizationEpisodeLabel(
    episode: ChromaprintVisualizationComparison["LeftEpisode"],
): string {
    if (episode.EpisodeNumber > 0) {
        return `E${String(episode.EpisodeNumber).padStart(2, "0")} · ${episode.Name}`;
    }

    return episode.Name;
}

function formatOffsetLabel(offset: number, sampleDuration: number): string {
    const seconds = offset * sampleDuration;
    const prefix = offset > 0 ? "+" : "";
    const secondsPrefix = seconds > 0 ? "+" : "";
    return prefix + String(offset) + " pts (" + secondsPrefix + seconds.toFixed(3) + "s)";
}
