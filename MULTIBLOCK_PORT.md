# Porting GregTech's overclock math

Status of the multiblock rewrite on branch `multiblock-gt-port`. Written so this
work can be picked up in a fresh session without re-deriving anything.

## Why

`src/domain/multiblocks.ts` sorted ~145 machines into five overclock modes
copied from the wiki, and `MultiblockRecipeData.parallels` was a number the user
typed in. Neither survived contact with the game: parallels follow no single formula,
some machines cap hard, others scale with voltage tier or structure blocks, and
the EBF family pays _less_ EU the better its coils.

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
correction to the old model: overclocks past the one-tick floor buy _parallels_,
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
and 144 controllers that never set one and therefore run at 1 parallel, the EBF
included. (The plan's estimate of ~49 was low: many controllers call
`setMaxParallelSupplier(this::getTrueParallel)` without overriding
`getMaxParallelRecipes()`, which resolves to the base class's `return 1`.)

**Display names come from registration sites**, e.g.
`new MTEElectricBlastFurnace(ID, "multimachine.blastfurnace", "Electric Blast Furnace")`
in `gregtech/loaders/preload/LoaderMetaTileEntities.java` and the
`gtPlusPlus/xmod/gregtech/registration/**` files. Third argument is the display
name — for gregtech. The addons pass a translation key instead, and the lang
files that resolve it **ship in the checkout** at
`src/main/resources/assets/*/lang/en_US.lang`, so no game install is needed.
Registration is also sometimes on a nested class
(`new MTEVoidMiners.VMUV(…)`). With all three handled, 194 of 214 controllers
name themselves from a registration site, 19 from a lang file, and one
(`MTEBaseModule`, a godforge base) from nothing.

**Every controller is a subclass of `MTEMultiBlockBase`**, gregtech's own and
all ten addons'. So the machine list is not curated: it is whatever that class
graph holds — 244 subclasses, 214 of them concrete.

## Done so far

| Stage | What                                                                                                                   | Commit    |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | --------- |
| 1     | `src/domain/gt/num.ts` — Java integer semantics                                                                        | `2a24a30` |
| 2     | `src/domain/gt/{overclockCalculator,parallel}.ts` — the port                                                           | `64a4f1a` |
| 3     | `src/domain/machines/{types,expr}.ts`, `src/data/{coils,gtConfig}.json`                                                | `0b36989` |
| 4     | `src/domain/machines/{merge,catalog,customFormulas}.ts`, `src/data/gt/*`, `src/data/machines.json`                     | `dfa133f` |
| 5     | `src/tools/gtSource/*.ts` + `src/tools/extractMachines.test.ts`; `src/data/gt/{raw.machines,aliases}.json` regenerated | `80089a7` |
| 6 + 7 | store types and migration; `src/domain/overclock.ts` swapped onto the port and `multiblocks.ts` deleted                | `3c7bc19` |
| 8     | `GraphIssue` gains `underheated`; the overclock kinds re-aimed at the kernel's answers                                 | `56c3772` |
| 9     | node UI — machine parameters, recipe heat, rewritten `Calculations`                                                    | `a765c69` |

**All nine stages are in.** 338 tests pass, `pnpm validate` and `pnpm build` are
clean, and the app was driven in a browser against the Firebase emulators to
confirm the node renders (see "Checked in the app", below). The overclock ladder
and the EBF heat matrix have since been checked against GregTech's own figures
(see "Checked against the oracle"); what remains is the parallel and
hatch-supply half, against a running pack.

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
resolves to the calculator's _field_ (still 0), not the local declared after
them, so the guard is a constant.

## Stage 5 — what the extractor is, and what it found

`src/tools/gtSource/` is six modules, each testable on its own:

| File                 | Does                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `source.ts`          | fetch the tagged tarball into `.gt-cache/`, unpack with `tar`, walk `src/main/java`                       |
| `scrub.ts`           | blank comments and literal contents to same-length filler; bracket matching and argument splitting on top |
| `classes.ts`         | class graph, method bodies, anonymous-subclass bodies, `static final` constants, field assignments        |
| `javaExpr.ts`        | recursive-descent parser for the Java subset GT's formulas use                                            |
| `mapExpr.ts`         | that tree to the catalog's `Expr`, declaring machine parameters as a side effect                          |
| `lang.ts`            | display names from the checkout's `.lang` files                                                           |
| `structureParams.ts` | the hint table for state assigned during `checkMachine`                                                   |
| `extract.ts`         | orchestrates the above into one `Machine` per controller                                                  |
| `report.ts`          | the coverage report                                                                                       |

`scrub`, `javaExpr`, `mapExpr`, `classes` and `lang` have unit tests that run in
an ordinary `pnpm test` (64 of them). Every case in them is copied from real
5.09.51.482 source, and the "refuses" cases matter as much as the passes: the
extractor's contract is that it reports what it cannot read.

**Results at 5.09.51.482**: 214 controllers — 172 `modelled`, 19 `partial`, 23
`unknown`. Parallel models: 144 `none` (GT's default of 1), 32 `formula`, 15
`constant`, 23 `unknown`. 7 machines declare a coil parameter and 5 a `count`.
63 things could not be read, across 38 machines, each listed in the report with
its Java, its file and line, and its reason.

Spot-checked against the hand-worked stage-4 seeds and they agree: the EBF's
`coil heat + 100 * (tier - 2)`, Volcanus at 8 parallels with 0.9 and 1/2.2, the
LCR's perfect overclock, `6 * tier` for the Industrial Centrifuge, the Pyrolyse
Oven's `2 / (1 + coil tier)` (which lives inside an overridden `process()`, not
the builder chain), and the Chemical Plant's `2 * pipeCasingTier`.

What stays unresolved is what the plan predicted, and each machine's `notes`
says so in words the node UI can show: runtime mode branches (Dangote Distillus,
Matter Fabrication CPU), structure counts with no bounds in source (the XL
turbines' `getFullTurbineAssemblies().size()`), laser amperage, and fields
assigned inside a `&&` chain during `checkMachine` (Zyngen's
`mLevel = getCoilLevel().getTier() + 1`). Resolving more of these means
extending `structureParams.ts` with bounds read out of the source, or teaching
`classes.ts` to read an assignment that is not terminated by `;`.

**`resolveParam`'s unimplemented ladders stayed unimplemented and nothing
declares one.** A casing tier comes out as a `count` parameter with grounded
bounds instead — anvil 1–4, item pipe 1–8, pipe casing 0–3, each with the source
line the bounds came from. A named ladder is still the upgrade; the ParamKinds
are reserved for it.

## Stage 10 — the Industrial Maceration Stack

The IMS was one of the 24 `unknown` parallel models, and its `assume: 1` was
badly wrong: a T2 IMS on one EV hatch runs **32** parallels, not one. Reading it
took three small extractor changes rather than an override, because each one
generalises.

```java
final long tVoltage = getMaxInputVoltage();
final byte tTier = (byte) Math.max(1, GTUtility.getTier(tVoltage));
return Math.max(1, (controllerTier == 1 ? 2 : 8) * tTier);
```

- **`classes.ts` gains `localDeclarations`.** GT names its working out, so a
  `return` alone says nothing. Only primitives are read, and a name assigned
  again anywhere in the body is **dropped** — `int parallels = 1;` followed by
  `parallels = 8` inside an `if` would otherwise resolve to 1, which is exactly
  the plausible wrong number this extractor may not produce. `readParallel`
  parses the method's own locals and passes them to `mapJava` as extra `fields`,
  in scope for that one body.
- **`mapExpr`'s `isMaxInputVoltage` follows an alias.** `getTier(tVoltage)` is
  the tier reference when `tVoltage` is in scope as `getMaxInputVoltage()`.
  `getTier` of anything else still refuses.
- **`controllerTier` joins `STRUCTURE_PARAMS`**, whose header now says "at
  runtime" rather than "during `checkMachine`": the IMS's tier comes from a
  consumed Maceration Upgrade Chip, not from a casing. A `count` 1–2, so the
  `when` in the formula compares against the raw value directly.

The extracted model is `max(1, (controllerTier == 1 ? 2 : 8) * floor(max(1,
tier)))`, and `tier` is the **summed** hatch voltage — four EV hatches are an IV
machine, so a T2 gets 40. The parallel table on the wiki is reproduced exactly
(T1 LV 2, T1 EV 8, T2 EV 32, T2 UV 64). The 160% speed was already read as
`{ div: [1, 1.6] }`.

Only the IMS moved: `formula` 31 → 32, `unknown` 24 → 23, `count` params 4 → 5.
Seven tests were added across `classes`, `mapExpr` and `overclock`.

**What is still not modelled, for the IMS or anything else: hatch restrictions.**
The IMS's `buildHatchAdder(...).atLeast(Energy, Maintenance, InputBus, Muffler,
OutputBus)` has no `ExoticEnergy`, so multi-amp and laser hatches cannot be
built into it — the wiki says so too. The catalog has nowhere to put that, so a
node can still be given a 64 A hatch the game would refuse. It is extractable
(the hatch elements are named in `getStructureDefinition`) and it applies to
every machine, so it is its own stage: a `Machine.hatches` field, an extractor
pass, a `GraphIssue` kind and a node guard.

## Still to do

Nothing in the staged plan. The open work is the in-game verification listed at
the bottom of this document, and the input bound (`inputLimit` in `parallel.ts`,
see `TODO.md`) — GT's last parallel clamp, whose seam is in place and whose
argument nothing passes yet.

The full plan, including the design rationale for each stage, is at
`~/.claude/plans/continuing-with-the-multilocks-declarative-turtle.md`. Read its
stage 6 against the decision below, which supersedes part of it.

## Stages 6 and 7 — what landed

They went in one commit, for the reason the previous handoff gave: stage 6
cannot be green alone. Once `normalizeNodes` strips `parallels`, the old
heuristic reads `undefined` and runs every multiblock at one parallel, and
`recipeNode.tsx` patches fields `RecipeFields` no longer carries.

### The store

- `EnergyHatch` gains a required `amps: number`, with `DEFAULT_HATCH_AMPS = 2`
  beside it. Required rather than optional because `normalizeNodes` backfills
  it, so nothing downstream has to ask twice.
- `MultiblockRecipeData` gains `config?`, `recipeHeat?` and `parallelLimit?`;
  `overclock?` and `parallels?` are gone from the type entirely, since the
  engine that read them is gone.
- `PersistedRecipe` keeps `overclock?`/`parallels?` as v1 read-only forever — a
  Yjs snapshot from last year still arrives tomorrow — and takes `hatches` with
  `amps` optional.
- `needsBackfill` additionally fires when any hatch lacks `amps`, or when
  `overclock`/`parallels` are present. `normalizeNodes` fills the amps, drops
  those two, and spreads the three new optional ones **conditionally**: writing
  `config: undefined` puts an explicit undefined key in the object, which
  survives `JSON.stringify` inconsistently across the `historyKey`,
  `isDeepEqual` and Yjs paths and shows up as spurious history entries.
- No `v` schema stamp and no `parallelLimit: parallels ?? 1` backfill, per
  decision 7.
- `updateRecipe` drops `config`/`recipeHeat`/`parallelLimit` when a node is
  switched to a singleblock, the way it already dropped `hatches`.

### The engine

`src/domain/overclock.ts` is now a facade, and everything it does is about
choosing which numbers to hand `src/domain/gt/`:

- `hatchSupply()` is the correction that mattered most. GT keeps **three**
  numbers where this app kept one: `getAverageInputVoltage` (Σ voltage / hatch
  count, floored), `getMaxInputAmps` (Σ amps, collapsed to 1 under
  `useSingleAmp`), and `getMaxInputVoltage` (the Σ, which is what the
  `N x tier` parallel formulas read and is a different quantity). One LV hatch
  is 32 EU/t, two are 128, four are 256; the old model said 32, 64 and 128.
  `useSingleAmp`'s exotic-hatch test reads as "any group carrying more than
  2 A", because a laser or wireless hatch is exactly the thing that does.
- The order is GT's: resolve the machine, take the sub-tick multiplier off a
  **one-parallel** calculator, let `determineParallel` decide how many recipes
  run, then `calculateOverclock` with that count.
- `amperageOC` is forced true for every multiblock (`setProcessingLogicPower`
  sets it unconditionally) and stays false for every single block, which never
  touches `ParallelHelper` or the catalog at all — decision 8.
- The facade gates the one thing the kernel deliberately does not: below the
  recipe's heat the divisions go negative and the power goes _up_, so
  `machine.requiresHeat && machineHeat < recipeHeat` returns the figures as
  entered with `underheated: true`.
- `parallel.running` is the kernel's own answer and is **0** when the supply
  cannot pay for one recipe. The top-level `parallels` alias floors it at 1, so
  an underpowered node raises its issue instead of silently emptying every line
  below it.
- `oc.floored` is new, and is not something the kernel reports: overclocks GT
  charged 4x for whose time saving the one-tick floor swallowed. On a
  multiblock they come back as parallels (`parallel.subTick`); on a single
  block they are pure waste, which is what the `throttled` issue now means
  there.
- Memoised in a `WeakMap<RecipeNodeData, Overclock>`, which `normalizeNodes`'
  identity return makes safe.

### The UI

Stage 7 only kept `recipeNode.tsx` honest — the real node work is stage 9. The
machine `Select` reads `MACHINE_OPTIONS`/`matchesMachine` from the catalog, the
parallels `NumberInput` became a `parallelLimit` ceiling whose placeholder is
the machine's own cap, the overclock-mode `Select` is gone, and `Calculations`
was restated against the new result shape. There is still no UI for `config` or
`recipeHeat`, so an EBF runs on its default coil and a 0 K recipe until stage 9.

### Issues

`overclockIssues` keeps the same four kinds the panel already renders, restated
against the port: `underpowered`, `overparallel` (now "the hatches cannot pay
for the parallels the machine offers"), `throttled` (`oc.wasted` plus
`oc.floored` where no sub-tick multiplier absorbed it), and `unmodeled` (not in
the catalog, `unknown` confidence, or an unread parallel model). Stage 8 turns
these into their own kinds with the kernel's reasons attached.

### Pinned results, all hand-worked against the Java before being written down

- 4 LV hatches deliver **256 EU/t**, not 128
- a 32 EU/t, 20-tick recipe on one UV hatch: sub-tick multiplier **7**, so a
  cap-1 machine runs 7 recipes, then re-overclocks against the 224 EU/t that
  costs and lands on 229,376 EU/t in 1 tick
- Volcanus at 8 parallels takes **no overclock at all** — 8,192 / 3,119 is 2 by
  integer division and `log4(2)` is 0 — and charges 3,120 EU/t over 45 ticks
- an EBF on HSS-G coils and one IV hatch is 5,401 + 100 x (5 - 2) = **5,701 K**,
  which against an 1,800 K recipe is four 0.95 discounts and two heat
  overclocks, ending at 6,256 EU/t and 18 ticks
- an Industrial Centrifuge on 4 EV hatches reads the **summed** 8,192 (IV,
  tier 5) for its `6 x tier` and caps at 30
- the same UV recipe that wastes an overclock in a Macerator runs 4 parallels
  in a multiblock — the single biggest behavioural change in the port

### Not verified in game yet

Two of the five entries under "Verify against the game" below are now settled
without a pack, against GregTech's own numbers — see "Checked against the
oracle". What is left is the parallel and hatch-supply half of the port.

## Stage 8 — what the port reports

`GraphIssue` goes from nine kinds to ten, and `issueLabel`'s switch is what
keeps them honest: it is annotated `: string`, so a new kind without a label
fails `types:check` rather than rendering `undefined` through JSX. (The
annotation is the enforcement; `noFallthroughCasesInSwitch` alone is not.)

- **`underheated`, new.** The machine is colder than the recipe. A hard "will
  not run", because GT matches on heat before anything else. Carries both heats
  in K.
- **`underpowered`, sharpened** to `parallel.running === 0` — the supply cannot
  pay for a single recipe.
- **`throttled`, redefined** as overclocks charged for that bought nothing:
  `oc.wasted` plus `oc.floored` where no sub-tick multiplier absorbed them. GT
  takes `4^n` regardless, so the label says charged for rather than unavailable.
- **`overparallel`, narrowed** to `parallel.limitedBy === 'node'`. It no longer
  fires when power alone caps the parallels — that is the shape of almost every
  real multiblock and not a user error.
- **`unmodeled`, narrowed** to not in the catalog or `unknown` confidence.
  `parallelKnown` is implied by the latter; no machine has one without the other.
- A **required machine parameter** the node never set folds into the existing
  `incomplete`, read off `resolveMachine(...).parameters` rather than a second
  hand-kept list. Eleven machines declare one.

## Stage 9 — the node

The rule was: nothing renders unless the selected machine asks for it, and at
most one machine parameter is ever inline.

- `ParamField` renders one declared parameter — `coilTier`, `voltageTier`,
  `count`, `enum`, `boolean` — from the catalog's declaration alone. The two
  casing-ladder kinds return `null`; `resolveMachine` throws on them and a guard
  test asserts no machine declares one, so they are unreachable by construction.
- The **one `primary` parameter is inline** next to `HatchField`: an EBF shows
  its coil `Select` with no clicks. Everything today is primary and no machine
  declares more than one, so the gear currently holds only the ceiling — but the
  shape is there for when the extractor reads more.
- `MachineSettings` is the gear: non-primary parameters, then a "Limits" divider
  and `parallelLimit`, whose placeholder is the machine's own cap so an empty
  field visibly means "whatever the machine does". Dotted when anything differs
  from what the machine would do on its own.
- The machine `Select` **keeps an unresolvable saved name selectable**, as
  `"<name> (not in catalog)"`. Mantine renders blank when `value` is not in
  `data`, and the next edit to any other field would then persist `machine: ''`.
  The synthetic entry is filtered out of search, so it can never be chosen.
- The **recipe heat** `NumberInput` sits with EU / s / A, because `mSpecialValue`
  is a property of the recipe as NEI prints it. Shown only for the three
  machines that read heat at all.
- `Calculations` shows **ticks first, seconds in brackets** — the one-tick floor
  and the `(int)` truncation are invisible in seconds. New conditional rows for
  heat (discounts and heat overclocks share the subtraction they come from) and
  for parallels (`30 of 30`, with a tooltip naming `limitedBy` and the sub-tick
  multiplier). Every formula carries every factor GT applied, the machine's own
  modifiers and the heat discount included: a row reading `120 x 4^3` next to
  6,256 is an invitation to go hunting for an arithmetic error that is not there.
- `overclockDetail()` answers, in the order the questions stop mattering:
  underheated, underpowered, nothing entered, not in the catalog, what the
  overclocks did, and finally why there were none. That last string used to say
  an overclock "needs a full tier of headroom" — the heuristic's lie, and the
  reason for this whole migration. It now says what GT actually compares: the
  supply against a multiple of the draw.

## Checked in the app

Driven in headless Chromium against `pnpm dev` + `pnpm emulators`, signed in as
a throwaway emulator account. No console errors. The pinned EBF case renders as
the tests say it should:

```
Power   120 EU/t × 0.95^4 × 4^3 →   6,256 EU/t
Time    600t ÷ 4^2 ÷ 2^1 →          18t (0.9s)
Tier    MV →                        IV
Heat    5,701 − 1,800 =             3,901 K · 4 discounts, 2 OC
Overclock                           3× (2 heat)
```

and an Industrial Centrifuge on 4 EV hatches:

```
Power      60 EU/t × 30P × 0.9 × 4^1 →  6,480 EU/t
Time       200t ÷ 2.25 ÷ 2^1 →          44t (2.2s)
Parallels                               30 of 30
```

The coil `Select`, the settings gear with its ceiling field, the conditional
heat field (present on the EBF, absent on the Centrifuge) and both tooltips all
render. The issue panel showed `Heating coils: not set` against a saved EBF node
from before the migration, which is the stage 8 `incomplete` pass working on
real persisted data.

Reproducing it needs `playwright-core` driving `/usr/bin/chromium`; there is no
component-test setup in this repo and this did not add one.

## Commands

```bash
pnpm test                 # vitest
pnpm types:check          # tsc -b
pnpm validate             # lint + styles + format + types
pnpm exec oxfmt src/...   # format (note: src/domain/overclock.ts has pre-existing drift on main)

# re-extract the catalog from GregTech source. dry by default: it prints the
# coverage report and also writes it to .gt-cache/extract-report.txt. read that
# before passing GT_WRITE=1, which rewrites raw.machines.json AND machines.json
GT_VERSION=5.09.51.482 pnpm gt:extract
GT_VERSION=5.09.51.482 GT_WRITE=1 pnpm gt:extract
# optional: GT_LANG=<pack>/GregTech.lang adds a pack instance's own names,
# GT_FAIL_ON_REGRESSION=1 fails if any counter got worse than .gt-cache/counters.json
# a run takes about a minute; the tarball is cached in .gt-cache/ (gitignored)

# rebuild src/data/machines.json after editing overrides or aliases by hand
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
7. **Live multiblock data is disposable.** The production graphs hold almost no
   multiblock nodes — a handful — and clean architecture is worth more than
   keeping them. Three things follow, and they replace what the plan's stage 6
   says:
   - **No `parallelLimit: parallels ?? 1` backfill.** A legacy multi drops
     `parallels` and `overclock` and takes the real machine cap. Nothing has to
     reproduce the old throughput, so nothing does.
   - **The schema stamp `v` is no longer load-bearing.** Its only job was to
     answer "did this multi ever have a `parallels` value?" so the backfill
     could converge. With no backfill, "has `overclock` or `parallels`" answers
     it, and `needsBackfill` still goes exactly false once they are gone — which
     is what stops `normalizeNodes` rebuilding a node on every remote update.
     Reconsider `v` only if a future migration actually needs it.
   - The 145 frozen legacy names are therefore **reported, not gated**. 131 of
     them resolve. The 14 that do not are machines from mods outside this repo
     (Ender Quarry, Stargate, Draconic Reactor, Forestry Multifarm) or ones no
     longer in GT5-Unofficial; aliasing them to a plausible-looking neighbour
     would be a guess, so they stay unmapped and the report lists them.
8. **Single blocks must keep working.** That is where the live data actually is.
   They never touch `ParallelHelper` or the catalog, so stage 7 has to keep
   their path — `machineVoltage = TIER_EU[voltage]`, amperage 1, `amperageOC`
   false — separate and covered by its own tests.

## Checked against the oracle

[GTNH Factory Flow](https://github.com/jackwrichards/gtnh-factory-flow) (MIT)
publishes a dataset built by a Forge mod that runs inside a headless GTNH client
and calls `gregtech.api.util.OverclockCalculator` on every recipe in the live
registries. Its per-tier figures are GregTech's own answers, which makes them an
oracle for this port: reading the Java says what the class does, and only this
says we read it right.

`tools/buildOracleFixture.mjs` samples that dataset into
`src/domain/gt/__fixtures__/oracleOverclock.json`, and
[oracleOverclock.test.ts](src/domain/gt/oracleOverclock.test.ts) replays it.
Every row agrees:

- **1,792 rows of the plain ladder** — 150 distinct (EU/t, duration) shapes
  across every tier from ULV to UXV, four decades of EU/t. This covers the
  integer duration truncation, which is where a transcription usually drifts.
- **678 rows of the EBF heat matrix** — 6 recipes x 13 tiers x 14 coils. The
  heat rows go through `resolveMachine`, so the machine data is on trial too,
  and that is how the run found `MTEElectricBlastFurnace`'s heat is
  `coilHeat + 100 x (tier - 2)` rather than the coil's own figure. The
  extractor already had it; the first draft of the test did not, and was wrong
  by exactly one coil step everywhere.

Two things the oracle cannot settle. Every variant in it runs at **one
parallel**, so nothing below about parallels is touched by it. And its **MAX**
column is computed against roughly 2^63 rather than `GTValues.V[14]`
(`Integer.MAX_VALUE - 7`), so the fixture drops that tier — the same reading
that corrected `TIER_EU.MAX` here from 2^31.

## Verify against the game before trusting the rest

Settled without a pack, and struck from this list:

- ~~an EBF recipe at two coil tiers, for `0.95^n` and the 1800 K heat
  overclocks~~ — 678 oracle rows, every coil and every tier.
- ~~a short recipe on overtiered hatches~~, for the **regular** overclock ladder.
  The sub-tick parallel multiplier is a parallel mechanic and stays below.

What is left, in rough order of how likely each is to be wrong:

1. a 1-hatch vs 2-hatch LV machine, for the `useSingleAmp` rule and 2 A per
   hatch. Factory Flow's `energy-hatches.ts` reads the same GT call sites the
   same way, which is corroboration from a second reader, not a measurement.
2. Volcanus, for 8 parallels with the 0.9 and 1/2.2 modifiers
3. an Industrial Centrifuge at two hatch tiers, for `6 x tier`
4. a short recipe on overtiered hatches, for the sub-tick parallel multiplier

NEI gives the recipe's EU/t and duration; the machine's own GUI gives actual EU/t
and progress time.
