// `fetch` reports every transport problem as "TypeError: fetch failed" and hides
// the real reason — DNS, refused, timed out, unreachable — in a nested `cause`,
// often with an empty message. Node also wraps dual-stack (IPv6 + IPv4) attempts
// in an AggregateError whose own message is blank. This unwraps all of it.
export function describeNetworkError(err) {
    const parts = [];
    const seen = new Set();

    const walk = (e, depth) => {
        if (!e || typeof e !== 'object' || depth > 4 || seen.has(e)) return;
        seen.add(e);

        const bits = [
            e.name,
            e.code,                                   // ENOTFOUND, ECONNREFUSED, EAI_AGAIN, …
            e.errno !== undefined ? `errno ${e.errno}` : null,
            e.syscall,                                // getaddrinfo, connect, …
            [e.hostname, e.address, e.port].filter(Boolean).join(':') || null,
            e.message && e.message !== e.name ? e.message : null,
        ].filter(Boolean);
        if (bits.length) parts.push(bits.join(' '));

        // AggregateError: one entry per address family tried.
        if (Array.isArray(e.errors)) e.errors.forEach((sub) => walk(sub, depth + 1));
        walk(e.cause, depth + 1);
    };

    walk(err, 0);
    return parts.length ? parts.join(' <- ') : String(err?.message || err);
}
