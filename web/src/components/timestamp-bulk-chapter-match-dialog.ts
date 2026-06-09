import { el } from "./dom.ts";
import { chapterPickerDialog } from "./chapter-picker-dialog.ts";
import { formatTime } from "../utils.ts";
import type { EpisodeChapter } from "../types.ts";

export type TimestampModeOption = {
    key: string;
    label: string;
};

export type ReferenceEpisodeOption = {
    id: string;
    name: string;
    episodeNumber?: number | null;
    durationSeconds?: number;
    chapters?: EpisodeChapter[];
};

export type TimestampBulkChapterMatchDialogOptions = {
    title: string;
    modes: ReadonlyArray<TimestampModeOption>;
    defaultModeKey?: string;
    referenceEpisodes: ReferenceEpisodeOption[];
    defaultReferenceEpisodeId?: string;
    onSave: (values: { modeKey: string; duration: number; tolerance: number }) => Promise<boolean>;
};

let dialogCounter = 0;

function formatInputValue(value: number): string {
    return String(Math.round(value * 1000) / 1000);
}

function parseInputValue(input: HTMLInputElement): number | null {
    const value = Number.parseFloat(input.value);
    return Number.isFinite(value) ? value : null;
}

export function timestampBulkChapterMatchDialog(
    opts: TimestampBulkChapterMatchDialogOptions,
): Promise<void> {
    return new Promise((resolve) => {
        const uid = String(++dialogCounter);
        const titleId = "is-timestamp-bulk-chapter-title-" + uid;
        const bodyId = "is-timestamp-bulk-chapter-body-" + uid;
        const modeId = "is-timestamp-bulk-chapter-mode-" + uid;
        const episodeId = "is-timestamp-bulk-chapter-episode-" + uid;
        const sourceId = "is-timestamp-bulk-chapter-source-" + uid;
        const durationId = "is-timestamp-bulk-chapter-duration-" + uid;
        const toleranceId = "is-timestamp-bulk-chapter-tolerance-" + uid;

        let selectedReferenceEpisodeId = opts.defaultReferenceEpisodeId ?? opts.referenceEpisodes[0]?.id ?? "";
        let isSaving = false;
        let selectedChapterRange: { start: number; end: number } | null = null;

        const dialog = el("dialog", { className: "is-confirm-dialog is-bulk-chapter-match-dialog" });
        dialog.setAttribute("aria-labelledby", titleId);
        dialog.setAttribute("aria-describedby", bodyId);

        const heading = el("h2", { id: titleId, className: "is-confirm-title" }, opts.title);
        const body = el(
            "p",
            { id: bodyId, className: "is-confirm-body" },
            "Match chapter durations across the selected episodes, then save the matching chapter as the chosen timestamp type.",
        );

        const modeLabel = el(
            "label",
            { className: "is-confirm-input-label", for: modeId },
            "Timestamp type",
        );
        const modeSelect = el("select", { id: modeId, className: "is-confirm-input" }) as HTMLSelectElement;
        for (const mode of opts.modes) {
            modeSelect.append(el("option", { value: mode.key }, mode.label));
        }
        if (opts.defaultModeKey) {
            modeSelect.value = opts.defaultModeKey;
        }
        const modeRow = el("div", { className: "is-confirm-input-row" });
        modeRow.append(modeLabel, modeSelect);

        const episodeLabel = el(
            "label",
            { className: "is-confirm-input-label", for: episodeId },
            "Reference episode",
        );
        const episodeSelect = el("select", { id: episodeId, className: "is-confirm-input" }) as HTMLSelectElement;
        for (const episode of opts.referenceEpisodes) {
            const episodeLabel = episode.episodeNumber != null
                ? "E" + String(episode.episodeNumber).padStart(2, "0") + " - " + episode.name
                : episode.name;
            episodeSelect.append(el("option", { value: episode.id }, episodeLabel));
        }
        episodeSelect.value = selectedReferenceEpisodeId;
        const episodeRow = el("div", { className: "is-confirm-input-row" });
        episodeRow.append(episodeLabel, episodeSelect);

        const sourceLabel = el(
            "label",
            { className: "is-confirm-input-label", for: sourceId },
            "Reference source",
        );
        const sourceSelect = el("select", { id: sourceId, className: "is-confirm-input" }) as HTMLSelectElement;
        sourceSelect.append(el("option", { value: "chapter" }, "Pick a chapter from the reference episode"));
        sourceSelect.append(el("option", { value: "manual" }, "Enter a duration manually"));
        sourceSelect.value = "chapter";
        const sourceRow = el("div", { className: "is-confirm-input-row" });
        sourceRow.append(sourceLabel, sourceSelect);

        const chapterRow = el("div", { className: "is-confirm-input-row" });
        const pickChapterBtn = el(
            "button",
            { className: "is-confirm-btn cancel", type: "button" },
            "Choose Reference Chapter",
        ) as HTMLButtonElement;
        const chapterSummary = el("div", { className: "field-description" }, "No chapter selected yet.");
        chapterRow.append(pickChapterBtn, chapterSummary);

        const durationLabel = el(
            "label",
            { className: "is-confirm-input-label", for: durationId },
            "Reference duration (seconds)",
        );
        const durationInput = el("input", {
            id: durationId,
            className: "is-confirm-input",
            type: "number",
            min: "0.001",
            step: "0.001",
            inputmode: "decimal",
            placeholder: "Example: 90",
        }) as HTMLInputElement;
        durationInput.value = formatInputValue(90);
        const durationRow = el("div", { className: "is-confirm-input-row" });
        durationRow.append(durationLabel, durationInput);

        const toleranceLabel = el(
            "label",
            { className: "is-confirm-input-label", for: toleranceId },
            "Tolerance (seconds)",
        );
        const toleranceInput = el("input", {
            id: toleranceId,
            className: "is-confirm-input",
            type: "number",
            min: "0",
            step: "0.1",
            inputmode: "decimal",
            placeholder: "Example: 1",
        }) as HTMLInputElement;
        toleranceInput.value = formatInputValue(1);
        const toleranceRow = el("div", { className: "is-confirm-input-row" });
        toleranceRow.append(toleranceLabel, toleranceInput);

        const helper = el(
            "div",
            { className: "field-description" },
            "Episodes whose chapter duration is within the tolerance will be updated to the selected timestamp type.",
        );

        const errorEl = el("div", { className: "field-error" });
        errorEl.setAttribute("aria-live", "polite");

        const cancelBtn = el("button", { className: "is-confirm-btn cancel", type: "button" }, "Cancel");
        const saveBtn = el("button", { className: "is-confirm-btn primary", type: "button" }, "Save") as HTMLButtonElement;
        const actions = el("div", { className: "is-confirm-actions" });
        actions.append(cancelBtn, saveBtn);

        dialog.append(
            heading,
            body,
            modeRow,
            episodeRow,
            sourceRow,
            chapterRow,
            durationRow,
            toleranceRow,
            helper,
            errorEl,
            actions,
        );

        function cleanup(): void {
            dialog.close();
            dialog.remove();
            resolve();
        }

        function getSelectedReferenceEpisode(): ReferenceEpisodeOption | undefined {
            return opts.referenceEpisodes.find((episode) => episode.id === selectedReferenceEpisodeId);
        }

        function canPickReferenceChapter(): boolean {
            const episode = getSelectedReferenceEpisode();
            return (episode?.chapters?.length ?? 0) > 0 && typeof episode?.durationSeconds === "number";
        }

        function setError(message: string): void {
            errorEl.textContent = message;
            errorEl.style.display = message ? "block" : "none";
        }

        function syncChapterSummary(): void {
            if (!selectedChapterRange) {
                chapterSummary.textContent = canPickReferenceChapter()
                    ? "No chapter selected yet."
                    : "The selected reference episode does not have usable chapter data, so use manual duration instead.";
                return;
            }

            chapterSummary.textContent =
                "Selected chapter: " +
                formatTime(selectedChapterRange.start) +
                " - " +
                formatTime(selectedChapterRange.end) +
                " (" +
                formatTime(Math.max(0, selectedChapterRange.end - selectedChapterRange.start)) +
                ")";
        }

        function syncSourceState(): void {
            const usingChapterSource = sourceSelect.value === "chapter";
            pickChapterBtn.disabled = isSaving || !canPickReferenceChapter() || !usingChapterSource;
            durationInput.disabled = isSaving || usingChapterSource;
        }

        function getResolvedDuration(): number | null {
            if (sourceSelect.value === "chapter") {
                if (!selectedChapterRange) {
                    return null;
                }

                return selectedChapterRange.end - selectedChapterRange.start;
            }

            return parseInputValue(durationInput);
        }

        function isValid(): boolean {
            const duration = getResolvedDuration();
            const tolerance = parseInputValue(toleranceInput);
            return modeSelect.value.length > 0 && duration !== null && duration > 0 && tolerance !== null && tolerance >= 0;
        }

        function updateButtonState(): void {
            syncSourceState();
            saveBtn.disabled = isSaving || !isValid();
        }

        function setSaving(value: boolean): void {
            isSaving = value;
            modeSelect.disabled = value;
            episodeSelect.disabled = value;
            sourceSelect.disabled = value;
            toleranceInput.disabled = value;
            cancelBtn.disabled = value;
            saveBtn.textContent = value ? "Saving..." : "Save";
            updateButtonState();
        }

        async function handleSave(): Promise<void> {
            if (isSaving || !isValid()) {
                updateButtonState();
                return;
            }

            const duration = getResolvedDuration();
            const tolerance = parseInputValue(toleranceInput);
            if (duration === null || duration <= 0) {
                setError("Please enter a valid reference duration.");
                updateButtonState();
                return;
            }
            if (tolerance === null || tolerance < 0) {
                setError("Please enter a valid tolerance.");
                updateButtonState();
                return;
            }

            setSaving(true);
            setError("");

            try {
                const saved = await opts.onSave({
                    modeKey: modeSelect.value,
                    duration,
                    tolerance,
                });
                if (saved) {
                    cleanup();
                    return;
                }

                setError("Failed to save timestamps.");
            } catch {
                setError("Failed to save timestamps.");
            }

            setSaving(false);
        }

        pickChapterBtn.addEventListener("click", () => {
            const referenceEpisode = getSelectedReferenceEpisode();
            if (!canPickReferenceChapter() || typeof referenceEpisode?.durationSeconds !== "number") {
                return;
            }

            chapterPickerDialog({
                title: "Choose Reference Chapter",
                chapters: referenceEpisode.chapters ?? [],
                episodeDurationSeconds: referenceEpisode.durationSeconds,
                onSelect: (range) => {
                    selectedChapterRange = range;
                    durationInput.value = formatInputValue(range.end - range.start);
                    syncChapterSummary();
                    updateButtonState();
                },
            });
        });
        episodeSelect.addEventListener("change", () => {
            selectedReferenceEpisodeId = episodeSelect.value;
            selectedChapterRange = null;
            syncChapterSummary();
            updateButtonState();
        });
        sourceSelect.addEventListener("change", updateButtonState);
        durationInput.addEventListener("input", updateButtonState);
        toleranceInput.addEventListener("input", updateButtonState);
        modeSelect.addEventListener("change", updateButtonState);
        cancelBtn.addEventListener("click", () => cleanup());
        saveBtn.addEventListener("click", () => {
            void handleSave();
        });

        dialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            cleanup();
        });
        dialog.addEventListener("click", (event) => {
            if (event.target === dialog) {
                cleanup();
            }
        });
        dialog.addEventListener("keydown", (event) => {
            if (
                event.key === "Enter" &&
                (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) &&
                !saveBtn.disabled
            ) {
                event.preventDefault();
                void handleSave();
            }
        });

        document.body.append(dialog);
        syncChapterSummary();
        updateButtonState();
        dialog.showModal();
        modeSelect.focus();
    });
}
