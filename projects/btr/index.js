// BTR pool v2, Monad (143). One protocol, one series: the pool changed, the listing did not.
// POOLS, newest first. Pool addresses are CREATE3-deterministic; a pool becomes "official" on the
// factory only after a later branding step, so the pool itself is listed rather than the factory.
const POOLS = [
  '0xbbbbbbbd7060b1CED79c381eAD40d73FcB9Ae0C6', // v2 pool (dex-evm deployments/143-v2.pools.json `stable`)
  '0xbbbbbbb04f5b762a4cdd1d89e341e2537e3267e4', // HISTORY ONLY: retired v1 pool, keeps pre-v2 days resolving (same code path, no v1 logic)
]

// Unix time of 2026-11-13 00:00:00 UTC. Replaced by the block time of the first v2 ramp deposit before submission.
const V2_LAUNCH_TS = 1794528000

async function tvl(api) {
  // a pool with no code at this block (v2 before launch) fails its call and is skipped
  const legs = await api.multiCall({ abi: 'address[]:getLegs', calls: POOLS, permitFailure: true })
  const live = POOLS.map((pool, i) => ({ pool, tokens: legs[i] })).filter(p => p.tokens)
  await api.sumTokens({ ownerTokens: live.map(p => [p.tokens, p.pool]) })
  // liquidity a leg's yield hook placed in external venues belongs to the pool's LPs and has left the
  // pool's balance: count the hook NAV (hooks are per leg, so no overlap with the balances above)
  const rows = live.flatMap(p => p.tokens.map(token => ({ pool: p.pool, token })))
  const hooks = await api.multiCall({ abi: 'function getAssetHook(address) view returns (address target)', calls: rows.map(r => ({ target: r.pool, params: [r.token] })) })
  const hooked = rows.map((r, i) => ({ ...r, hook: hooks[i].target })).filter(r => +r.hook)
  const nav = await api.multiCall({ abi: 'uint256:navAssets', calls: hooked.map(r => r.hook) })
  hooked.forEach((r, i) => api.add(r.token, nav[i]))
}

module.exports = {
  doublecounted: true,
  methodology: "Sums the token balances held by the BTR pool for every leg it lists (legs read from the pool's getLegs), plus the liquidity each leg's yield hook has deposited in external lending markets or vaults on the pool's behalf, valued at the hook's reported NAV. That liquidity is also counted in those venues' TVL.",
  start: '2026-10-01',
  hallmarks: [[new Date(V2_LAUNCH_TS * 1000).toISOString().slice(0, 10), 'V2 launch']], // test.js requires a YYYY-MM-DD string here
  monad: { tvl },
}
