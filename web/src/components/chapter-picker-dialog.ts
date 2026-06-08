import { el } from "./dom.ts";
import { formatTime } from "../utils.ts";
import * as api from "../store/api.ts";

const TICKS_PER_SECOND = 10_000_000;

export type ChapterPickerDialogOptions = {
    title: string;
    episodeId: string;
    episodeDurationSeconds: number;
    onSelect: (range: { start: number; end: number }) => void;
};

let dialogCounter = 0;

function ticksToSeconds(ticks: number): number {
    return ticks / TICKS_PER_SECOND;
}

export function chapterPickerDialog(opts: ChapterPickerDialogOptions): void {
    const uid = String(++dialogCounter);
    const titleId = "is-chapter-picker-title-" + uid;
    const bodyId = "is-chapter-picker-body-" + uid;

    const dialog = el("dialog", { className: "is-confirm-dialog is-chapter-picker-dialog" });
    dialog.setAttribute("aria-labelledby", titleId);
    dialog.setAttribute("aria-describedby", bodyId);

    const heading = el("h2", { id: titleId, className: "is-confirm-title" }, opts.title);
    const body = el(
        "p",
        { id: bodyId, className: "is-confirm-body" },
        "Select a chapter to set the timestamp. The next chapter boundary will be used as the end time.",
    );

    const chapterList = el("div", { className: "is-chapter-list" });
    const loadingEl = el("div", { className: "is-chapter-loading" }, "Loading chapters\u2026");
    chapterList.append(loadingEl);

    const errorEl = el("div", { className: "field-error" });
    errorEl.setAttribute("aria-live", "polite");

    const cancelBtn = el(
        "button",
        { className: "is-confirm-btn cancel", type: "button" },
        "Cancel",
    );

    const actions = el("div", { className: "is-confirm-actions" });
    actions.append(cancelBtn);

    dialog.append(heading, body, chapterList, errorEl, actions);

    function cleanup(): void {
        dialog.close();
        dialog.remove();
    }

    function setError(message: string): void {
        errorEl.textContent = message;
        errorEl.style.display = message ? "block" : "none";
    }

    cancelBtn.addEventListener("click", () => cleanup());
    dialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        cleanup();
    });
    dialog.addEventListener("click", (e) => {
        if (e.target === dialog) cleanup();
    });

    document.body.append(dialog);
    dialog.showModal();

    // Fetch chapters
    void loadChapters();

    async function loadChapters(): Promise<void> {
        const result = await api.getEpisodeChapters(opts.episodeId);

        if (!result.ok || !result.data) {
            chapterList.replaceChildren();
            setError("Failed to load chapters.");
            return;
        }

        const chapters = result.data;
        if (chapters.length === 0) {
            chapterList.replaceChildren();
            setError("No chapters available for this episode.");
            return;
        }

        chapterList.replaceChildren();

        for (let i = 0; i < chapters.length; i++) {
            const chapter = chapters[i];
            const startSeconds = ticksToSeconds(chapter.StartPositionTicks);
            const endSeconds = i + 1 < chapters.length
                ? ticksToSeconds(chapters[i + 1].StartPositionTicks)
                : opts.episodeDurationSeconds;

            const item = el("button", { className: "is-chapter-item", type: "button" });

            const nameSpan = el(
                "span",
                { className: "is-chapter-name" },
                chapter.Name || "Unnamed Chapter",
            );

            const timeSpan = el(
                "span",
                { className: "is-chapter-time" },
                formatTime(startSeconds) + " \u2013 " + formatTime(endSeconds) +
                " (" + formatTime(Math.max(0, endSeconds - startSeconds)) + ")",
            );

            item.append(nameSpan, timeSpan);

            item.addEventListener("click", () => {
                opts.onSelect({ start: startSeconds, end: endSeconds });
                cleanup();
            });

            chapterList.append(item);
        }
    }
}
