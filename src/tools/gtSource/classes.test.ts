import { describe, expect, it } from 'vitest';

import {
  anonymousBody,
  callSites,
  constants,
  fieldAssignments,
  localDeclarations,
  methodBody,
  parseJavaFile,
  returnExpressions,
} from './classes';

// A cut-down Electric Blast Furnace: every shape the block extractor has to
// cope with, in the arrangement GT actually uses. The builder chain is inside
// an anonymous ProcessingLogic, the calculator setters are inside an override
// within that, and checkMachine clears the heat field before assigning it.
const EBF = `
package gregtech.common.tileentities.machines.multi;

public class MTEElectricBlastFurnace extends MTEEnhancedMultiBlockBase<MTEElectricBlastFurnace>
    implements ISurvivalConstructable {

    private static final int CASING_INDEX = 11;
    private int mHeatingCapacity = 0;

    @Override
    protected ProcessingLogic createProcessingLogic() {
        return new ProcessingLogic() {

            @Override
            protected OverclockCalculator createOverclockCalculator(GTRecipe recipe) {
                return super.createOverclockCalculator(recipe).setRecipeHeat(recipe.mSpecialValue)
                    .setMachineHeat(mHeatingCapacity)
                    .setHeatOC(true)
                    .setHeatDiscount(true);
            }
        };
    }

    @Override
    public boolean checkMachine(IGregTechTileEntity te, ItemStack stack) {
        this.mHeatingCapacity = 0;
        this.mHeatingCapacity = (int) getCoilLevel().getHeat() + 100 * (GTUtility.getTier(getMaxInputVoltage()) - 2);
        return true;
    }

    @Override
    public int getMaxParallelRecipes() {
        return (8 * GTUtility.getTier(this.getMaxInputVoltage()));
    }
}
`;

const file = parseJavaFile('MTEElectricBlastFurnace.java', EBF);
const [klass] = file.classes;

describe('reading a class header', () => {
  it('finds the class, its package and its superclass', () => {
    expect(klass).toMatchObject({
      name: 'MTEElectricBlastFurnace',
      fqn: 'gregtech.common.tileentities.machines.multi.MTEElectricBlastFurnace',
      superName: 'MTEEnhancedMultiBlockBase',
      isAbstract: false,
    });
  });

  it('steps over the generic parameter list to reach `extends`', () => {
    // `class Foo<T extends Bar<T>> extends Baz` has two `extends`, and only the
    // second one is the superclass
    const generic = parseJavaFile(
      'x.java',
      'public abstract class MTEExtendedPowerMultiBlockBase<T extends MTEEnhancedMultiBlockBase<T>> extends MTEEnhancedMultiBlockBase<T> {}',
    );
    expect(generic.classes[0]).toMatchObject({
      superName: 'MTEEnhancedMultiBlockBase',
      isAbstract: true,
    });
  });
});

describe('finding a method body', () => {
  it('takes the body by matching braces, not by line', () => {
    const body = methodBody(klass!, 'getMaxParallelRecipes');
    expect(returnExpressions(body?.text ?? '')).toEqual([
      '(8 * GTUtility.getTier(this.getMaxInputVoltage()))',
    ]);
  });

  it('answers undefined for a method the class does not declare', () => {
    expect(methodBody(klass!, 'getPollutionPerSecond')).toBeUndefined();
  });
});

describe('finding the builder chain', () => {
  it('reaches inside the anonymous ProcessingLogic', () => {
    const logic = methodBody(klass!, 'createProcessingLogic');
    const inner = anonymousBody(logic?.text ?? '', 'ProcessingLogic');
    expect(inner).toContain('setHeatOC(true)');
  });

  it('splits each setter’s arguments', () => {
    const logic = methodBody(klass!, 'createProcessingLogic');
    const sites = callSites(logic?.text ?? '', [
      'setMachineHeat',
      'setRecipeHeat',
      'setHeatOC',
    ]);
    expect(
      Object.fromEntries(sites.map(site => [site.name, site.args])),
    ).toEqual({
      setRecipeHeat: ['recipe.mSpecialValue'],
      setMachineHeat: ['mHeatingCapacity'],
      setHeatOC: ['true'],
    });
  });

  it('does not mistake a declaration for a call', () => {
    const declaration =
      'public ProcessingLogic setMaxParallel(int maxParallel) { return this; }';
    expect(callSites(declaration, ['setMaxParallel'])).toEqual([]);
  });
});

describe('class-level values', () => {
  it('folds static final integers', () => {
    expect(constants(klass!)).toEqual({ CASING_INDEX: 11 });
  });

  it('keeps only the meaningful assignment to a field', () => {
    // checkMachine clears the field first; that `= 0` says nothing
    expect(fieldAssignments(klass!, 'mHeatingCapacity')).toEqual([
      '(int) getCoilLevel().getHeat() + 100 * (GTUtility.getTier(getMaxInputVoltage()) - 2)',
    ]);
  });
});

describe('method locals', () => {
  // MTEIndustrialMacerator, verbatim: the return says nothing without them
  const macerator = `
        final long tVoltage = getMaxInputVoltage();
        final byte tTier = (byte) Math.max(1, GTUtility.getTier(tVoltage));
        return Math.max(1, (controllerTier == 1 ? 2 : 8) * tTier);
  `;

  it('reads every declaration, not only the first', () => {
    expect(localDeclarations(macerator)).toEqual({
      tVoltage: 'getMaxInputVoltage()',
      tTier: '(byte) Math.max(1, GTUtility.getTier(tVoltage))',
    });
  });

  it('drops a local that is assigned again', () => {
    // resolving this to 1 would be a plausible wrong number, which is the one
    // thing the extractor may not produce
    const branching = `
        int parallels = 1;
        if (mMode == 1) parallels = 8;
        return parallels;
    `;
    expect(localDeclarations(branching)).toEqual({});
  });

  it('drops a local declared twice', () => {
    const twice = `
        if (a) { int n = 2; return n; }
        int n = 8;
        return n;
    `;
    expect(localDeclarations(twice)).toEqual({});
  });

  it('ignores a for-loop counter and an object local', () => {
    const loop = `
        MTEHatch best = null;
        for (int i = 0; i < mEnergyHatches.size(); i++) { }
        return 1;
    `;
    expect(localDeclarations(loop)).toEqual({});
  });
});
