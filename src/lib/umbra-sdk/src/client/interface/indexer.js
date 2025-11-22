/**
 * Abstract interface for fetching on-chain indexing data required by Umbra clients.
 *
 * @remarks
 * Concrete implementations typically query an indexing service (or RPC) to provide
 * Merkle tree data that is too expensive to recompute client-side. Methods on this
 * interface are intentionally minimal so different environments (browser, node,
 * server, etc.) can supply their own transport + caching layers.
 */
export class IIndexer {
}
