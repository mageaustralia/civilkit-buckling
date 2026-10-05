/* Undo and redo: a bounded list of committed states. push(state) stores the state AFTER each
   committed edit; undo() hands back the one before it, redo() the one after. Everything is
   copied in and out, so neither the caller's later mutations nor the caller mutating what it was
   handed can rewrite the past. limit counts states, the one on screen included. */
export function createHistory(limit = 50) {
  const past = [], future = [];
  let cur = null;
  return {
    push(state) {
      if (cur !== null) { past.push(cur); if (past.length > limit - 1) past.shift(); }
      cur = structuredClone(state);
      future.length = 0;
    },
    undo() { if (!past.length) return null; future.push(cur); cur = past.pop(); return structuredClone(cur); },
    redo() { if (!future.length) return null; past.push(cur); cur = future.pop(); return structuredClone(cur); },
    get current() { return cur === null ? null : structuredClone(cur); },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
  };
}
