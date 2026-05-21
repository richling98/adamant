import test from 'node:test';
import assert from 'node:assert/strict';
import { getFolderDropProjection, getMovedRectCenter } from './folderDndProjection.ts';
import type { FolderProjectionRow, FolderRowRect } from './folderDndProjection.ts';

const rowHeight = 28;

function rect(index: number, left = 0): FolderRowRect {
  const top = index * rowHeight;
  return {
    top,
    bottom: top + rowHeight,
    left,
    right: left + 260,
    width: 260,
    height: rowHeight,
  };
}

function rowsByParent(rows: readonly FolderProjectionRow[]) {
  const map = new Map<string | null, string[]>();
  for (const row of rows) {
    const siblings = map.get(row.parentId) ?? [];
    siblings.push(row.id);
    map.set(row.parentId, siblings);
  }
  return map;
}

function rectsFor(rows: readonly FolderProjectionRow[]) {
  return new Map(rows.map((row, index) => [row.id, rect(index)]));
}

const rows: FolderProjectionRow[] = [
  { id: 'root-a', parentId: null, depth: 0, ancestorIds: [] },
  { id: 'child-a', parentId: 'root-a', depth: 1, ancestorIds: ['root-a'] },
  { id: 'root-b', parentId: null, depth: 0, ancestorIds: [] },
  { id: 'child-b', parentId: 'root-b', depth: 1, ancestorIds: ['root-b'] },
  { id: 'grandchild-b', parentId: 'child-b', depth: 2, ancestorIds: ['root-b', 'child-b'] },
  { id: 'root-c', parentId: null, depth: 0, ancestorIds: [] },
];

test('moved rect center uses the dragged row midpoint instead of the grab point', () => {
  const activeRect = {
    top: 120,
    bottom: 148,
    left: 16,
    right: 216,
    width: 200,
    height: 28,
  };

  assert.deepEqual(getMovedRectCenter(activeRect, { x: 4, y: 20 }), {
    x: 120,
    y: 154,
  });
});

test('off-center grabs still project from the dragged row visual center', () => {
  const projection = getFolderDropProjection({
    activeFolderId: 'root-c',
    pointer: getMovedRectCenter(rect(5), { x: 0, y: rect(2).top - rect(5).top }),
    rows,
    rowRects: rectsFor(rows),
    siblingIdsByParent: rowsByParent(rows),
  });

  assert.deepEqual(projection, {
    type: 'inside',
    targetId: 'root-b',
    parentId: 'root-b',
    positionIndex: 1,
  });
});

test('root folder dropped on the center of another root folder nests inside it', () => {
  const projection = getFolderDropProjection({
    activeFolderId: 'root-c',
    pointer: { x: 90, y: rect(2).top + rowHeight / 2 },
    rows,
    rowRects: rectsFor(rows),
    siblingIdsByParent: rowsByParent(rows),
  });

  assert.deepEqual(projection, {
    type: 'inside',
    targetId: 'root-b',
    parentId: 'root-b',
    positionIndex: 1,
  });
});

test('nested folder dropped on the center of a different root folder nests inside it', () => {
  const projection = getFolderDropProjection({
    activeFolderId: 'child-a',
    pointer: { x: 90, y: rect(2).top + rowHeight / 2 },
    rows,
    rowRects: rectsFor(rows),
    siblingIdsByParent: rowsByParent(rows),
  });

  assert.deepEqual(projection, {
    type: 'inside',
    targetId: 'root-b',
    parentId: 'root-b',
    positionIndex: 1,
  });
});

test('nested folder dropped on the center of another nested folder nests at arbitrary depth', () => {
  const projection = getFolderDropProjection({
    activeFolderId: 'child-a',
    pointer: { x: 110, y: rect(4).top + rowHeight / 2 },
    rows,
    rowRects: rectsFor(rows),
    siblingIdsByParent: rowsByParent(rows),
  });

  assert.deepEqual(projection, {
    type: 'inside',
    targetId: 'grandchild-b',
    parentId: 'grandchild-b',
    positionIndex: 0,
  });
});

test('root folder dropped on the center of a nested folder nests inside it', () => {
  const projection = getFolderDropProjection({
    activeFolderId: 'root-c',
    pointer: { x: 110, y: rect(3).top + rowHeight / 2 },
    rows,
    rowRects: rectsFor(rows),
    siblingIdsByParent: rowsByParent(rows),
  });

  assert.deepEqual(projection, {
    type: 'inside',
    targetId: 'child-b',
    parentId: 'child-b',
    positionIndex: 1,
  });
});

test('root folder top and bottom zones still reorder root siblings', () => {
  const rowRects = rectsFor(rows);
  const siblingIdsByParent = rowsByParent(rows);

  assert.deepEqual(getFolderDropProjection({
    activeFolderId: 'root-c',
    pointer: { x: 90, y: rect(0).top + 2 },
    rows,
    rowRects,
    siblingIdsByParent,
  }), {
    type: 'before',
    targetId: 'root-a',
    parentId: null,
    positionIndex: 0,
  });

  assert.deepEqual(getFolderDropProjection({
    activeFolderId: 'root-a',
    pointer: { x: 90, y: rect(5).bottom - 2 },
    rows,
    rowRects,
    siblingIdsByParent,
  }), {
    type: 'after',
    targetId: 'root-c',
    parentId: null,
    positionIndex: 2,
  });
});

test('nested folder can project to root bottom', () => {
  const projection = getFolderDropProjection({
    activeFolderId: 'child-a',
    pointer: { x: 90, y: rect(5).bottom + 12 },
    rows,
    rowRects: rectsFor(rows),
    siblingIdsByParent: rowsByParent(rows),
  });

  assert.deepEqual(projection, {
    type: 'root-bottom',
    parentId: null,
    positionIndex: 3,
  });
});

test('nested folder between root row rectangles projects to that root gap', () => {
  const gapRows: FolderProjectionRow[] = [
    { id: 'root-a', parentId: null, depth: 0, ancestorIds: [] },
    { id: 'root-b', parentId: null, depth: 0, ancestorIds: [] },
    { id: 'child-b', parentId: 'root-b', depth: 1, ancestorIds: ['root-b'] },
  ];
  const rowRects = new Map<string, FolderRowRect>([
    ['root-a', { ...rect(0), top: 0, bottom: 28 }],
    ['root-b', { ...rect(0), top: 44, bottom: 72 }],
    ['child-b', { ...rect(0), top: 72, bottom: 100 }],
  ]);

  const projection = getFolderDropProjection({
    activeFolderId: 'child-b',
    pointer: { x: 90, y: 36 },
    rows: gapRows,
    rowRects,
    siblingIdsByParent: rowsByParent(gapRows),
  });

  assert.deepEqual(projection, {
    type: 'after',
    targetId: 'root-a',
    parentId: null,
    positionIndex: 1,
  });
});

test('active folder cannot be dropped into itself or its descendant', () => {
  const rowRects = rectsFor(rows);
  const siblingIdsByParent = rowsByParent(rows);

  assert.equal(getFolderDropProjection({
    activeFolderId: 'root-b',
    pointer: { x: 90, y: rect(2).top + rowHeight / 2 },
    rows,
    rowRects,
    siblingIdsByParent,
  }), null);

  assert.equal(getFolderDropProjection({
    activeFolderId: 'root-b',
    pointer: { x: 110, y: rect(4).top + rowHeight / 2 },
    rows,
    rowRects,
    siblingIdsByParent,
  }), null);
});
