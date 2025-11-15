import { el } from "./dom.ts";

export type TheIntroDbSubmitDialogOptions = {
    title: string;
    body: string;
    confirmLabel?: string;
    cancelLabel?: string;
    apiKey?: string;
    rememberApiKey?: boolean;
};

export type TheIntroDbSubmitDialogResult = {
    apiKey: string;
    rememberApiKey: boolean;
};

let dialogCounter = 0;

export function theIntroDbSubmitDialog(
    opts: TheIntroDbSubmitDialogOptions,
): Promise<TheIntroDbSubmitDialogResult | null> {
    return new Promise((resolve) => {
        const uid = String(++dialogCounter);
        const titleId = "is-confirm-title-" + uid;
        const bodyId = "is-confirm-body-" + uid;
        const apiKeyId = "is-confirm-apikey-" + uid;
        const rememberId = "is-confirm-remember-" + uid;

        const dialog = el("dialog", { className: "is-confirm-dialog" });
        dialog.setAttribute("aria-labelledby", titleId);
        dialog.setAttribute("aria-describedby", bodyId);

        const heading = el("h2", { id: titleId, className: "is-confirm-title" }, opts.title);
        const body = el("p", { id: bodyId, className: "is-confirm-body" }, opts.body);

        const inputLabel = el(
            "label",
            { className: "is-confirm-input-label", for: apiKeyId },
            "TheIntroDB API Key",
        );
        const input = el("input", {
            id: apiKeyId,
            className: "is-confirm-input",
            type: "password",
            autocomplete: "off",
            spellcheck: "false",
            placeholder: "Paste your TheIntroDB API key",
        }) as HTMLInputElement;
        input.value = opts.apiKey ?? "";

        const inputRow = el("div", { className: "is-confirm-input-row" });
        inputRow.append(inputLabel, input);

        const remember = el("input", {
            type: "checkbox",
            id: rememberId,
        }) as HTMLInputElement;
        remember.checked = opts.rememberApiKey ?? false;

        const rememberLabel = el(
            "label",
            { className: "is-confirm-checkbox-label", for: rememberId },
        );
        rememberLabel.append(
            remember,
            document.createTextNode(" Remember this API key in this browser"),
        );

        const rememberRow = el("div", { className: "is-confirm-checkbox-row" });
        rememberRow.append(rememberLabel);

        const cancelBtn = el(
            "button",
            { className: "is-confirm-btn cancel", type: "button" },
            opts.cancelLabel ?? "Cancel",
        );
        const confirmBtn = el(
            "button",
            { className: "is-confirm-btn confirm", type: "button" },
            opts.confirmLabel ?? "Submit",
        );

        const actions = el("div", { className: "is-confirm-actions" });
        actions.append(cancelBtn, confirmBtn);

        dialog.append(heading, body, inputRow, rememberRow, actions);

        function syncConfirmState(): void {
            confirmBtn.disabled = input.value.trim().length === 0;
        }

        function cleanup(result: TheIntroDbSubmitDialogResult | null): void {
            dialog.close();
            dialog.remove();
            resolve(result);
        }

        cancelBtn.addEventListener("click", () => cleanup(null));
        confirmBtn.addEventListener("click", () => {
            const apiKey = input.value.trim();
            if (!apiKey) {
                return;
            }

            cleanup({
                apiKey,
                rememberApiKey: remember.checked,
            });
        });
        input.addEventListener("input", syncConfirmState);
        dialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            cleanup(null);
        });
        dialog.addEventListener("click", (event) => {
            if (event.target === dialog) {
                cleanup(null);
            }
        });

        document.body.append(dialog);
        syncConfirmState();
        dialog.showModal();
        input.focus();
        input.select();
    });
}
