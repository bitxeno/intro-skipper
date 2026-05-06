import { el } from "./dom.ts";

export type TimestampModeOption = {
    key: string;
    label: string;
};

export type TimestampBulkEditDialogOptions = {
    title: string;
    modes: ReadonlyArray<TimestampModeOption>;
    defaultModeKey?: string;
    onSave: (values: { modeKey: string; duration: number }) => Promise<boolean>;
};

let dialogCounter = 0;

function formatInputValue(value: number): string {
    return String(Math.round(value * 1000) / 1000);
}

function parseInputValue(input: HTMLInputElement): number | null {
    const value = Number.parseFloat(input.value);
    return Number.isFinite(value) ? value : null;
}

export function timestampBulkEditDialog(opts: TimestampBulkEditDialogOptions): Promise<void> {
    return new Promise((resolve) => {
        const uid = String(++dialogCounter);
        const titleId = "is-timestamp-bulk-title-" + uid;
        const bodyId = "is-timestamp-bulk-body-" + uid;
        const modeId = "is-timestamp-bulk-mode-" + uid;
        const durationId = "is-timestamp-bulk-duration-" + uid;

        const dialog = el("dialog", { className: "is-confirm-dialog" });
        dialog.setAttribute("aria-labelledby", titleId);
        dialog.setAttribute("aria-describedby", bodyId);

        const heading = el("h2", { id: titleId, className: "is-confirm-title" }, opts.title);
        const body = el(
            "p",
            { id: bodyId, className: "is-confirm-body" },
            "Apply one duration to every loaded episode that already has the selected timestamp type.",
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
            placeholder: "Example: 90",
        }) as HTMLInputElement;
        durationInput.value = formatInputValue(90);

        const durationRow = el("div", { className: "is-confirm-input-row" });
        durationRow.append(durationLabel, durationInput);

        const helper = el(
            "div",
            { className: "field-description" },
            "Saving adjusts each matching episode's end time to start + duration.",
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

        dialog.append(heading, body, modeRow, durationRow, helper, errorEl, actions);

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
            return modeSelect.value.length > 0 && (parseInputValue(durationInput) ?? 0) > 0;
        }

        function updateButtonState(): void {
            saveBtn.disabled = isSaving || !isValid();
        }

        function setSaving(value: boolean): void {
            isSaving = value;
            modeSelect.disabled = value;
            durationInput.disabled = value;
            cancelBtn.disabled = value;
            saveBtn.textContent = value ? "Saving…" : "Save";
            updateButtonState();
        }

        async function handleSave(): Promise<void> {
            if (isSaving || !isValid()) {
                updateButtonState();
                return;
            }

            const duration = parseInputValue(durationInput);
            if (duration === null || duration <= 0) {
                setError("Please enter a duration greater than zero.");
                updateButtonState();
                return;
            }

            setSaving(true);
            setError("");

            try {
                const saved = await opts.onSave({ modeKey: modeSelect.value, duration });
                if (saved) {
                    cleanup();
                    return;
                }

                setError("Failed to save bulk duration.");
            } catch {
                setError("Failed to save bulk duration.");
            }

            setSaving(false);
        }

        durationInput.addEventListener("input", updateButtonState);
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
