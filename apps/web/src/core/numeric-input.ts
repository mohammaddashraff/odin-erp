import { useEffect, type FormEvent } from "react";
import {
  normalizeWesternDigits,
  normalizeWesternNumberInput,
} from "./formatters";

export function normalizeWesternInputCapture(event: FormEvent<HTMLElement>) {
  const target = event.target;
  if (
    !(
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    )
  )
    return;
  const numeric = target.matches(
    'input[type="number"], input[type="tel"], input[inputmode="numeric"], input[inputmode="decimal"]',
  );
  const normalized = numeric
    ? normalizeWesternNumberInput(target.value)
    : normalizeWesternDigits(target.value);
  if (normalized === target.value) return;
  const selectionStart = target.selectionStart;
  const selectionEnd = target.selectionEnd;
  // Preserve React's previous-value tracker so its bubbling onChange sees
  // this edit after the capture phase and updates controlled state/dirty guards.
  const prototype =
    target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
    target,
    normalized,
  );
  if (selectionStart !== null && selectionEnd !== null)
    target.setSelectionRange(selectionStart, selectionEnd);
}

const westernInputLocaleSelector = [
  'input[type="number"]',
  'input[type="date"]',
  'input[type="datetime-local"]',
  'input[type="month"]',
  'input[type="week"]',
  'input[type="time"]',
  'input[type="tel"]',
  'input[inputmode="numeric"]',
  'input[inputmode="decimal"]',
  'input[inputmode="tel"]',
].join(",");

/**
 * Native numeric and date controls inherit the document language, so an
 * Arabic page can otherwise paint Arabic-Indic glyphs inside browser chrome.
 * Apply an English/LTR locale boundary to the controls themselves while their
 * labels and surrounding form continue to inherit the application's RTL flow.
 * The observer covers drawers and dialogs mounted after the initial render.
 */
export function useWesternInputLocaleBoundary() {
  useEffect(() => {
    const apply = (root: ParentNode) => {
      const controls: HTMLInputElement[] = [];
      if (
        root instanceof HTMLInputElement &&
        root.matches(westernInputLocaleSelector)
      )
        controls.push(root);
      controls.push(
        ...root.querySelectorAll<HTMLInputElement>(westernInputLocaleSelector),
      );
      for (const control of controls) {
        control.lang = "en";
        control.dir = "ltr";
      }
    };

    apply(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes)
          if (node instanceof Element) apply(node);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}

// API decimal strings use Western digits without display grouping. Only known
// numeric payload fields are normalized; identifiers, notes and references stay
// untouched, and invalid grouping is left for the existing server validation.
const numericPayloadFields = new Set([
  "creditLimit",
  "purchasePrice",
  "salePrice",
  "taxRatePercent",
  "reorderLevel",
  "quantity",
  "unitPrice",
  "discount",
  "exchangeRate",
  "amount",
  "debit",
  "credit",
  "openingCash",
  "actualCash",
  "openingBalance",
  "closingBalance",
]);
export function canonicalNumericPayload(body: string): string {
  return JSON.stringify(JSON.parse(body), (key, value) => {
    if (!numericPayloadFields.has(key) || typeof value !== "string")
      return value;
    const normalized = normalizeWesternNumberInput(value).trim();
    return /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(normalized)
      ? normalized.replaceAll(",", "")
      : value;
  });
}
