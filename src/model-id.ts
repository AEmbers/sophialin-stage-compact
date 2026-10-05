/** Candidate spellings of a model id, most specific first.
 *
 *  Relays, launchers and namespacing hosts hand the proxy ids that carry
 *  their own decoration around an otherwise well-known model name:
 *
 *  - a relay/vLLM deployment serves "meta-llama/Llama-4" while models.dev
 *    lists it under another provider prefix (#736) — the bare basename after
 *    the last "/" must be tried;
 *  - a host that namespaces its upstreams sends "cn:deepseek-v4.1-flash" for
 *    a model every table knows as "deepseek-v4.1-flash" (#window-namespace).
 *
 *  Both spellings miss every ^-anchored family pattern (CONTEXT_LIMIT_TABLE)
 *  and every registry key, so the window lookup fell through to the generic
 *  200k env default — which the nudge threshold then reports as the effective
 *  window (200k x 0.75 = 150k), silently budgeting a 1M-window session against
 *  150k and stranding it in the preflight fail-fast loop.
 *
 *  The full id always keeps precedence, so a genuinely listed prefixed id
 *  still wins over its stripped forms. */
export function modelRoots(model: string): string[] {
    const roots: string[] = [model];
    // Namespace form "<ns>:<model>" (also covers Ollama-style "<model>:<tag>",
    // where the tag simply matches nothing).
    const colon = model.lastIndexOf(":");
    if (colon > 0 && colon < model.length - 1) roots.push(model.slice(colon + 1));
    // Relay form "<prefix>/<name>", tried for the full id and for the
    // namespace-stripped one ("openrouter:google/gemini-2.5" -> "gemini-2.5").
    for (const root of [...roots]) {
        const slash = root.lastIndexOf("/");
        if (slash > 0 && slash < root.length - 1) roots.push(root.slice(slash + 1));
    }
    return [...new Set(roots)];
}
