export type TransportChoice = "DIRECT" | "STORAGE";
export function selectTransport(peerCount: number, maxDirectPeers: number, directSupported = true): TransportChoice { return directSupported && peerCount > 0 && peerCount <= maxDirectPeers ? "DIRECT" : "STORAGE"; }
