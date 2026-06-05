import {
  VOLTAGE_TIERS,
  type TierDemand,
  type VoltageTier,
} from '@/contexts/productionStore';

// EU/t carried by 1A at each GregTech voltage tier. Singleblock generators
// always output exactly 1A at their rated tier, so this is their gross output.
export const TIER_EU: Record<VoltageTier, number> = {
  LV: 32,
  MV: 128,
  HV: 512,
  EV: 2048,
  IV: 8192,
  LuV: 32768,
  ZPM: 131072,
  UV: 524288,
  UHV: 2097152,
  UEV: 8388608,
  UIV: 33554432,
  UMV: 134217728,
  UXV: 536870912,
  MAX: 2147483648,
};

// a single fuel and how much energy one unit holds (in `unit`s of the category)
export interface Fuel {
  name: string;
  value: number;
}

// one tier variant of a generator: fixed output (its voltage tier) and the
// efficiency applied to fuel. efficiency may exceed 1 (naquadah reactors)
export interface GeneratorTier {
  name: string;
  tier: VoltageTier;
  efficiency: number;
}

export interface GeneratorCategory {
  id: string;
  name: string;
  // fluid burners measure fuel in litres (value = EU/L); item burners measure
  // in whole items (value = EU per item)
  unit: 'L' | 'item';
  tiers: GeneratorTier[];
  fuels: Fuel[];
}

// source: https://wiki.gtnewhorizons.com/wiki/Singleblock_Generators
export const GENERATORS: GeneratorCategory[] = [
  {
    id: 'steam',
    name: 'Steam Turbine',
    unit: 'L',
    tiers: [
      { name: 'Basic Steam Turbine', tier: 'LV', efficiency: 0.85 },
      { name: 'Advanced Steam Turbine', tier: 'MV', efficiency: 0.75 },
      { name: 'Turbo Steam Turbine', tier: 'HV', efficiency: 0.66 },
    ],
    fuels: [{ name: 'Steam', value: 0.5 }],
  },
  {
    id: 'gas',
    name: 'Gas Turbine',
    unit: 'L',
    tiers: [
      { name: 'Basic Gas Turbine', tier: 'LV', efficiency: 0.95 },
      { name: 'Advanced Gas Turbine', tier: 'MV', efficiency: 0.9 },
      { name: 'Turbo Gas Turbine', tier: 'HV', efficiency: 0.85 },
      { name: 'Turbo Gas Turbine II', tier: 'EV', efficiency: 0.6 },
      { name: 'Turbo Gas Turbine III', tier: 'IV', efficiency: 0.5 },
    ],
    fuels: [
      { name: 'Natural Gas', value: 20 },
      { name: 'Hydrogen', value: 20 },
      { name: 'Carbon Monoxide', value: 24 },
      { name: 'Wood Gas', value: 24 },
      { name: 'Sulfuric Gas', value: 25 },
      { name: 'Biogas', value: 40 },
      { name: 'Sulfuric Naphtha', value: 40 },
      { name: 'Cyclopentadiene', value: 70 },
      { name: 'Coal Gas', value: 96 },
      { name: 'Methane', value: 104 },
      { name: 'Ethylene', value: 128 },
      { name: 'Refinery Gas', value: 160 },
      { name: 'Ethane', value: 168 },
      { name: 'Propene', value: 192 },
      { name: 'Butadiene', value: 206 },
      { name: 'Naphtha', value: 220 },
      { name: 'Propane', value: 232 },
      { name: 'Butene', value: 256 },
      { name: 'Phenol', value: 288 },
      { name: 'Butane', value: 296 },
      { name: 'LPG', value: 320 },
      { name: 'Toluene', value: 328 },
      { name: 'Benzene', value: 360 },
      { name: 'Ether', value: 537 },
      { name: 'Naquadah Gas', value: 1024 },
      { name: 'Nitrobenzene', value: 1600 },
    ],
  },
  {
    id: 'combustion',
    name: 'Combustion Generator',
    unit: 'L',
    tiers: [
      { name: 'Basic Combustion Generator', tier: 'LV', efficiency: 0.95 },
      { name: 'Advanced Combustion Generator', tier: 'MV', efficiency: 0.9 },
      { name: 'Turbo Combustion Generator', tier: 'HV', efficiency: 0.85 },
      {
        name: 'Turbo Supercharging Combustion Generator',
        tier: 'EV',
        efficiency: 0.65,
      },
      {
        name: 'Ultimate Chemical Energy Releaser',
        tier: 'IV',
        efficiency: 0.5,
      },
    ],
    fuels: [
      { name: 'Fish Oil', value: 2 },
      { name: 'Short Mead', value: 4 },
      { name: 'Biomass', value: 8 },
      { name: 'Creosote Oil', value: 8 },
      { name: 'Oil', value: 16 },
      { name: 'Sulfuric Light Fuel', value: 40 },
      { name: 'Octane', value: 80 },
      { name: 'Methanol', value: 84 },
      { name: 'Ethanol', value: 192 },
      { name: 'Light Fuel', value: 305 },
      { name: 'Bio Diesel', value: 320 },
      { name: 'Butanol', value: 400 },
      { name: 'Diesel', value: 480 },
      { name: 'Ether', value: 537 },
      { name: 'Gasoline', value: 576 },
      { name: 'Cetane-Boosted Diesel', value: 1000 },
      { name: 'Ethanol Gasoline', value: 1100 },
      { name: 'Jet Fuel No.3', value: 1824 },
      { name: 'Jet Fuel A', value: 2248 },
      { name: 'High Octane Gasoline', value: 2500 },
    ],
  },
  {
    id: 'semifluid',
    name: 'Semifluid Generator',
    unit: 'L',
    tiers: [
      { name: 'Basic Semifluid Generator', tier: 'LV', efficiency: 0.95 },
      { name: 'Advanced Semifluid Generator', tier: 'MV', efficiency: 0.9 },
      { name: 'Turbo Semifluid Generator', tier: 'HV', efficiency: 0.85 },
      { name: 'Turbo Semifluid Generator II', tier: 'EV', efficiency: 0.8 },
      { name: 'Turbo Semifluid Generator III', tier: 'IV', efficiency: 0.75 },
    ],
    fuels: [
      { name: 'Fish Oil', value: 4 },
      { name: 'Seed Oil', value: 4 },
      { name: 'Raw Animal Waste', value: 12 },
      { name: 'Coal Tar', value: 16 },
      { name: 'Biomass', value: 16 },
      { name: 'Manure Slurry', value: 24 },
      { name: 'Coal Tar Oil', value: 32 },
      { name: 'Fertile Manure Slurry', value: 32 },
      { name: 'Light Oil', value: 40 },
      { name: 'Oil', value: 40 },
      { name: 'Creosote Oil', value: 48 },
      { name: 'Heavy Oil', value: 60 },
      { name: 'Raw Oil', value: 60 },
      { name: 'Sulfuric Coal Tar Oil', value: 64 },
      { name: 'Sulfuric Heavy Fuel', value: 80 },
      { name: 'Very Heavy Oil', value: 90 },
      { name: 'Naphthenic Acid', value: 160 },
      { name: 'Glycerol', value: 328 },
      { name: 'Heavy Fuel', value: 360 },
      { name: 'Nefarious Oil', value: 572 },
    ],
  },
  {
    id: 'acid',
    name: 'Acid Generator',
    unit: 'L',
    tiers: [
      { name: 'Acid Generator', tier: 'LV', efficiency: 0.97 },
      { name: 'Acid Generator', tier: 'MV', efficiency: 0.94 },
      { name: 'Acid Generator', tier: 'HV', efficiency: 0.91 },
      { name: 'Acid Generator', tier: 'EV', efficiency: 0.88 },
      { name: 'Acid Generator', tier: 'IV', efficiency: 0.5 },
    ],
    fuels: [
      { name: 'Diluted Sulfuric Acid', value: 14 },
      { name: 'Acetic Acid', value: 21 },
      { name: 'Diluted Hydrochloric Acid', value: 26 },
      { name: 'Sulfuric Acid', value: 28 },
      { name: 'Mercury', value: 32 },
      { name: 'Molten Redstone', value: 40 },
      { name: 'Formic Acid', value: 40 },
      { name: 'Hydrochloric Acid', value: 52 },
      { name: 'Hypochlorous Acid', value: 56 },
      { name: 'Hydrofluoric Acid', value: 60 },
      { name: 'Phosphoric Acid', value: 66 },
      { name: 'Nitric Acid', value: 72 },
      { name: 'Propionic Acid', value: 150 },
      { name: 'Industrial Hydrogen Chloride', value: 224 },
      { name: 'Naphthenic Acid', value: 250 },
      { name: 'Phthalic Acid', value: 270 },
      { name: 'Industrial Hydrofluoric Acid', value: 320 },
      { name: 'Hexafluorosilicic Acid', value: 350 },
      { name: 'Chlorosulfonic Acid', value: 2304 },
      { name: 'Fluoroantimonic Acid', value: 5760 },
    ],
  },
  {
    id: 'geothermal',
    name: 'Geothermal Engine',
    unit: 'item',
    tiers: [
      { name: 'Basic Geothermal Engine', tier: 'EV', efficiency: 0.72 },
      { name: 'Turbo Geothermal Engine', tier: 'IV', efficiency: 0.65 },
      { name: 'Vulcan Geothermal Engine', tier: 'LuV', efficiency: 0.58 },
    ],
    fuels: [
      { name: 'Pahoehoe Lava Cell', value: 24000 },
      { name: 'Lava Bucket', value: 32000 },
      { name: 'Cryotheum Dust', value: 62000 },
      { name: 'Pyrotheum Dust', value: 62000 },
    ],
  },
  {
    id: 'rocket',
    name: 'Rocket Engine',
    unit: 'L',
    tiers: [
      { name: 'Basic Rocket Engine', tier: 'EV', efficiency: 0.8 },
      { name: 'Advanced Rocket Engine', tier: 'IV', efficiency: 0.7 },
      { name: 'Turbo Rocket Engine', tier: 'LuV', efficiency: 0.6 },
    ],
    fuels: [
      { name: 'RP-1 Rocket Fuel (red)', value: 1536 },
      { name: 'Dense Hydrazine Fuel Mixture', value: 3072 },
      { name: 'CN3H7O3 Rocket Fuel (purple)', value: 6144 },
      { name: 'H8N4C2O4 Rocket Fuel (green)', value: 12588 },
    ],
  },
  {
    id: 'plasma',
    name: 'Plasma Generator',
    unit: 'L',
    tiers: [
      { name: 'Plasma Generator Mk-I', tier: 'EV', efficiency: 0.5 },
      { name: 'Plasma Generator Mk-II', tier: 'IV', efficiency: 0.6 },
      { name: 'Plasma Generator Mk-III', tier: 'LuV', efficiency: 0.7 },
      { name: 'Plasma Generator Mk-IV', tier: 'ZPM', efficiency: 0.8 },
      { name: 'Ultimate Pocket Sun', tier: 'UV', efficiency: 0.9 },
    ],
    fuels: [
      { name: 'Carbon Plasma', value: 12288 },
      { name: 'Hydrogen Plasma', value: 20480 },
      { name: 'Bedrockium Plasma', value: 20480 },
      { name: 'Phosphorus Plasma', value: 30720 },
      { name: 'Deuterium Plasma', value: 40960 },
      { name: 'Desh Plasma', value: 50176 },
      { name: 'Tritium Plasma', value: 61440 },
      { name: 'Meteoric Iron Plasma', value: 69632 },
      { name: 'Chlorine Plasma', value: 172032 },
      { name: 'Force Plasma', value: 180000 },
      { name: 'Potassium Plasma', value: 183705 },
      { name: 'Calcium Plasma', value: 188416 },
      { name: 'Argon Plasma', value: 188416 },
      { name: 'Rhenium Plasma', value: 190464 },
      { name: 'Titanium Plasma', value: 196608 },
      { name: 'Vanadium Plasma', value: 198451 },
      { name: 'Rhugnor Plasma', value: 333824 },
      { name: 'Naquadah Plasma', value: 337920 },
      { name: 'Barium Plasma', value: 342302 },
      { name: 'Lanthanum Plasma', value: 344801 },
    ],
  },
  {
    id: 'magic',
    name: 'Magic Energy Converter',
    unit: 'item',
    tiers: [
      { name: 'Novice Magic Energy Converter', tier: 'LV', efficiency: 0.95 },
      { name: 'Adept Magic Energy Converter', tier: 'MV', efficiency: 0.9 },
      { name: 'Master Magic Energy Converter', tier: 'HV', efficiency: 0.85 },
    ],
    fuels: [
      { name: 'Magic Wax', value: 6000 },
      { name: 'Amber', value: 6000 },
      { name: 'Ironwood', value: 8000 },
      { name: "Bottle o' Enchanting", value: 10000 },
      { name: 'Eye of Ender', value: 20000 },
      { name: 'Knightmetal', value: 24000 },
      { name: 'Steeleaf', value: 24000 },
      { name: 'Vinteum Dust', value: 32000 },
      { name: 'Mercury Cell', value: 32000 },
      { name: 'Ghast Tear', value: 50000 },
      { name: 'Quicksilver', value: 64000 },
      { name: 'Life Essence Cell', value: 100000 },
      { name: 'Aqua Shard', value: 320000 },
      { name: 'Terra Shard', value: 320000 },
      { name: 'Reinforced Slate', value: 400000 },
      { name: 'Imbued Slate', value: 1000000 },
      { name: 'Void Metal', value: 1500000 },
      { name: 'Fiery Blood', value: 2048000 },
      { name: 'Ench. Golden Apple', value: 6400000 },
      { name: 'Nether Star', value: 100000000 },
    ],
  },
  {
    id: 'naquadah',
    name: 'Naquadah Reactor',
    unit: 'item',
    tiers: [
      { name: 'Naquadah Reactor Mk-I', tier: 'EV', efficiency: 0.8 },
      { name: 'Naquadah Reactor Mk-II', tier: 'IV', efficiency: 1.0 },
      { name: 'Naquadah Reactor Mk-III', tier: 'LuV', efficiency: 1.5 },
      { name: 'Naquadah Reactor Mk-IV', tier: 'ZPM', efficiency: 2.0 },
      { name: 'Naquadah Reactor Mk-V', tier: 'UV', efficiency: 2.5 },
    ],
    fuels: [
      { name: 'Tiberium Bolt', value: 12500000 },
      { name: 'Enriched Naquadah Bolt', value: 50000000 },
      { name: 'Tiberium Rod', value: 62500000 },
      { name: 'Long Tiberium Rod', value: 125000000 },
      { name: 'Enriched Naquadah Rod', value: 250000000 },
    ],
  },
];

// one voltage tier's slice of the plan: the demand at that tier and the
// generators sized to cover it. `generator` is undefined when the chosen
// category offers no variant at this tier — those machines can't be powered by
// it (a higher-tier generator would overvolt and explode them)
export interface TierPlan {
  tier: VoltageTier;
  demand: number; // EU/t drawn by machines at this tier
  amps: number; // total amps drawn at this tier
  generator: GeneratorTier | undefined;
  count: number; // generators needed to cover this tier's demand
  ampBound: boolean; // true when amperage (not power) sets the count
  capacity: number; // count × tier output
  fuelRate: number; // fuel units/s consumed at this tier
}

export interface BankPlan {
  rows: TierPlan[]; // one per tier present, low→high
  totalCount: number;
  totalFuelRate: number;
  unpowered: VoltageTier[]; // tiers the category cannot supply
}

// size a whole generator bank for a per-tier demand. a generator may only power
// a machine of its OWN tier, so each tier bucket is solved independently against
// the matching generator variant. each generator outputs 1A, so a tier needs at
// least `amps` units — the peak single-machine amperage, which can exceed the
// power-based count when a machine draws more amps than its EU/t needs. one 1A
// generator can feed several light machines but not one that wants 2A. generators
// throttle — fuel is sized
// off the actual draw, not the rated max ("do not consume excess fuel if their
// buffer is full"): raw fuel EU/t = demand / efficiency; ÷ fuel density (×20)
export const planBank = (
  category: GeneratorCategory,
  fuel: Fuel,
  byTier: Map<VoltageTier, TierDemand>,
): BankPlan => {
  const rows: TierPlan[] = [];
  const unpowered: VoltageTier[] = [];
  let totalCount = 0;
  let totalFuelRate = 0;

  // solve low→high so the breakdown reads in tier order
  const entries = [...byTier].sort(
    ([a], [b]) => VOLTAGE_TIERS.indexOf(a) - VOLTAGE_TIERS.indexOf(b),
  );

  for (const [tier, { power, amps }] of entries) {
    if (power <= 0 && amps <= 0) continue;

    const generator = category.tiers.find(t => t.tier === tier);
    if (generator === undefined) {
      unpowered.push(tier);
      rows.push({
        tier,
        demand: power,
        amps,
        generator,
        count: 0,
        ampBound: false,
        capacity: 0,
        fuelRate: 0,
      });
      continue;
    }

    const output = TIER_EU[tier];
    const powerCount = Math.ceil(power / output);
    // each generator supplies 1A; honour whichever constraint needs more units
    const count = Math.max(powerCount, Math.ceil(amps));
    const fuelRate =
      fuel.value > 0 ? (power / generator.efficiency / fuel.value) * 20 : 0;

    rows.push({
      tier,
      demand: power,
      amps,
      generator,
      count,
      ampBound: Math.ceil(amps) > powerCount,
      capacity: count * output,
      fuelRate,
    });
    totalCount += count;
    totalFuelRate += fuelRate;
  }

  return { rows, totalCount, totalFuelRate, unpowered };
};
