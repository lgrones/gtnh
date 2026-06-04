import { type NodeProps } from '@xyflow/react';

import { type ProductionNode as IProductionNode } from '@/contexts/productionStore';

import { ProductionNode } from './productionNode';

type MachineNodeType = Extract<IProductionNode, { type: 'machineNode' }>;

export const MachineNode = (props: NodeProps<MachineNodeType>) => (
  <ProductionNode {...props} type="both" />
);

// import {
//   ActionIcon,
//   Button,
//   Group,
//   NumberInput,
//   Stack,
//   TextInput,
//   Tooltip,
// } from '@mantine/core';
// import { IconPlus, IconTrash, IconX } from '@tabler/icons-react';
// import { Position, type NodeProps } from '@xyflow/react';
// import { useShallow } from 'zustand/react/shallow';

// import { useProductionStore, type ProductionNode } from '@/contexts/productionStore';

// type MachineNodeType = Extract<ProductionNode, { type: 'machineNode' }>;

// // processing step — takes inputs (left), produces named outputs (right),
// // each output has a quantity and can be flagged as disposal (discarded)
// export const MachineNode = ({ id, data }: NodeProps<MachineNodeType>) => {
//   const { addMachineOutput, updateMachineOutput, removeMachineOutput } =
//     useProductionStore(
//       useShallow(state => ({
//         addMachineOutput: state.addMachineOutput,
//         updateMachineOutput: state.updateMachineOutput,
//         removeMachineOutput: state.removeMachineOutput,
//       })),
//     );

//   return (
//     <>
//       <EdgeHandle type="target" position={Position.Left} />

//       <NodeShell id={id} name={data.name} accent="orange">
//         <Stack gap="xs" mt="xs">
//           {data.outputs.map(output => (
//             <Group key={output.id} gap="xs" wrap="nowrap" className="nodrag">
//               <TextInput
//                 size="xs"
//                 placeholder="Item"
//                 value={output.name}
//                 onChange={event =>
//                   updateMachineOutput(id, output.id, {
//                     name: event.currentTarget.value,
//                   })
//                 }
//               />

//               <NumberInput
//                 size="xs"
//                 w={70}
//                 min={0}
//                 value={output.quantity}
//                 onChange={value =>
//                   updateMachineOutput(id, output.id, {
//                     quantity: typeof value === 'number' ? value : 0,
//                   })
//                 }
//               />

//               <Tooltip
//                 label={output.disposal ? 'Disposal output' : 'Mark as disposal'}
//               >
//                 <ActionIcon
//                   variant={output.disposal ? 'filled' : 'subtle'}
//                   color="red"
//                   onClick={() =>
//                     updateMachineOutput(id, output.id, {
//                       disposal: !output.disposal,
//                     })
//                   }
//                 >
//                   <IconTrash size={16} />
//                 </ActionIcon>
//               </Tooltip>

//               <ActionIcon
//                 variant="subtle"
//                 color="gray"
//                 onClick={() => removeMachineOutput(id, output.id)}
//               >
//                 <IconX size={16} />
//               </ActionIcon>
//             </Group>
//           ))}

//           <Button
//             size="xs"
//             variant="light"
//             leftSection={<IconPlus size={14} />}
//             onClick={() => addMachineOutput(id)}
//           >
//             Add output
//           </Button>
//         </Stack>
//       </NodeShell>

//       <EdgeHandle type="source" position={Position.Right} />
//     </>
//   );
// };
