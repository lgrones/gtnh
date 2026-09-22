# TODO

## Bound multiblock parallels by what the input buses can feed

**Status:** the seam exists and nothing passes through it. Needs in-game
measurement before building.

### What the GregTech port already settled

Most of what this entry used to ask has been answered by reading GT source at
`5.09.51.482` rather than the wiki — see `MULTIBLOCK_PORT.md`.

- **A per-machine cap is real, and it is now data.** `ParallelHelper` takes the
  minimum of the controller's own cap, what the power pays for, and an input
  bound. The caps are extracted per machine into `src/data/machines.json`:
  constants, `N x voltageTier`, `N x structureTier`, runtime structure counts,
  and the 144 controllers that never set one and therefore run at 1.
- **The hand-entered `parallels` field is gone**, and with it `parallelCount`,
  `offeredParallels` and `surplus`. `parallelLimit` replaces it as an explicit
  opt-in ceiling, absent by default.
- **Overclocks past the one-tick floor are not waste.** They multiply the
  machine's cap, unconditionally, for every machine
  (`calculateMultiplierUnderOneTick`). The old note here claiming they "invented
  throughput nothing was feeding" was wrong about the game.
- **The wiki's calculation order was wrong too.** GT resolves the machine, takes
  the sub-tick multiplier from a one-parallel calculator, lets `ParallelHelper`
  decide how many recipes run, and only then overclocks against that count.

### What is left

`determineParallel` in [src/domain/gt/parallel.ts](src/domain/gt/parallel.ts)
takes an optional `inputLimit`, clamps on it, and reports `limitedBy: 'input'`.
Nothing passes it. Filling it in means modelling the machine's **input** buses
and hatches — not the energy hatches on `MultiblockRecipeData`, which describe
how it is powered — and computing capacity against the recipe's per-run amounts.

When that lands, the node gains an input-bus shape and `inputLimit` is computed
from it; `parallelLimit` can stay as the manual override or go, depending on
whether the derived figure turns out to be trustworthy.

### To confirm in game first

- Does "bus size" mean slot count, stack size per slot, or the product?
- Do fluid hatches bound parallels differently from item buses?
- How do stocking buses, crafting input buses and proxies change the picture?
- With several distinct inputs of differing quantities, does the tightest bind?

### Still true

Batch mode is a separate mechanic and must not be conflated: more recipes per
iteration at the _same_ EU/t over a _longer_ duration, for TPS only. It does not
raise throughput, which is why the port leaves it out along with output limits
and void protection.

## Verify the ported numbers against a running pack

The overclock ladder and the EBF heat matrix are done, without a pack: GTNH
Factory Flow publishes a dataset whose per-tier figures come from
`gregtech.api.util.OverclockCalculator` running inside a headless GTNH client,
and `src/domain/gt/oracleOverclock.test.ts` replays 2,470 rows of it against the
port. All agree. See "Checked against the oracle" in `MULTIBLOCK_PORT.md`.

What that dataset cannot answer is anything about parallels — every figure in it
runs at one parallel — so the rest of the list still wants a pack. The supply
model (2 A per hatch, 1 A when there is exactly one) is first, because it changes
the power figure on every saved multiblock.
