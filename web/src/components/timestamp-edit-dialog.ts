import { el } from "./dom.ts";
import { confirmDialog } from "./confirm-dialog.ts";
import { formatTime } from "../utils.ts";

export type TimestampEditDialogOptions = {
    title: string;
    initialStart: number;
    initialEnd: number;
    onSave: (values: { start: number; end: number }) => Promise<boolean>;
    onDelete?: () => Promise<boolean>;
};

let dialogCounter = 0;

function formatInputValue(value: number): string {
    return String(Math.round(value * 1000) / 1000);
}

function parseInputValue(input: HTMLInputElement): number | null {
    const value = Number.parseFloat(input.value);
    return Number.isFinite(value) ? value : null;
}

export function timestampEditDialog(opts: TimestampEditDialogOptions): Promise<void> {
    return new Promise((resolve) => {
        const uid = String(++dialogCounter);
        const titleId = "is-timestamp-edit-title-" + uid;
        const bodyId = "is-timestamp-edit-body-" + uid;
        const startId = "is-timestamp-edit-start-" + uid;
        const endId = "is-timestamp-edit-end-" + uid;
        const durationId = "is-timestamp-edit-duration-" + uid;

        const dialog = el("dialog", { className: "is-confirm-dialog" });
        dialog.setAttribute("aria-labelledby", titleId);
        dialog.setAttribute("aria-describedby", bodyId);

        const heading = el("h2", { id: titleId, className: "is-confirm-title" }, opts.title);
        const body = el(
            "p",
            { id: bodyId, className: "is-confirm-body" },
            "Adjust the segment timing in seconds.",
        );
        const helper = el(
            "div",
            { className: "field-description" },
            "Current duration: " +
                formatTime(Math.max(0, opts.initialEnd - opts.initialStart)) +
                ". Changing Duration updates End automatically.",
        );

        const startLabel = el(
            "label",
            { className: "is-confirm-input-label", for: startId },
            "Start (seconds)",
        );
        const startInput = el("input", {
            id: startId,
            className: "is-confirm-input",
            type: "number",
            min: "0",
            step: "0.001",
            inputmode: "decimal",
        }) as HTMLInputElement;
        startInput.value = formatInputValue(opts.initialStart);

        const startRow = el("div", { className: "is-confirm-input-row" });
        startRow.append(startLabel, startInput);

        const endLabel = el(
            "label",
            { className: "is-confirm-input-label", for: endId },
            "End (seconds)",
        );
        const endInput = el("input", {
            id: endId,
            className: "is-confirm-input",
            type: "number",
            min: "0",
            step: "0.001",
            inputmode: "decimal",
        }) as HTMLInputElement;
        endInput.value = formatInputValue(opts.initialEnd);

        const endRow = el("div", { className: "is-confirm-input-row" });
        endRow.append(endLabel, endInput);

        const durationLabel = el(
            "label",
            { className: "is-confirm-input-label", for: durationId },
            "Duration (seconds)",
        );
        const durationInput = el("input", {
            id: durationId,
            className: "is-confirm-input",
            type: "number",
            min: "0",
            step: "0.001",
            inputmode: "decimal",
        }) as HTMLInputElement;
        durationInput.value = formatInputValue(Math.max(0, opts.initialEnd - opts.initialStart));

        const durationRow = el("div", { className: "is-confirm-input-row" });
        durationRow.append(durationLabel, durationInput);

        const errorEl = el("div", { className: "field-error" });
        errorEl.setAttribute("aria-live", "polite");

        const cancelBtn = el(
            "button",
            { className: "is-confirm-btn cancel", type: "button" },
            "Cancel",
        );
        const deleteBtn = opts.onDelete
            ? el("button", { className: "is-confirm-btn confirm", type: "button" }, "Delete")
            : null;
        const saveBtn = el(
            "button",
            { className: "is-confirm-btn primary", type: "button" },
            "Save",
        );

        const actions = el("div", { className: "is-confirm-actions" });
        if (deleteBtn) {
            actions.append(cancelBtn, deleteBtn, saveBtn);
        } else {
            actions.append(cancelBtn, saveBtn);
        }

        dialog.append(heading, body, helper, startRow, endRow, durationRow, errorEl, actions);

        let isSaving = false;

        function cleanup(): void {
            dialog.close();
            dialog.remove();
            resolve();
        }

        function setError(message: string): void {
            errorEl.textContent = message;
            errorEl.style.display = message ? "block" : "none";
        }

        function syncDurationFromRange(): void {
            const start = parseInputValue(startInput);
            const end = parseInputValue(endInput);
            if (start === null || end === null) {
                return;
            }

            durationInput.value = formatInputValue(Math.max(0, end - start));
        }

        function syncEndFromDuration(): void {
            const start = parseInputValue(startInput);
            const duration = parseInputValue(durationInput);
            if (start === null || duration === null) {
                return;
            }

            endInput.value = formatInputValue(Math.max(0, start + duration));
        }

        function isValid(): boolean {
            const start = parseInputValue(startInput);
            const end = parseInputValue(endInput);
            const duration = parseInputValue(durationInput);
            return (
                start !== null &&
                end !== null &&
                duration !== null &&
                start >= 0 &&
                end > start &&
                duration > 0
            );
        }

        function updateButtonState(): void {
            saveBtn.disabled = isSaving || !isValid();
            if (deleteBtn) {
                deleteBtn.disabled = isSaving;
            }
        }

        function setSaving(action: "save" | "delete", value: boolean): void {
            isSaving = value;
            startInput.disabled = value;
            endInput.disabled = value;
            durationInput.disabled = value;
            cancelBtn.disabled = value;
            saveBtn.textContent = value && action === "save" ? "Saving…" : "Save";
            if (deleteBtn) {
                deleteBtn.textContent = value && action === "delete" ? "Deleting…" : "Delete";
            }
            updateButtonState();
        }

        async function handleSave(): Promise<void> {
            if (isSaving || !isValid()) {
                updateButtonState();
                return;
            }

            const start = parseInputValue(startInput);
            const end = parseInputValue(endInput);
            if (start === null || end === null) {
                setError("Please enter valid start, end, and duration values.");
                updateButtonState();
                return;
            }

            setSaving("save", true);
            setError("");

            try {
                const saved = await opts.onSave({ start, end });
                if (saved) {
                    cleanup();
                    return;
                }

                setError("Failed to save timestamp.");
            } catch {
                setError("Failed to save timestamp.");
            }

            setSaving("save", false);
        }

        async function handleDelete(): Promise<void> {
            if (isSaving || !opts.onDelete) {
                return;
            }

            const result = await confirmDialog({
                title: "Delete Timestamp",
                body: "Delete this timestamp? This cannot be undone.",
                confirmLabel: "Delete",
            });

            if (!result) {
                return;
            }

            setSaving("delete", true);
            setError("");

            try {
                const deleted = await opts.onDelete();
                if (deleted) {
                    cleanup();
                    return;
                }

                setError("Failed to delete timestamp.");
            } catch {
                setError("Failed to delete timestamp.");
            }

            setSaving("delete", false);
        }

        startInput.addEventListener("input", () => {
            syncDurationFromRange();
            updateButtonState();
        });
        endInput.addEventListener("input", () => {
            syncDurationFromRange();
            updateButtonState();
        });
        durationInput.addEventListener("input", () => {
            syncEndFromDuration();
            updateButtonState();
        });

        cancelBtn.addEventListener("click", () => cleanup());
        saveBtn.addEventListener("click", () => {
            void handleSave();
        });
        if (deleteBtn) {
            deleteBtn.addEventListener("click", () => {
                void handleDelete();
            });
        }

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
            if (event.key === "Enter" && event.target instanceof HTMLInputElement && !saveBtn.disabled) {
                event.preventDefault();
                void handleSave();
            }
        });

        document.body.append(dialog);
        updateButtonState();
        dialog.showModal();
        startInput.focus();
        startInput.select();
    });
}
