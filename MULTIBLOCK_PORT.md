# Porting GregTech's overclock math

Status of the multiblock rewrite on branch `multiblock-gt-port`. Written so this
work can be picked up in a fresh session without re-deriving anything.

## Why

`src/domain/multiblocks.ts` sorts ~145 machines into five overclock modes copied
from the wiki, and `MultiblockRecipeData.parallels` is a number the user types
in. Neither survives contact with the game: parallels follow no single formula,
some machines cap hard, others scale with voltage tier or structure blocks, and
the EBF family pays *less* EU the better its coils.

So: extract the real numbers from GregTech source at the version actually played,
ship them as generated JSON, and port GT's own `OverclockCalculator` and
`ParallelHelper` rather than approximating them.

## Where the source is

GTNH 2.8.4 ships `gregtech-5.09.51.482.jar`, and that tag exists upstream:

- source: `https://github.com/GTNewHorizons/GT5-Unofficial` tag `5.09.51.482`
- tarball: `https://codeload.github.com/GTNewHorizons/GT5-Unofficial/tar.gz/refs/tags/5.09.51.482`
- raw file: `https://raw.githubusercontent.com/GTNewHorizons/GT5-Unofficial/5.09.51.482/src/main/java/<path>`
- the local pack: `~/.local/share/PrismLauncher/instances/GT_New_Horizons_2.8.4_Java_17-25/.minecraft`
  (`GregTech.lang` for display names, `mods/gregtech-5.09.51.482.jar` for `javap`)

One repo holds every addon — gtPlusPlus, tectech, bartworks, kubatech,
goodgenerator, kekztech, gtnhlanth, ggfab, gtnhintergalactic. 2834 Java files,
~235 controllers under `**/multi*/`.

## Facts established by reading source (do not re-derive)

**The `setMaxParallelSupplier` puzzle dissolves.**
`getTrueParallel() = max(1, min(getMaxParallelRecipes(), powerPanelMaxParallel))`
— the supplier only wraps `getMaxParallelRecipes()` with an in-game user
limiter. So the ~101 controllers using the supplier have exactly one extraction
target each, and `MTEMultiBlockBase.getMaxParallelRecipes()` returns 1.

**`GTUtility.log4` is bitwise, not `Math.log`.** `log4(a)` is
`a <= 1 ? 0 : (63 - numberOfLeadingZeros(a)) >> 1`. It answers **0** at and below
1, so `tiersAbove` can never be negative. `log4ceil(a)` is
`a <= 1 ? 0 : (65 - numberOfLeadingZeros(a - 1)) >> 1`.

**Sub-tick parallels are unconditional.** `calculateMultiplierUnderOneTick()`
returns `1.0` when sub-tick is not reached, so `ParallelHelper` applies it to
every machine. There is no per-machine switch. This is the single biggest
correction to the old model: overclocks past the one-tick floor buy *parallels*,
not nothing. A 32 EU/t, 20-tick recipe on a UV hatch yields a **7x** multiplier.

**The supply model in `overclock.ts` is wrong.**
`MTEMultiBlockBase.setProcessingLogicPower`:

```java
boolean useSingleAmp = mEnergyHatches.size() == 1 && mExoticEnergyHatches.isEmpty();
logic.setAvailableVoltage(getAverageInputVoltage());              // sum of hatch voltage / hatch count
logic.setAvailableAmperage(useSingleAmp ? 1 : getMaxInputAmps()); // sum of maxWorkingAmperesIn, 2 per standard hatch
logic.setAmperageOC(true);
```

So 1x LV hatch is 32 EU/t (what we say today), but 2x LV is `32 x 4A = 128` and
4x LV is `256` — today's model says 64 and 128. Separately `getMaxInputVoltage()`
is the **sum** of hatch voltages and is what the `N x tier` parallel formulas
read: a different quantity from the overclock voltage. `MTEExtendedPowerMultiBlockBase`
uses the same pair over exotic hatches, so laser hatches fit `(tier, amps)` too.
**Multiblocks always amperage-overclock**; single blocks never touch
`ParallelHelper` at all.

**`setEuModifier`/`setSpeedBonus` (ProcessingLogic) and
`setEUtDiscount`/`setDurationModifier` (OverclockCalculator) are the same two
knobs**, forwarded by assignment in `createOverclockCalculator`, not multiplied.
A controller overriding the calculator overwrites the ProcessingLogic value.

**Coils.** `HeatingCoilLevel.getHeat() = 1 + 900 * ordinal` (None is 0), so
Cupronickel is 1801 and Eternal 13501. `getTier() = ordinal - 2`. Both are used:
the EBF reads `.getHeat()`, the Pyrolyse Oven reads `.getTier()`.

**Parallel formula families**, from `javap` over the shipped jar:
constants (Volcanus 8, Mega ABS 256, steam multis 8); `N x voltageTier`
(Industrial Centrifuge 6, Mixer 8, Packager 16, Chisel 16, Wash Plant 4, ...);
`N x structureTier` (Chemical Plant `2 * mPipeCasingTier`, Multi Autoclave
`12 * itemPipeTier`, Forge Hammer `8 * anvilTier`); runtime structure counts
(turbine assemblies, laser amps, PCB Factory upgrades);
`Configuration.Multiblocks.megaMachinesMax` (256) for every bartworks mega multi;
and ~49 controllers that never set one, the EBF included.

**Display names come from registration sites**, e.g.
`new MTEElectricBlastFurnace(ID, "multimachine.blastfurnace", "Electric Blast Furnace")`
in `gregtech/loaders/preload/LoaderMetaTileEntities.java` and the
`gtPlusPlus/xmod/gregtech/registration/**` files. Third argument is the display
name. Cross-check: 116 of our 145 current names match a `GregTech.lang` value
exactly; the other 29 need aliases.

## Done so far

| Stage | What | Commit |
|---|---|---|
| 1 | `src/domain/gt/num.ts` — Java integer semantics | `2a24a30` |
| 2 | `src/domain/gt/{overclockCalculator,parallel}.ts` — the port | `64a4f1a` |
| 3 | `src/domain/machines/{types,expr}.ts`, `src/data/{coils,gtConfig}.json` | `0b36989` |
| 4 | `src/domain/machines/{merge,catalog,customFormulas}.ts`, `src/data/gt/*`, `src/data/machines.json` | `dfa133f` |

259 tests pass; types, lint and format clean. **Nothing is wired into the app
yet** — `src/domain/overclock.ts` still runs the old heuristic, so behaviour is
unchanged.

Every expected value in the kernel tests was worked through by hand against the
Java before the code was written. Notable pinned results:

- Volcanus gets **no overclock at all**: 8,192 EU/t over a 3,119 EU/t draw is 2
  by long division and `log4(2)` is 0
- EBF at 5,400 K against an 1,800 K recipe: four 0.95 discounts, two heat
  overclocks at /4 and one regular at /2, ending at 6,256 EU/t and 18 ticks
- consumption is ceiled but duration truncated — except under `noOverclock`,
  where the duration is ceiled instead

One GT bug is reproduced rather than fixed, with a comment: in
`calculateMultiplierUnderOneTick`'s laser branch, `overclocks` inside both loops
resolves to the calculator's *field* (still 0), not the local declared after
them, so the guard is a constant.

## Still to do

| Stage | What |
|---|---|
| 5 | The extractor — `src/tools/extractMachines.test.ts` + `src/tools/gtSource/*.ts` |
| 6 | Store types and migration (`v`, `config`, `recipeHeat`, `parallelLimit`, hatch `amps`) |
| 7 | Swap `src/domain/overclock.ts` onto the port; delete `multiblocks.ts` |
| 8 | `GraphIssue` kinds and the issue panel |
| 9 | Node UI — machine parameters, recipe heat, rewritten `Calculations` |

The full plan, including the design rationale for each stage, is at
`~/.claude/plans/continuing-with-the-multilocks-declarative-turtle.md`.

### Extractor notes worth keeping

- Parse in three passes: scrub comments and string literals to same-length
  placeholders; block-extract methods by brace matching; then a recursive-descent
  mini-parser over a small Java expression subset mapped to `Expr` through a
  known-call table.
- **`setSpeedBonus`/`setEuModifier` are not always in the builder chain.** The
  Pyrolyse Oven calls `setSpeedBonus(2f / (1 + coilHeat.getTier()))` inside an
  overridden `process()`, so the whole anonymous `ProcessingLogic` subclass body
  has to be scanned.
- Expect to fail on: inherited config (walk the superclass chain), state assigned
  during `checkMachine` (`mBlockTier`, `laserAmps`, PCB Factory's `mMaxParallel`),
  runtime mode branches, lambdas other than `this::getTrueParallel`, tiered
  registration loops that build names by string concatenation, and machines from
  other mods entirely. Emit `unresolved` rather than guessing.
- The GT++ pipe and item-pipe casing ladders have no data yet. `resolveParam`
  throws for those kinds on purpose and `catalog.test.ts` asserts no machine
  declares one, so it surfaces at build time.

## Commands

```bash
pnpm test                 # vitest
pnpm types:check          # tsc -b
pnpm validate             # lint + styles + format + types
pnpm exec oxfmt src/...   # format (note: src/domain/overclock.ts has pre-existing drift on main)

# rebuild src/data/machines.json after editing raw.machines.json or overrides
CATALOG_WRITE=1 pnpm vitest run src/tools/buildCatalog.test.ts

# see how real saved graphs change (dump via tools/exportGraphs.js)
AUDIT_DUMP=/path/to/graphs.json pnpm vitest run src/tools/auditGraphs.test.ts
```

## Decisions already taken with the user

1. Full 1:1 port; the coarse `OverclockMode` heuristic goes away.
2. Machine data as generated JSON in `src/data/`, statically imported.
3. Per-node machine config fields in the UI, declared by the machine data.
4. The extractor downloads the tagged tarball on demand into a gitignored cache.
5. `EnergyHatch` gains an explicit `amps` field (default 2), with the
   `useSingleAmp` rule living in the engine.
6. Ship in stages, app green after each.

Open call, flagged for review: legacy multi nodes are planned to migrate to
`parallelLimit: parallels ?? 1`, preserving every saved graph's item quantities,
rather than letting the real machine cap take over and silently re-throughput
lines nobody touched. `auditGraphs.test.ts` can measure the alternative's blast
radius against a production dump.

## Verify against the game before trusting any of this

In rough order of how likely each is to be wrong:

1. a 1-hatch vs 2-hatch LV machine, for the `useSingleAmp` rule and 2 A per hatch
2. an EBF recipe at two coil tiers, for `0.95^n` and the 1800 K heat overclocks
3. Volcanus, for 8 parallels with the 0.9 and 1/2.2 modifiers
4. an Industrial Centrifuge at two hatch tiers, for `6 x tier`
5. a short recipe on overtiered hatches, for the sub-tick parallel multiplier

NEI gives the recipe's EU/t and duration; the machine's own GUI gives actual EU/t
and progress time.
