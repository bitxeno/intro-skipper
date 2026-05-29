import { el } from "./dom.ts";

export type TimestampModeOption = {
    key: string;
    label: string;
};

export type TimestampBulkAddDialogOptions = {
    title: string;
    modes: ReadonlyArray<TimestampModeOption>;
    defaultModeKey?: string;
    onSave: (values: { modeKey: string; start: number; end: number }) => Promise<boolean>;
};

let dialogCounter = 0;

function formatInputValue(value: number): string {
    return String(Math.round(value * 1000) / 1000);
}

function parseInputValue(input: HTMLInputElement): number | null {
    const value = Number.parseFloat(input.value);
    return Number.isFinite(value) ? value : null;
}

export function timestampBulkAddDialog(opts: TimestampBulkAddDialogOptions): Promise<void> {
    return new Promise((resolve) => {
        const uid = String(++dialogCounter);
        const titleId = "is-timestamp-bulk-add-title-" + uid;
        const bodyId = "is-timestamp-bulk-add-body-" + uid;
        const modeId = "is-timestamp-bulk-add-mode-" + uid;
        const startId = "is-timestamp-bulk-add-start-" + uid;
        const endId = "is-timestamp-bulk-add-end-" + uid;

        const dialog = el("dialog", { className: "is-confirm-dialog" });
        dialog.setAttribute("aria-labelledby", titleId);
        dialog.setAttribute("aria-describedby", bodyId);

        const heading = el("h2", { id: titleId, className: "is-confirm-title" }, opts.title);
        const body = el(
            "p",
            { id: bodyId, className: "is-confirm-body" },
            "Set the start and end time for the chosen timestamp type on all selected episodes.",
        );

        const modeLabel = el(
            "label",
            { className: "is-confirm-input-label", for: modeId },
            "Timestamp type",
        );
        const modeSelect = el("select", {
            id: modeId,
            className: "is-confirm-input",
        }) as HTMLSelectElement;
        for (const mode of opts.modes) {
            modeSelect.append(el("option", { value: mode.key }, mode.label));
        }
        if (opts.defaultModeKey) {
            modeSelect.value = opts.defaultModeKey;
        }

        const modeRow = el("div", { className: "is-confirm-input-row" });
        modeRow.append(modeLabel, modeSelect);

        const startLabel = el(
            "label",
            { className: "is-confirm-input-label", for: startId },
            "Start time (seconds)",
        );
        const startInput = el("input", {
            id: startId,
            className: "is-confirm-input",
            type: "number",
            min: "0",
            step: "0.001",
            inputmode: "decimal",
            placeholder: "Example: 0",
        }) as HTMLInputElement;
        startInput.value = formatInputValue(0);

        const startRow = el("div", { className: "is-confirm-input-row" });
        startRow.append(startLabel, startInput);

        const endLabel = el(
            "label",
            { className: "is-confirm-input-label", for: endId },
            "End time (seconds)",
        );
        const endInput = el("input", {
            id: endId,
            className: "is-confirm-input",
            type: "number",
            min: "0",
            step: "0.001",
            inputmode: "decimal",
            placeholder: "Example: 90",
        }) as HTMLInputElement;
        endInput.value = formatInputValue(90);

        const endRow = el("div", { className: "is-confirm-input-row" });
        endRow.append(endLabel, endInput);

        const helper = el(
            "div",
            { className: "field-description" },
            "Setting start and end will create or update the chosen timestamp type on all selected episodes.",
        );

        const errorEl = el("div", { className: "field-error" });
        errorEl.setAttribute("aria-live", "polite");

        const cancelBtn = el(
            "button",
            { className: "is-confirm-btn cancel", type: "button" },
            "Cancel",
        );
        const saveBtn = el(
            "button",
            { className: "is-confirm-btn primary", type: "button" },
            "Save",
        );

        const actions = el("div", { className: "is-confirm-actions" });
        actions.append(cancelBtn, saveBtn);

        dialog.append(heading, body, modeRow, startRow, endRow, helper, errorEl, actions);

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

        function isValid(): boolean {
            return (
                modeSelect.value.length > 0 &&
                (parseInputValue(startInput) ?? 0) >= 0 &&
                (parseInputValue(endInput) ?? 0) > 0
            );
        }

        function updateButtonState(): void {
            saveBtn.disabled = isSaving || !isValid();
        }

        function setSaving(value: boolean): void {
            isSaving = value;
            modeSelect.disabled = value;
            startInput.disabled = value;
            endInput.disabled = value;
            cancelBtn.disabled = value;
            saveBtn.textContent = value ? "Saving\u2026" : "Save";
            updateButtonState();
        }

        async function handleSave(): Promise<void> {
            if (isSaving || !isValid()) {
                updateButtonState();
                return;
            }

            const start = parseInputValue(startInput);
            const end = parseInputValue(endInput);
            if (start === null || start < 0) {
                setError("Please enter a valid start time.");
                updateButtonState();
                return;
            }
            if (end === null || end <= 0) {
                setError("Please enter a valid end time greater than zero.");
                updateButtonState();
                return;
            }
            if (end <= start) {
                setError("End time must be greater than start time.");
                updateButtonState();
                return;
            }

            setSaving(true);
            setError("");

            try {
                const saved = await opts.onSave({ modeKey: modeSelect.value, start, end });
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

        startInput.addEventListener("input", updateButtonState);
        endInput.addEventListener("input", updateButtonState);
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
            if (event.key === "Enter" && event.target instanceof HTMLInputElement && !saveBtn.disabled) {
                event.preventDefault();
                void handleSave();
            }
        });

        document.body.append(dialog);
        updateButtonState();
        dialog.showModal();
        modeSelect.focus();
    });
}
