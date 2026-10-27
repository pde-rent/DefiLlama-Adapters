// both PoolFactory generations: the first pool keeps its LPs' liquidity while it winds down
const FACTORIES = [
  '0xbbbbbbbbbd5e955E20F323cA1F95f8191fD0E0BF',
  '0xbbbbbbb16b9B5Fa94AD8CD35e696bEA55DB9C8B0',
]

async function officialPools(api, target) {
  const pools = await api.fetchList({ lengthAbi: 'getOfficialPoolsCount', itemAbi: 'officialPools', target })
  const tokens = await api.multiCall({ target, abi: 'function getPoolTokens(address pool) view returns (address[])', calls: pools })
  return pools.map((pool, i) => ({ pool, tokens: tokens[i] }))
}

async function tvl(api) {
  const all = (await Promise.all(FACTORIES.map(f => officialPools(api, f)))).flat()
  await api.sumTokens({ ownerTokens: all.map(p => [p.tokens, p.pool]) })
  // liquidity a pool's yield hook placed in external venues belongs to its LPs: count the hook NAV
  const legs = all.flatMap(p => p.tokens.map(token => ({ pool: p.pool, token })))
  const hooks = await api.multiCall({ abi: 'function getAssetHook(address) view returns (address target, uint32 flags, uint32 lastCreditAt)', calls: legs.map(l => ({ target: l.pool, params: [l.token] })) })
  const live = legs.map((l, i) => ({ ...l, hook: hooks[i].target })).filter(l => +l.hook)
  const nav = await api.multiCall({ abi: 'uint256:navAssets', calls: live.map(l => l.hook), permitFailure: true })
  const book = await api.multiCall({ abi: 'function getInvested(address) view returns (uint128)', calls: live.map(l => ({ target: l.pool, params: [l.token] })) })
  live.forEach((l, i) => api.add(l.token, nav[i] ?? book[i]))
}

module.exports = {
  doublecounted: true,
  methodology: "Sums the token balances held by every official BTR pool listed by either PoolFactory generation, plus the liquidity each pool's yield hook has deposited in external lending markets or vaults (currently Aave and Euler) on the pool's behalf, valued at the hook's reported NAV. That liquidity is also counted in those venues' TVL.",
  start: '2026-10-01',
  monad: { tvl },
}
