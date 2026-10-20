const assert = require('assert/strict');
const service = require('../src/schedulePeriodService');
const { execFileSync } = require('child_process');

let passed = 0;
function test(name, fn) {
  fn();
  console.log(`[PASS] ${name}`);
  passed++;
}
const base = { now: '2026-10-20T09:00:00Z', historyStatus: 'ready', officialSchedules: [] };
const record = (startDate, endDate, extra = {}) => ({ startDate, endDate, ...extra });
const period = (startDate = '2026-10-25', weekCount = 2) => service.createPeriod({ startDate, weekCount });

test('No history: next future Sunday, explanatory reason, default two weeks', () => {
  const result = service.propose(base);
  assert.equal(result.startDate, '2026-10-25');
  assert.equal(result.weekCount, 2);
  assert.equal(result.timezone, 'Asia/Jerusalem');
  assert.match(result.explanation, /אין סידורים רשמיים/);
});
test('Past coverage and several months without scheduling skip past periods', () => {
  for (const end of ['2026-10-17', '2026-09-05', '2025-12-31']) {
    assert.equal(service.propose({ ...base, officialSchedules: [record('2025-01-01', end)] }).startDate, '2026-10-25');
  }
});
test('Latest coverage wins over savedAt and input order; archived records ignored', () => {
  const schedules = [
    record('2026-11-01', '2026-11-14', { savedAt: '2026-01-01' }),
    record('2026-10-04', '2026-10-10', { savedAt: '2026-10-20' }),
    record('2027-01-01', '2027-02-01', { status: 'archived' })
  ];
  assert.equal(service.propose({ ...base, officialSchedules: schedules }).startDate, '2026-11-15');
  assert.equal(service.propose({ ...base, officialSchedules: schedules.reverse() }).startDate, '2026-11-15');
});
test('Sunday today and Sunday coverage end both require the following Sunday', () => {
  assert.equal(service.propose({ ...base, now: '2026-10-25T09:00:00Z' }).startDate, '2026-11-01');
  assert.equal(service.propose({ ...base, officialSchedules: [record('2026-10-25', '2026-11-01')] }).startDate, '2026-11-08');
});
test('Jerusalem midnight changes the Sunday boundary while UTC is still Saturday', () => {
  assert.equal(service.today('2026-10-24T20:59:59Z'), '2026-10-24');
  assert.equal(service.today('2026-10-24T21:00:00Z'), '2026-10-25');
  assert.equal(service.propose({ ...base, now: '2026-10-24T20:59:59Z' }).startDate, '2026-10-25');
  assert.equal(service.propose({ ...base, now: '2026-10-24T21:00:00Z' }).startDate, '2026-11-01');
});
test('Both Israel DST transitions keep the correct local calendar date', () => {
  for (const instant of ['2026-03-26T23:59:59Z', '2026-03-27T00:00:00Z']) {
    assert.equal(service.today(instant), '2026-03-27');
    assert.equal(service.propose({ ...base, now: instant }).startDate, '2026-03-29');
  }
  for (const instant of ['2026-10-24T22:59:59Z', '2026-10-24T23:00:00Z']) {
    assert.equal(service.today(instant), '2026-10-25');
    assert.equal(service.propose({ ...base, now: instant }).startDate, '2026-11-01');
  }
});
test('Month/year boundaries and leap day produce consecutive seven-day weeks', () => {
  assert.deepEqual(service.getWeeks(period('2026-12-27')), [
    { start: '2026-12-27', end: '2027-01-02' },
    { start: '2027-01-03', end: '2027-01-09' }
  ]);
  assert.equal(service.getWeeks(period('2028-02-27', 1))[0].end, '2028-03-04');
  assert.equal(service.propose({ ...base, now: '2026-12-31T18:00:00Z' }).startDate, '2027-01-03');
});
test('Invalid dates, non-Sundays and invalid counts fail instead of rolling over', () => {
  for (const date of ['', '2026-02-29', '2026-02-31', '2026-13-01', '2026-1-04', '2026-10-26']) {
    assert.throws(() => period(date));
  }
  for (const count of [0, 9, -1, 1.5, NaN, Infinity, '', '2.5', '2e0', null, true]) {
    assert.throws(() => period('2026-10-25', count));
  }
  for (const count of [1, 8, '1', '8']) assert.equal(service.getWeeks(period('2026-10-25', count)).length, Number(count));
});
test('Manual override may precede future coverage, but must be future and use replacement on overlap', () => {
  const history = [record('2026-11-08', '2026-11-21')];
  assert.equal(service.validate(period('2026-10-25', 1), { ...base, officialSchedules: history }).valid, true);
  assert.equal(service.validate(period('2026-10-18'), base).valid, false);
  assert.equal(service.validate(period('2026-10-25'), { ...base, now: '2026-10-25T06:00:00Z' }).valid, false);
  assert.equal(service.validate(period('2026-11-15', 1), { ...base, officialSchedules: history }).valid, false);
  assert.equal(service.validate(period('2026-11-15', 1), { ...base, officialSchedules: history, allowOverlap: true }).overlaps.length, 1);
});
test('Overlap includes exact IDs, contained ranges and boundary dates; adjacent periods are safe', () => {
  const proposed = period('2026-10-25', 1);
  const history = [record('2026-10-25', '2026-10-31', { id: 'same' }),
    record('2026-10-31', '2026-11-07'), record('2026-10-20', '2026-10-25'),
    record('2026-10-26', '2026-10-27'), record('2026-11-01', '2026-11-07'),
    record('2026-10-25', '2026-10-31', { status: 'archived' })];
  assert.equal(service.findOverlaps(proposed, history).length, 4);
});
test('Loading/failed/malformed history never becomes empty history', () => {
  for (const historyStatus of ['loading', 'error', undefined]) {
    assert.throws(() => service.propose({ ...base, historyStatus }));
    assert.equal(service.validate(period(), { ...base, historyStatus }).valid, false);
  }
  for (const history of [null, {}, [record('2026-02-31', '2026-03-07')], [record('2026-10-30', '2026-10-01')]]) {
    assert.throws(() => service.propose({ ...base, officialSchedules: history }));
  }
});
test('Week start is an explicit service setting for future configuration', () => {
  const result = service.propose({ ...base, weekStartsOn: 1 });
  assert.equal(result.startDate, '2026-10-26');
  assert.equal(service.getWeeks(result)[0].end, '2026-11-01');
});
test('Results do not depend on the device timezone', () => {
  const script = `const s=require('./src/schedulePeriodService');console.log(JSON.stringify([s.propose(${JSON.stringify(base)}),s.getWeeks(s.createPeriod({startDate:'2026-10-18',weekCount:2}))]));`;
  const results = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Jerusalem'].map(TZ =>
    execFileSync(process.execPath, ['-e', script], { cwd: require('path').resolve(__dirname, '..'), env: { ...process.env, TZ }, encoding: 'utf8' }));
  assert.equal(new Set(results).size, 1);
});
console.log(`Schedule period: ${passed} passed`);
