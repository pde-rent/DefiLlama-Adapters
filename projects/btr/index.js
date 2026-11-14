// BTR: oracle-priced multi-asset AMM. One protocol, one series across pool versions.
// Pools are read from the PoolFactory contracts, so a new pool or factory generation needs no change
// here beyond a new factory address. The earlier generation stays listed because its LPs keep their
// liquidity there while it winds down.
const FACTORIES = {
  monad: [
    '0xbbbbbbb16b9B5Fa94AD8CD35e696bEA55DB9C8B0', // current generation
    '0xbbbbbbbbbd5e955E20F323cA1F95f8191fD0E0BF', // first generation
  ],
}

// The pool was deployed on 2026-11-12 (block 121555891).
const hallmarks = [['2026-11-12', 'V2 launch']] // test.js requires a YYYY-MM-DD string here

const abi = {
  count: 'uint256:getOfficialPoolsCount',
  pool: 'function officialPools(uint256) view returns (address)',
  tokens: 'function getPoolTokens(address) view returns (address[])',
  hook: 'function getAssetHook(address) view returns (address target)',
  nav: 'uint256:navAssets',
  invested: 'function getInvested(address) view returns (uint128)',
}

async function getPools(api, factories) {
  const counts = await api.multiCall({ abi: abi.count, calls: factories, permitFailure: true })
  const calls = []
  factories.forEach((target, i) => {
    for (let j = 0; j < +(counts[i] || 0); j++) calls.push({ target, params: [j] })
  })
  const pools = await api.multiCall({ abi: abi.pool, calls, permitFailure: true })
  const owned = calls.map((c, i) => ({ factory: c.target, pool: pools[i] })).filter(p => p.pool)
  const tokens = await api.multiCall({
    abi: abi.tokens,
    calls: owned.map(p => ({ target: p.factory, params: [p.pool] })),
    permitFailure: true,
  })
  return owned.map((p, i) => ({ pool: p.pool, tokens: tokens[i] || [] }))
}

function tvl(chain) {
  return async (api) => {
    const pools = await getPools(api, FACTORIES[chain])
    await api.sumTokens({ ownerTokens: pools.map(p => [p.tokens, p.pool]) })

    // Liquidity a leg's yield hook placed in external venues belongs to the pool's LPs and has left
    // the pool's balance, so it is added here. The hook reports its own NAV; if it cannot, the
    // pool's book value of the invested amount is used. Hooks are per leg, so nothing overlaps
    // with the balances above.
    const legs = pools.flatMap(p => p.tokens.map(token => ({ pool: p.pool, token })))
    const hooks = await api.multiCall({
      abi: abi.hook,
      calls: legs.map(l => ({ target: l.pool, params: [l.token] })),
      permitFailure: true,
    })
    const hooked = legs
      .map((l, i) => ({ ...l, hook: hooks[i] && hooks[i].target }))
      .filter(l => l.hook && +l.hook)
    const nav = await api.multiCall({ abi: abi.nav, calls: hooked.map(l => l.hook), permitFailure: true })
    const failed = hooked.filter((_, i) => nav[i] === null || nav[i] === undefined)
    const book = await api.multiCall({
      abi: abi.invested,
      calls: failed.map(l => ({ target: l.pool, params: [l.token] })),
      permitFailure: true,
    })
    hooked.forEach((l, i) => {
      if (nav[i] !== null && nav[i] !== undefined) api.add(l.token, nav[i])
    })
    failed.forEach((l, i) => book[i] && api.add(l.token, book[i]))
  }
}

module.exports = {
  doublecounted: true,
  methodology:
    "Sums the token balances held by every BTR pool registered as official in the BTR pool factories, plus the liquidity each asset's yield hook has deposited in external lending markets or vaults on the pool's behalf, valued at the hook's reported net asset value (or the pool's book value of it if the hook cannot report). That deposited liquidity is also counted in those venues' TVL.",
  start: '2026-10-01',
  hallmarks,
  monad: { tvl: tvl('monad') },
}
