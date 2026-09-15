// How a multiblock reacts to being fed more power than its recipe requires.
//   imperfect — 2x speed for 4x power; total energy doubles per step
//   perfect   — 4x speed for 4x power; total energy is unchanged
//   mixed     — capable of both, depending on the recipe or an upgrade; the
//               user picks per node via `overclock` on the recipe data
//   unique    — follows its own rules; we do not guess, values stay as entered
//   none      — cannot overclock at all
export type OverclockMode =
  | 'imperfect'
  | 'perfect'
  | 'mixed'
  | 'unique'
  | 'none';

export interface Multiblock {
  name: string;
  overclock: OverclockMode;
  // lowercased search terms: the name's initials, plus any short form whose
  // spelling the initials don't produce
  terms: string[];
}

// GTNH multiblocks grouped by their wiki overclock classification
const BY_MODE: Record<OverclockMode, string[]> = {
  imperfect: [
    'Pyrolyse Oven',
    'Industrial Farm',
    'ExxonMobil Chemical Plant',
    'Multi Smelter',
    'Concrete Backfiller',
    'Research Completer',
    'Distillation Tower',
    'Cleanroom',
    'Vacuum Freezer',
    'Oil Cracking Unit',
    'Large Sifter',
    'Implosion Compressor',
    'LATEX',
    'Dissection Apparatus',
    'TurboCan Pro',
    'Bacterial Vat',
    'Big Barrel Brewery',
    'Solar Factory',
    'Industrial Coke Oven',
    'Ore Drilling Plant',
    'Industrial Maceration Stack',
    'Ore Washing Plant',
    'Industrial Chemical Bath',
    'Large Thermal Refinery',
    'Industrial Centrifuge',
    'Industrial Bending Machine',
    'Industrial Forming Press',
    'Industrial Precision Lathe',
    'Large Electric Compressor',
    'Large Fluid Extractor',
    'Dissolution Tank',
    'Industrial 3D Copying Machine',
    'Assembly Line',
    'Reactor Fuel Processing Plant',
    'Nuclear Salt Processing Plant',
    'Dangote Distillus',
    'Planetary Gas Siphon',
    'Zhuhai Fishing Port',
    'Boldarnator',
    'Alloy Blast Smelter',
    'Cryogenic Freezer',
    'Precise Auto-Assembler MT-3662',
    'Industrial Electrolyzer',
    'Industrial Mixing Machine',
    'Magnetic Flux Exhibitor',
    'Density^2',
    'Industrial Wire Factory',
    'Industrial Extrusion Machine',
    'Industrial Cutting Factory',
    'Hyper-Intensity Laser Engraver',
    'Mass Solidifier',
    'Industrial Sledgehammer',
    'Amazon Warehousing Depot',
    'Thermic Heating Device',
    'Sparge Tower',
    'Mega Distillation Tower',
    'Mega Oil Cracker',
    'Industrial Autoclave',
    'Molecular Transformer',
    'Endothermic Fridge',
    'Large Scale Auto-Assembler v1.01',
    'Hot Isostatic Pressurization Unit',
    'Spinmatron-2737',
    'Mega Alloy Blast Smelter',
    'Neutronium Compressor',
    'Electric Implosion Compressor',
    'Quantum Force Transformer',
  ],
  perfect: [
    'Large Chemical Reactor',
    'Extreme Entity Crusher',
    'Digester',
    'Fusion Reactor',
    'Compact Fusion Reactor',
    'Mega Chemical Reactor',
    'IsaMill Grinding Machine',
    'Flotation Cell Regulator',
    'Circuit Assembly Line',
    'Matter Fabrication CPU',
    'Elemental Duplicator',
    'Naquadah Fuel Refinery',
    'Nanochip Assembly Complex',
  ],
  mixed: [
    'Electric Blast Furnace',
    'Volcanus',
    'Zyngen',
    'Utupu-Tanuri',
    'Exothermic Hearth',
    'Component Assembly Line',
    'PCB Factory',
    'Nano Forge',
    'Draconic Evolution Fusion Crafter',
    'Dimensionally Transcendent Plasma Forge',
  ],
  unique: [
    'Fluid Drilling Rig',
    'Algae Farm',
    'Advanced Assembly Line',
    'Tree Growth Simulator',
    'Extreme Industrial Greenhouse',
    'Large Molecular Assembler',
    'Industrial Arc Furnace',
    'Synchrotron',
    'Industrial Apicultural Acclimatiser and Drone Domestication Station',
    'Large Hadron Collider',
    'Exo-Foundry',
    'Forge of the Gods',
    'Pseudostable Black Hole Containment Field',
    'Eye of Harmony',
  ],
  none: [
    'Electric Air Filter',
    'Forestry Multifarm',
    'Microwave Grinder',
    'TFFT',
    'Lapotronic Supercapacitor',
    'Tesla Tower',
    'Deep Earth Heating Pump',
    'High Temperature Gas-Cooled Reactor',
    'Drone Centre',
    'Decay Warehouse',
    'YOTTank',
    'Ender Quarry',
    'Neutron Activator',
    'Water Purification Plant',
    'Clarifier Purification Unit',
    'Ozonation Purification Unit',
    'Void Miner',
    'Active Transformer',
    'Data Bank',
    'Energy Infuser',
    'Source Chamber',
    'Linear Accelerator',
    'Target Chamber',
    'Flocculation Purification Unit',
    'pH Neutralization Purification Unit',
    'Space Elevator',
    'Quantum Computer',
    'Research Station',
    'Network Switch With QoS',
    'Beam Crafter',
    'Extreme Temperature Fluctuation Purification Unit',
    'High Energy Laser Purification Unit',
    'Matter Manipulator Quantum Uplink',
    'Integrated Ore Factory',
    'Miniature Wormhole Generator',
    'Residual Decontaminant Degasser Purification Unit',
    'Absolute Baryonic Perfection Purification Unit',
    'Transcendent Plasma Mixer',
    'Semi-Stable Antimatter Stabilization Sequencer',
    'Draconic Reactor',
    'Stargate',
  ],
};

// nobody types `Large Chemical Reactor` — they type `lcr`. every machine is
// therefore searchable by its initials, which is what the community's short
// forms almost always are

// words nobody voices as an initial. `Eye of Harmony` is EoH, not EH, so both
// the with- and without-minor-words spellings are generated
const MINOR_WORDS = new Set(['and', 'of', 'the', 'with']);

const initials = (name: string, keepMinor: boolean) =>
  name
    .split(/[\s-]+/)
    .filter(
      word =>
        word !== '' && (keepMinor || !MINOR_WORDS.has(word.toLowerCase())),
    )
    .map(word => word[0])
    .join('')
    .toLowerCase();

// only for machines whose everyday short form is not its initials
const SHORT_FORMS: Record<string, string[]> = {
  'High Temperature Gas-Cooled Reactor': ['htgr'],
  'Dimensionally Transcendent Plasma Forge': ['godforge'],
  'Forge of the Gods': ['godforge'],
  'Precise Auto-Assembler MT-3662': ['pa', 'precise assembler'],
};

// flat, name-sorted — the order the machine Select renders in
export const MULTIBLOCKS: Multiblock[] = Object.entries(BY_MODE)
  .flatMap(([overclock, names]) =>
    names.map(name => ({
      name,
      overclock: overclock as OverclockMode,
      terms: [
        ...new Set([
          initials(name, true),
          initials(name, false),
          ...(SHORT_FORMS[name] ?? []),
        ]),
      ],
    })),
  )
  .sort((a, b) => a.name.localeCompare(b.name));

const INDEX = new Map(MULTIBLOCKS.map(x => [x.name, x]));

// undefined for a name that is not in the catalog — a multiblock node saved
// before an entry was renamed, or hand-typed data from an older graph
export const findMultiblock = (name: string): Multiblock | undefined =>
  INDEX.get(name);

// a machine matches if the search appears anywhere in its name, or starts one
// of its short forms. short forms match by prefix rather than substring so that
// `cr` doesn't drag in every machine whose initials merely contain those two
export const matchesMultiblock = (name: string, search: string): boolean => {
  const query = search.trim().toLowerCase();
  if (query === '') return true;
  if (name.toLowerCase().includes(query)) return true;
  return INDEX.get(name)?.terms.some(term => term.startsWith(query)) ?? false;
};
