chrome.runtime.onInstalled.addListener((e) => {
	console.info(`[h2f] installed (${e.reason}), version 0.1.0`);
}), chrome.runtime.onMessage.addListener((e, t, n) => {
	switch (e.type) {
		case "h2f:ping": return n({
			ok: !0,
			type: "h2f:pong",
			version: "0.1.0"
		}), !1;
		case "h2f:fetch-asset": return n({
			ok: !1,
			error: "Tier-2 asset fetch is not implemented yet (P4)"
		}), !1;
		default: return !1;
	}
});
