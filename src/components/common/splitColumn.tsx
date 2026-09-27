import { Splitter } from '@mantine/core';

import classes from './splitColumn.module.css';

// the gap between the panels is the splitter's line: all of it is draggable,
// and it is the same size as the padding around the column
const LINE_SIZE = 16;

// no panel may be dragged smaller than its own head and a row or two — a column
// of two stubs is worse than an uneven one
const MIN_PERCENT = 15;

interface SplitColumnProps {
  // share of the column's height given to the top panel, 0–100
  topSize: number;
  onTopSizeChange: (size: number) => void;
  // padding and the like — the column owns its rows, the caller owns its place
  className?: string;
  top: React.ReactNode;
  bottom: React.ReactNode;
}

// A column of two panels the user can re-divide by dragging the gap between
// them. The size is the caller's, because it outlives the drag: it is a view
// preference kept per browser (see contexts/viewPrefs).
export const SplitColumn = ({
  topSize,
  onTopSizeChange,
  className,
  top,
  bottom,
}: SplitColumnProps) => (
  <Splitter
    orientation="vertical"
    h="100%"
    className={className}
    classNames={{ pane: classes.pane }}
    lineSize={LINE_SIZE}
    sizes={[topSize, 100 - topSize]}
    // only the top panel's share is stored; the bottom's is the remainder
    onSizeChange={sizes => onTopSizeChange(sizes[0] ?? topSize)}
  >
    {/* defaultSize is required but never used: the sizes are controlled */}
    <Splitter.Pane defaultSize={50} min={MIN_PERCENT}>
      {top}
    </Splitter.Pane>

    <Splitter.Pane defaultSize={50} min={MIN_PERCENT}>
      {bottom}
    </Splitter.Pane>
  </Splitter>
);
