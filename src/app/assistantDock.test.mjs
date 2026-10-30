import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundedSize, fitWorkspaceDocks, normalizeDockPosition, workspaceDockGrid } from './assistantDock.ts';

const base = { width: 1100, height: 684, railWidth: 48, sidebarWidth: 288, panelWidth: 360, panelHeight: 320, sidebar: true, panel: true, position: 'right' };
const grid = (position, extra = {}) => workspaceDockGrid({ rail: true, sidebar: true, panel: true, position, sizes: fitWorkspaceDocks({ ...base, position, ...extra }) });

test('existing installations default to the right and invalid stored values are bounded', () => {
  for (const value of [null, undefined, '', 'top', {}, 1]) assert.equal(normalizeDockPosition(value), 'right');
  assert.equal(normalizeDockPosition('left'), 'left');
  assert.equal(normalizeDockPosition('bottom'), 'bottom');
  assert.equal(boundedSize(Infinity, 280, 640), 280);
  assert.equal(boundedSize(-1, 280, 640), 280);
  assert.equal(boundedSize(9999, 280, 640), 640);
});

test('side docks are placed on the requested side of the same main area', () => {
  assert.equal(grid('right').gridTemplateAreas, '"rail sidebar sidebar-resizer main dock-resizer dock"');
  assert.equal(grid('left').gridTemplateAreas, '"rail sidebar sidebar-resizer dock dock-resizer main"');
  assert.equal(grid('left').gridTemplateRows, 'minmax(0, 1fr)');
});

test('bottom dock stays below the main area while navigation spans the full height', () => {
  assert.equal(grid('bottom').gridTemplateAreas, '"rail sidebar sidebar-resizer main" "rail sidebar sidebar-resizer dock-resizer" "rail sidebar sidebar-resizer dock"');
  assert.equal(grid('bottom').gridTemplateRows, 'minmax(0, 1fr) 1px 320px');
});

test('supported window sizes keep a usable main surface even with oversized preferences', () => {
  for (const width of [960, 1100, 1440, 1920]) for (const position of ['left', 'right', 'bottom']) {
    const sizes = fitWorkspaceDocks({ ...base, width, position, sidebarWidth: 820, panelWidth: 640, panelHeight: 600 });
    const used = 48 + (sizes.showSidebar ? sizes.sidebarWidth + 1 : 0) + (position !== 'bottom' ? sizes.panelWidth + 1 : 0);
    assert(width - used >= 320);
    assert(sizes.panelHeight <= base.height - 201);
    assert(sizes.panelWidth <= 640);
  }
});

test('narrow windows temporarily hide the primary sidebar and restore it when room returns', () => {
  const narrow = fitWorkspaceDocks({ ...base, width: 720 });
  assert.equal(narrow.showSidebar, false);
  assert(720 - 48 - narrow.panelWidth - 1 >= 320);
  assert.equal(fitWorkspaceDocks(base).showSidebar, true);
  assert.equal(fitWorkspaceDocks(base).sidebarWidth, 288);
  assert.equal(base.sidebarWidth, 288);
});

test('closing the auxiliary dock releases both its track and divider', () => {
  const sizes = fitWorkspaceDocks({ ...base, panel: false });
  for (const position of ['left', 'right', 'bottom']) {
    const result = workspaceDockGrid({ rail: true, sidebar: true, panel: false, position, sizes });
    assert.equal(result.gridTemplateAreas, '"rail sidebar sidebar-resizer main"');
    assert.equal(result.gridTemplateRows, 'minmax(0, 1fr)');
  }
});

test('zen and fullscreen layouts retain only the main surface', () => {
  const sizes = fitWorkspaceDocks({ ...base, sidebar: false, panel: false, railWidth: 0 });
  const result = workspaceDockGrid({ rail: false, sidebar: false, panel: false, position: 'bottom', sizes });
  assert.equal(result.gridTemplateAreas, '"main"');
  assert.equal(result.gridTemplateColumns, 'minmax(0, 1fr)');
});
