export type FolderProjectionRow = {
  id: string;
  parentId: string | null;
  depth: number;
  ancestorIds: string[];
};

export type FolderRowRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

export type PointerPosition = {
  x: number;
  y: number;
};

export type DragDelta = {
  x: number;
  y: number;
};

export type FolderDropProjection =
  | { type: 'before' | 'after' | 'inside'; targetId: string; parentId: string | null; positionIndex: number }
  | { type: 'root-bottom'; parentId: null; positionIndex: number };

type ProjectionInput = {
  activeFolderId: string;
  pointer: PointerPosition;
  rows: readonly FolderProjectionRow[];
  rowRects: ReadonlyMap<string, FolderRowRect>;
  siblingIdsByParent: ReadonlyMap<string | null, readonly string[]>;
};

const TOP_ZONE_RATIO = 0.22;
const BOTTOM_ZONE_RATIO = 0.78;

export function getMovedRectCenter(rect: FolderRowRect, delta: DragDelta): PointerPosition {
  return {
    x: rect.left + rect.width / 2 + delta.x,
    y: rect.top + rect.height / 2 + delta.y,
  };
}

function siblingInsertionIndex(
  siblingIdsByParent: ReadonlyMap<string | null, readonly string[]>,
  parentId: string | null,
  targetFolderId: string,
  placement: 'before' | 'after',
  activeFolderId: string,
) {
  const siblings = (siblingIdsByParent.get(parentId) ?? []).filter((id) => id !== activeFolderId);
  const targetIndex = siblings.indexOf(targetFolderId);
  if (targetIndex < 0) return null;
  return placement === 'before' ? targetIndex : targetIndex + 1;
}

function childInsertionIndex(
  siblingIdsByParent: ReadonlyMap<string | null, readonly string[]>,
  parentId: string,
  activeFolderId: string,
) {
  return (siblingIdsByParent.get(parentId) ?? []).filter((id) => id !== activeFolderId).length;
}

function parentIsInsideActiveSubtree(
  parentId: string | null,
  activeFolderId: string,
  rowsById: ReadonlyMap<string, FolderProjectionRow>,
) {
  if (!parentId) return false;
  if (parentId === activeFolderId) return true;
  return rowsById.get(parentId)?.ancestorIds.includes(activeFolderId) ?? false;
}

function projectSiblingPlacement(
  row: FolderProjectionRow,
  placement: 'before' | 'after',
  input: ProjectionInput,
  rowsById: ReadonlyMap<string, FolderProjectionRow>,
): FolderDropProjection | null {
  if (row.id === input.activeFolderId) return null;
  if (parentIsInsideActiveSubtree(row.parentId, input.activeFolderId, rowsById)) return null;

  const positionIndex = siblingInsertionIndex(
    input.siblingIdsByParent,
    row.parentId,
    row.id,
    placement,
    input.activeFolderId,
  );

  return positionIndex === null
    ? null
    : { type: placement, targetId: row.id, parentId: row.parentId, positionIndex };
}

function projectInsidePlacement(
  row: FolderProjectionRow,
  input: ProjectionInput,
): FolderDropProjection | null {
  if (row.id === input.activeFolderId) return null;
  if (row.ancestorIds.includes(input.activeFolderId)) return null;

  return {
    type: 'inside',
    targetId: row.id,
    parentId: row.id,
    positionIndex: childInsertionIndex(input.siblingIdsByParent, row.id, input.activeFolderId),
  };
}

export function getFolderDropProjection(input: ProjectionInput): FolderDropProjection | null {
  const rowsById = new Map(input.rows.map((row) => [row.id, row]));
  const activeRect = input.rowRects.get(input.activeFolderId);
  if (
    activeRect &&
    input.pointer.y >= activeRect.top &&
    input.pointer.y <= activeRect.bottom
  ) {
    return null;
  }

  const measuredRows = input.rows
    .filter((row) => row.id !== input.activeFolderId)
    .map((row) => ({ row, rect: input.rowRects.get(row.id) }))
    .filter((item): item is { row: FolderProjectionRow; rect: FolderRowRect } => Boolean(item.rect))
    .sort((a, b) => a.rect.top - b.rect.top);

  if (measuredRows.length === 0) return null;

  for (const { row, rect } of measuredRows) {
    if (input.pointer.y < rect.top || input.pointer.y > rect.bottom) continue;

    const relativeY = input.pointer.y - rect.top;
    if (relativeY < rect.height * TOP_ZONE_RATIO) {
      return projectSiblingPlacement(row, 'before', input, rowsById);
    }

    if (relativeY > rect.height * BOTTOM_ZONE_RATIO) {
      return projectSiblingPlacement(row, 'after', input, rowsById);
    }

    return projectInsidePlacement(row, input);
  }

  const first = measuredRows[0];
  const last = measuredRows[measuredRows.length - 1];

  if (input.pointer.y < first.rect.top) {
    return projectSiblingPlacement(first.row, 'before', input, rowsById);
  }

  if (input.pointer.y > last.rect.bottom) {
    const rootSiblingCount = (input.siblingIdsByParent.get(null) ?? [])
      .filter((id) => id !== input.activeFolderId)
      .length;
    return { type: 'root-bottom', parentId: null, positionIndex: rootSiblingCount };
  }

  let closestBoundary:
    | { row: FolderProjectionRow; placement: 'before' | 'after'; distance: number }
    | null = null;

  for (const { row, rect } of measuredRows) {
    const topDistance = Math.abs(input.pointer.y - rect.top);
    if (!closestBoundary || topDistance < closestBoundary.distance) {
      closestBoundary = { row, placement: 'before', distance: topDistance };
    }

    const bottomDistance = Math.abs(input.pointer.y - rect.bottom);
    if (!closestBoundary || bottomDistance < closestBoundary.distance) {
      closestBoundary = { row, placement: 'after', distance: bottomDistance };
    }
  }

  return closestBoundary
    ? projectSiblingPlacement(closestBoundary.row, closestBoundary.placement, input, rowsById)
    : null;
}
