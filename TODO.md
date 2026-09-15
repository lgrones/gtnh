# TODO

## Derive multiblock parallels from hatch and bus sizes

**Status:** idea only — needs in-game confirmation before building.

### The problem

`MultiblockRecipeData.parallels` is hand-entered and defaults to 1. That default is
wrong for any machine that actually parallelizes, and there is no data source to
seed a better one — the wiki tabulates no per-machine maximum (Volcanus's 8 appears
only inside a worked example).

Worse, the field reads like a choice. In game it is not: a multiblock runs as many
parallels as its inputs and power allow. If a pipe refills the hatch before the
current cycle ends, the next recipes run concurrently whether or not that was the
plan. The only way to run fewer is to deliberately starve the input, which nobody
does. So the planner should be deriving this number, not asking for it.

### The idea

Model the machine's INPUT buses and hatches, and compute the parallel count from
their capacity against the recipe's per-run input amounts, instead of asking the
user for a figure they have to look up elsewhere.

Note these are not the energy hatches already modelled on `MultiblockRecipeData`.
Those describe how the machine is POWERED and are what the overclock math reads;
this idea is about what FEEDS it items and fluids. Both are "hatches" in game.

Roughly:

```
parallels = min(
  floor(input capacity / recipe input per run),   // new — from hatch/bus config
  floor(supplied EU/t / recipe EU/t),             // already implemented
  machine cap,                                    // if such a cap exists, see below
)
```

The power bound already exists in `parallelCount` in [src/domain/overclock.ts](src/domain/overclock.ts);
this would add the input bound alongside it and drop the hand-entered field.

### To confirm in game first

- Is the parallel count really bounded by bus/hatch capacity, or does each machine
  carry its own cap independent of inputs? Possibly both, whichever is lower.
- If there is a per-machine cap, what drives it — tier, upgrades, structure size?
  That would need per-machine data the wiki does not currently tabulate.
- Does "bus size" mean slot count, stack size per slot, or the product?
- Do fluid hatches bound parallels differently from item buses?
- How do stocking buses, crafting input buses and proxies change the picture?
- Does anything change when the recipe has multiple distinct inputs of differing
  quantities — presumably the tightest one binds.

### Notes

- Batch mode is a separate mechanic and must not be conflated: more recipes per
  iteration at the _same_ EU/t over a _longer_ duration, for TPS only. It does not
  raise throughput. Parallels raise EU/t and throughput at the same duration.
- Calculation order is fixed by the wiki and already implemented: energy discount,
  then parallels, then overclocks — `EU/t = Base x Discount x Parallels x 4^OC`.
  Parallels are paid for first and routinely consume the headroom an overclock
  would have used. That is a gain, not a loss: parallels are energy-neutral while
  an imperfect overclock doubles total energy per step.
- The entered count is now a hard ceiling: `overclock` never derives parallels from
  spare power. It used to spend overclock steps past the 1 tick floor on doubling
  them, which invented throughput nothing was feeding — a ULV recipe on a UV hatch
  reported 4 parallels from an entered 1. Those steps are `surplus` now and raise
  `throttled`, which is the honest answer until the input bound below exists.
- When the input bound lands, `offeredParallels` and the `overparallel` issue both
  go away with the hand-entered field: no user figure left to be wrong about, and
  `throttled` becomes the only parallel-related issue.
- Touch points when this gets built: `parallelCount` and the `Overclock` interface
  in [src/domain/overclock.ts](src/domain/overclock.ts) — the interface carries a
  single running `parallels` count, the old `parallelSteps` and `machineParallels`
  having gone with the derived path — `MultiblockRecipeData` in
  [src/contexts/productionStore/types.ts](src/contexts/productionStore/types.ts),
  the machine row in
  [src/components/production/nodes/recipeNode.tsx](src/components/production/nodes/recipeNode.tsx),
  and `overclockIssues` in
  [src/contexts/productionStore/helpers.ts](src/contexts/productionStore/helpers.ts).

### Meanwhile

Two smaller tweaks, not yet done, that would help until the above lands:

- ~~Relabel the field to `Max Parallel` and say in the tooltip that parallels fill
  automatically from available inputs, so it does not read as a free choice.~~
  Done — the `P` unit tooltip now says it is a ceiling, not a target.
- Possibly flag a multiblock left at 1 parallel in the issue panel — though that
  would be noise for the many multiblocks that genuinely have none.
