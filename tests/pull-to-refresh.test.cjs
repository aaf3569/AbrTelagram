const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../Teachers/pull-to-refresh.js'), 'utf8');

function setup() {
  const events = {};
  const classes = new Set();
  const styles = {};
  let reloads = 0;
  let pending;
  const state = { phone: true, overlay: false, scrollTop: 0 };
  const body = { classList: { contains: () => false }, append() {} };
  const target = { parentElement: body, scrollHeight: 500, clientHeight: 300, scrollTop: 0, closest: () => null };
  const indicator = {
    setAttribute() {}, querySelector: () => ({ textContent: '' }),
    style: { setProperty: (key, value) => { styles[key] = value; } },
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name)
    }
  };
  vm.runInNewContext(source, {
    document: { body, scrollingElement: state, createElement: () => indicator,
      querySelector: () => state.overlay ? {} : null,
      addEventListener: (name, fn) => { events[name] = fn; } },
    window: { matchMedia: () => ({ get matches() { return state.phone; } }),
      location: { reload: () => reloads++ }, setTimeout: fn => { pending = fn; }, addEventListener() {} },
    getComputedStyle: () => ({ overflowY: 'auto' }), clearTimeout() {}
  });
  function fire(name, x = 0, y = 0, count = 1) {
    let prevented = false;
    events[name]({ target, touches: Array.from({ length: count }, () => ({ clientX: x, clientY: y })),
      cancelable: true, preventDefault() { prevented = true; } });
    return prevented;
  }
  return { state, target, classes, styles, fire, finish: () => pending?.(), reloads: () => reloads };
}

test('ring follows pull distance and only a complete pull reloads once on release', () => {
  const app = setup();
  app.fire('touchstart');
  assert.equal(app.fire('touchmove', 0, 56), true);
  assert.equal(app.styles['--refresh-progress'], .5);
  app.fire('touchend'); app.finish();
  assert.equal(app.reloads(), 0);
  app.fire('touchstart'); app.fire('touchmove', 0, 130);
  assert.ok(app.classes.has('is-ready'));
  assert.equal(app.reloads(), 0);
  app.fire('touchend'); app.fire('touchend'); app.finish();
  assert.equal(app.reloads(), 1);
});

test('scrolling, horizontal swipes, overlays, desktop, pinch and cancellation do not refresh', () => {
  for (const mode of ['scroll', 'nested', 'horizontal', 'overlay', 'desktop', 'pinch', 'cancel', 'retreat']) {
    const app = setup();
    if (mode === 'scroll') app.state.scrollTop = 30;
    if (mode === 'nested') app.target.scrollTop = 30;
    if (mode === 'overlay') app.state.overlay = true;
    if (mode === 'desktop') app.state.phone = false;
    app.fire('touchstart');
    const prevented = app.fire('touchmove', mode === 'horizontal' ? 180 : 0, 130, mode === 'pinch' ? 2 : 1);
    if (!['cancel', 'retreat'].includes(mode)) assert.equal(prevented, false, mode);
    if (mode === 'cancel') app.fire('touchcancel');
    if (mode === 'retreat') app.fire('touchmove', 0, 30);
    app.fire('touchend'); app.finish();
    assert.equal(app.reloads(), 0, mode);
  }
});
