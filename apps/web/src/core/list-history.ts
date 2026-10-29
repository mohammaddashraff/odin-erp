/** Let Next copy its router markers while retaining our entry-local UI state.
 * Passing __NA back to its patched History API skips search-parameter updates.
 * Search text stays in this browser history entry, outside URLs/localStorage.
 */
export function listHistory(
  url: string,
  mode: "replace" | "push" = "replace",
  extra: Record<string, unknown> = {},
) {
  const custom = { ...(window.history.state || {}) } as Record<string, unknown>;
  delete custom.__NA;
  delete custom._N;
  delete custom.__PRIVATE_NEXTJS_INTERNALS_TREE;
  const method = mode === "push" ? "pushState" : "replaceState";
  window.history[method]({ ...custom, ...extra }, "", url);
}
