/** Let Next copy its router markers while retaining our entry-local UI state.
 * Passing __NA back to its patched History API skips search-parameter updates.
 * Search text stays in this browser history entry, outside URLs/localStorage.
 */
export function listHistory(url:string,mode:'replace'|'push'='replace',extra:Record<string,unknown>={}) {
 const {__NA,_N,__PRIVATE_NEXTJS_INTERNALS_TREE,...custom}=window.history.state||{};
 window.history[mode==='push'?'pushState':'replaceState']({...custom,...extra},'',url);
}
