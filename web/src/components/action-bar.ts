import { el } from "./dom.ts";
import { bindStatusMessage, withDashboardLoading } from "./async-feedback.ts";
import { confirmDialog } from "./confirm-dialog.ts";
import { theIntroDbSubmitDialog } from "./theintrodb-submit-dialog.ts";
import * as api from "../store/api.ts";
import * as jellyfinClient from "../store/jellyfin-client.ts";
import * as theIntroDb from "../store/theintrodb-client.ts";
import type {
    AnalyzerActions,
    ApiResult,
    EpisodeItem,
    SeasonItem,
    ShowItem,
    TimestampMap,
} from "../types.ts";
import { delay } from "../utils.ts";

const ANALYZER_ACTION_ORDER: ReadonlyArray<{
    key: string;
    label: string;
    options: ReadonlyArray<{ value: string; label: string }>;
}> = [
    {
        key: "Recap",
        label: "Recap",
        options: [
            { value: "Default", label: "Default" },
            { value: "Chapter", label: "Chapter" },
            { value: "None", label: "None" },
        ],
    },
    {
        key: "Introduction",
        label: "Intro",
        options: [
            { value: "Default", label: "Default" },
            { value: "Chapter", label: "Chapter" },
            { value: "Chromaprint", label: "Chromaprint" },
            { value: "None", label: "None" },
        ],
    },
    {
        key: "Credits",
        label: "Credits",
        options: [
            { value: "Default", label: "Default" },
            { value: "Chapter", label: "Chapter" },
            { value: "Chromaprint", label: "Chromaprint" },
            { value: "BlackFrame", label: "BlackFrame" },
            { value: "None", label: "None" },
        ],
    },
    {
        key: "Preview",
        label: "Preview",
        options: [
            { value: "Default", label: "Default" },
            { value: "Chapter", label: "Chapter" },
            { value: "None", label: "None" },
        ],
    },
    {
        key: "Commercial",
        label: "Commercial",
        options: [
            { value: "Default", label: "Default" },
            { value: "Chapter", label: "Chapter" },
            { value: "None", label: "None" },
        ],
    },
];

const SEGMENT_EDITOR_PLUGIN_ID = "ace21d44a4e54a85ae75acd2e24a9574";

export type ActionBarOptions = {
    onScanComplete: () => void | Promise<void>;
};

export type ActionBarLoadContext = {
    show: ShowItem;
    season: SeasonItem | null;
    episodes: EpisodeItem[];
    timestamps: Array<ApiResult<TimestampMap> | null>;
    isMovie: boolean;
};

export function actionBar(opts: ActionBarOptions): {
    container: HTMLElement;
    toggle: (open: boolean) => void;
    loadForSeason: (context: ActionBarLoadContext) => Promise<void>;
    destroy: () => void;
} {
    const container = el("div", { className: "ts-action-bar" });
    container.id = "ts-action-panel";

    const actionSelects: Record<string, HTMLSelectElement> = {};
    const analyzerGroup = el("div", { className: "ts-analyzer-group" });

    for (const action of ANALYZER_ACTION_ORDER) {
        const item = el("div", { className: "ts-analyzer-item" });
        const selectId = "ts-analyzer-" + action.key.toLowerCase();
        const labelEl = el(
            "label",
            { className: "ts-analyzer-label", for: selectId },
            action.label,
        );
        const select = el("select", {
            id: selectId,
            name: "analyzer-" + action.key.toLowerCase(),
        }) as HTMLSelectElement;
        for (const opt of action.options) {
            select.append(el("option", { value: opt.value }, opt.label));
        }
        actionSelects[action.key] = select;
        item.append(labelEl);
        item.append(select);
        analyzerGroup.append(item);
    }

    const applyBtn = el(
        "button",
        { className: "ts-action-btn apply", type: "button" },
        "Save Analyzer Overrides",
    );
    const scanBtn = el(
        "button",
        { className: "ts-action-btn scan", type: "button" },
        "Scan Season",
    );
    const submitBtn = el(
        "button",
        { className: "ts-action-btn submit", type: "button" },
        "Submit to TheIntroDB",
    );
    const eraseBtn = el(
        "button",
        { className: "ts-action-btn erase", type: "button" },
        "Erase Season Timestamps",
    );

    const buttonsDiv = el("div", { className: "ts-action-buttons" });
    buttonsDiv.append(applyBtn, scanBtn, submitBtn, eraseBtn);

    const row = el("div", { className: "ts-action-row" });
    row.append(analyzerGroup, buttonsDiv);

    const metaRow = el("div", { className: "ts-action-meta" });
    const statusEl = el("div", { className: "ts-action-status" });
    const statusMessage = bindStatusMessage(statusEl, { display: "block" });
    const editorLink = el(
        "a",
        {
            href: "#/dashboard/plugins/" + SEGMENT_EDITOR_PLUGIN_ID + "?name=Segment Editor",
        },
        "Segment Editor \u2192",
    );
    metaRow.append(editorLink);

    container.append(row, metaRow, statusEl);

    let currentShow: ShowItem | null = null;
    let currentSeasonId = "";
    let currentSeasonName = "";
    let currentSeasonNumber: number | null = null;
    let currentEpisodes: EpisodeItem[] = [];
    let currentTimestamps: Array<ApiResult<TimestampMap> | null> = [];
    let currentIsMovie = false;
    let destroyed = false;
    let loadVersion = 0;
    let scanVersion = 0;

    function updateActionLabels(): void {
        scanBtn.textContent = currentIsMovie ? "Scan Movie" : "Scan Season";
        eraseBtn.textContent = currentIsMovie
            ? "Erase Movie Timestamps"
            : "Erase Season Timestamps";
    }

    function resetScanButton(): void {
        scanBtn.disabled = false;
        updateActionLabels();
    }

    function resetSubmitButton(): void {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit to TheIntroDB";
    }

    const handleApplyClick = async () => {
        if (destroyed) return;

        statusMessage.show("Saving analyzer overrides\u2026", "var(--is-text-muted)");

        try {
            await withDashboardLoading(async () => {
                const actions: AnalyzerActions = {
                    Introduction: actionSelects["Introduction"].value,
                    Credits: actionSelects["Credits"].value,
                    Recap: actionSelects["Recap"].value,
                    Preview: actionSelects["Preview"].value,
                    Commercial: actionSelects["Commercial"].value,
                };
                await api.updateAnalyzerActions(currentSeasonId, actions);
            });
            statusMessage.show("Analyzer overrides updated.", "var(--is-success)");
            window.Dashboard.alert("Analyzer actions updated");
        } catch {
            statusMessage.show("Failed to update analyzer overrides.", "var(--is-error)");
            window.Dashboard.alert("Failed to update analyzer actions");
        }
    };

    const pollForScanCompletion = async (scanToken: number): Promise<void> => {
        const BASE_INTERVAL = 5000;
        const MAX_INTERVAL = 30_000;

        let attempts = 0;
        let interval = BASE_INTERVAL;

        while (!destroyed && scanToken === scanVersion) {
            await delay(interval);
            if (destroyed || scanToken !== scanVersion) {
                return;
            }

            attempts++;
            const status = await api.getScanStatus();

            if (destroyed || scanToken !== scanVersion) {
                return;
            }

            if (status.ok && !status.data?.isRunning) {
                resetScanButton();
                statusMessage.show("Scan finished. Results refreshed.", "var(--is-success)");
                await Promise.resolve(opts.onScanComplete());
                return;
            }

            if (!status.ok) {
                interval = Math.min(interval * 2, MAX_INTERVAL);
            } else {
                interval = BASE_INTERVAL;
            }
        }

        if (destroyed || scanToken !== scanVersion) {
            return;
        }

        resetScanButton();
        statusMessage.show(
            "Scan status polling timed out. Refresh to check results.",
            "var(--is-warning)",
        );
        window.Dashboard.alert("Scan status polling timed out. Refresh to check results.");
    };

    const handleScanClick = async () => {
        if (destroyed || !currentShow) return;
        const showId = currentShow.Id;

        const scanToken = ++scanVersion;
        scanBtn.disabled = true;
        statusMessage.show("Starting scan\u2026", "var(--is-text-muted)");
        try {
            const response = await withDashboardLoading(async () => {
                const seasonId = currentIsMovie ? showId : currentSeasonId;
                return api.scanSeason(showId, seasonId);
            });

            if (destroyed || scanToken !== scanVersion) {
                return;
            }

            if (response.status === 409) {
                statusMessage.show("A scan is already in progress.", "var(--is-warning)");
                window.Dashboard.alert("A scan is already in progress.");
            } else if (!response.ok) {
                resetScanButton();
                statusMessage.show("Unable to start the scan.", "var(--is-error)");
                window.Dashboard.alert("Unable to start the scan.");
                return;
            }

            scanBtn.textContent = "Scan in progress\u2026";
            statusMessage.show(
                "Scan in progress\u2026 This can take several minutes.",
                "var(--is-text-muted)",
            );

            void pollForScanCompletion(scanToken).catch(console.error);
        } catch {
            resetScanButton();
            statusMessage.show("Unable to start the scan.", "var(--is-error)");
            window.Dashboard.alert("Unable to start the scan.");
        }
    };

    const handleEraseClick = async () => {
                if (destroyed || !currentShow) return;
                const showId = currentShow.Id;

        const label = currentIsMovie ? "movie" : "season";
        const url = currentIsMovie
                        ? "Intros/Show/" + encodeURIComponent(showId)
            : "Intros/Show/" +
                            encodeURIComponent(showId) +
              "/" +
              encodeURIComponent(currentSeasonId);
        const result = await confirmDialog({
            title: "Confirm Timestamp Erasure",
            body: "Are you sure you want to erase all timestamps for this " + label + "?",
            confirmLabel: "Erase",
            checkbox: { label: "Include cached fingerprints" },
        });
        if (destroyed) return;
        if (!result) return;
        statusMessage.show("Erasing timestamps\u2026", "var(--is-text-muted)");
        try {
            const response = await api.eraseItemTimestamps(url, result.checkboxChecked);
            if (!response.ok) {
                statusMessage.show("Failed to erase timestamps.", "var(--is-error)");
                window.Dashboard.alert("Failed to erase timestamps");
                return;
            }
            statusMessage.show("Timestamps erased.", "var(--is-success)");
            window.Dashboard.alert("Timestamps erased");
            await Promise.resolve(opts.onScanComplete());
        } catch {
            statusMessage.show("Failed to erase timestamps.", "var(--is-error)");
            window.Dashboard.alert("Failed to erase timestamps");
        }
    };

    const handleSubmitClick = async () => {
        if (destroyed || currentIsMovie || !currentShow) {
            return;
        }

        if (currentSeasonNumber == null) {
            statusMessage.show(
                "This season has no numeric season number, so it cannot be submitted.",
                "var(--is-error)",
            );
            window.Dashboard.alert(
                "This season has no numeric season number, so it cannot be submitted.",
            );
            return;
        }

        const providerIds = await jellyfinClient.getProviderIds(currentShow.Id);
        const { tmdbId, imdbId } = theIntroDb.getExternalIds(providerIds);
        if (!tmdbId) {
            statusMessage.show(
                "This series is missing a TMDB provider ID in Jellyfin.",
                "var(--is-error)",
            );
            window.Dashboard.alert("This series is missing a TMDB provider ID in Jellyfin.");
            return;
        }

        const plan = theIntroDb.buildSeasonSubmissionPlan({
            tmdbId,
            imdbId,
            seasonNumber: currentSeasonNumber,
            episodes: currentEpisodes,
            timestamps: currentTimestamps,
        });

        if (plan.length === 0) {
            statusMessage.show(
                "No IntroDB-compatible timestamps were found in the current season.",
                "var(--is-warning)",
            );
            window.Dashboard.alert(
                "No IntroDB-compatible timestamps were found in the current season.",
            );
            return;
        }

        const affectedEpisodes = new Set(plan.map((entry) => entry.episodeId)).size;
        const dialogResult = await theIntroDbSubmitDialog({
            title: "Submit Current Season to TheIntroDB",
            body:
                "Submit " +
                String(plan.length) +
                " segment timestamps from " +
                String(affectedEpisodes) +
                " episodes for " +
                currentShow.Name +
                (currentSeasonName ? " - " + currentSeasonName : "") +
                "?",
            confirmLabel: "Submit",
            apiKey: theIntroDb.getStoredApiKey(),
            rememberApiKey: theIntroDb.getStoredApiKey().length > 0,
        });

        if (destroyed || !dialogResult) {
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting…";
        statusMessage.show("Submitting timestamps to TheIntroDB…", "var(--is-text-muted)");

        try {
            const result = await withDashboardLoading(async () =>
                theIntroDb.submitSeasonPlan(dialogResult.apiKey, plan, (current, total, entry) => {
                    statusMessage.show(
                        "Submitting to TheIntroDB… " +
                            String(current) +
                            "/" +
                            String(total) +
                            " (E" +
                            String(entry.episodeNumber).padStart(2, "0") +
                            " " +
                            entry.segmentLabel +
                            ")",
                        "var(--is-text-muted)",
                    );
                }),
            );

            if (result.unauthorized) {
                theIntroDb.clearStoredApiKey();
                statusMessage.show("TheIntroDB API key was rejected.", "var(--is-error)");
                window.Dashboard.alert("TheIntroDB API key was rejected.");
                return;
            }

            if (dialogResult.rememberApiKey) {
                theIntroDb.storeApiKey(dialogResult.apiKey);
            } else {
                theIntroDb.clearStoredApiKey();
            }

            const summary =
                "Submitted " +
                String(result.submitted) +
                " segments" +
                (result.conflicts > 0
                    ? ", skipped " + String(result.conflicts) + " duplicates"
                    : "") +
                (result.failed > 0 ? ", failed " + String(result.failed) : "") +
                ".";

            statusMessage.show(
                summary,
                result.failed > 0 ? "var(--is-warning)" : "var(--is-success)",
            );
            window.Dashboard.alert(
                result.failed > 0 && result.errors.length > 0
                    ? summary + " First error: " + result.errors[0]
                    : summary,
            );
        } catch {
            statusMessage.show("Failed to submit timestamps to TheIntroDB.", "var(--is-error)");
            window.Dashboard.alert("Failed to submit timestamps to TheIntroDB.");
        } finally {
            resetSubmitButton();
        }
    };

    async function resolveEditorLink(): Promise<void> {
        try {
            const plugins = await api.checkPlugins();
            if (destroyed) {
                return;
            }

            const isActive = plugins.some(
                (p) => p.Id === SEGMENT_EDITOR_PLUGIN_ID && p.Status === "Active",
            );
            if (isActive) {
                editorLink.setAttribute("href", "#/configurationpage?name=Segment%20Editor");
            }
        } catch {
            // Leave the generic plugin page link in place if plugin lookup fails.
        }
    }

    // Resolve the editor link once at construction time so it's ready
    // before the user navigates to a specific season.
    resolveEditorLink().catch(console.error);

    applyBtn.addEventListener("click", handleApplyClick);
    scanBtn.addEventListener("click", handleScanClick);
    submitBtn.addEventListener("click", handleSubmitClick);
    eraseBtn.addEventListener("click", handleEraseClick);

    return {
        container,

        toggle(open: boolean) {
            container.classList.toggle("open", open);
        },

        async loadForSeason(context: ActionBarLoadContext) {
            if (destroyed) return;

            const loadToken = ++loadVersion;
            scanVersion += 1;
            currentShow = context.show;
            currentSeasonId = context.season?.Id ?? context.show.Id;
            currentSeasonName = context.season?.Name ?? "";
            currentSeasonNumber = context.season?.IndexNumber ?? null;
            currentEpisodes = context.episodes;
            currentTimestamps = context.timestamps;
            currentIsMovie = context.isMovie;

            resetScanButton();
            resetSubmitButton();
            statusMessage.clear();

            // Analyzer overrides only apply to seasons, not single movies.
            analyzerGroup.style.display = context.isMovie ? "none" : "";
            applyBtn.style.display = context.isMovie ? "none" : "";
            submitBtn.style.display = context.isMovie ? "none" : "";

            if (!context.isMovie) {
                const result = await api.getAnalyzerActions(currentSeasonId);
                if (destroyed || loadToken !== loadVersion) {
                    return;
                }

                const actions: AnalyzerActions = result.ok && result.data ? result.data : {};
                actionSelects["Introduction"].value = actions.Introduction ?? "Default";
                actionSelects["Credits"].value = actions.Credits ?? "Default";
                actionSelects["Recap"].value = actions.Recap ?? "Default";
                actionSelects["Preview"].value = actions.Preview ?? "Default";
                actionSelects["Commercial"].value = actions.Commercial ?? "Default";
            }

            // Disable the button if another scan is already running server-side.
            const status = await api.getScanStatus();
            if (destroyed || loadToken !== loadVersion) {
                return;
            }

            if (status.ok && status.data?.isRunning) {
                scanBtn.disabled = true;
                scanBtn.textContent = "Scan in progress\u2026";
                statusMessage.show(
                    "Scan in progress\u2026 This can take several minutes.",
                    "var(--is-text-muted)",
                );
            }
        },

        destroy() {
            destroyed = true;
            loadVersion += 1;
            scanVersion += 1;
            applyBtn.removeEventListener("click", handleApplyClick);
            scanBtn.removeEventListener("click", handleScanClick);
            submitBtn.removeEventListener("click", handleSubmitClick);
            eraseBtn.removeEventListener("click", handleEraseClick);
        },
    };
}
