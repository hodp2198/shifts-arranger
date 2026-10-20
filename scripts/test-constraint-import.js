const assert = require('assert/strict');
const service = require('../src/constraintImportService');
const dates = require('../src/schedulePeriodService');
const period = dates.createPeriod({ startDate: '2026-10-25', weekCount: 2 });
const workers = ['הוד', 'אשרקת', 'דניאל', 'סיואר', 'הדס', 'יהלי', 'נעמי', 'שדא'].map(name => ({ name, aliases: name === 'סיואר' ? ['סיוואר'] : [] }));

// Column order, staggered header positions, missing cells, Daniel's Oct 25 first
// block and Hod's election-day note reproduce the supplied screenshot layout.
// Daniel's small second header remains a representative malformed range.
// Header dates are informational only; all blocks map by sequence.
// Weekday cells reflect the audited screenshot codex-clipboard-06fdfc16:
// Daniel week-2 Tuesday blocked; Yahli week-2 Tuesday/Saturday open;
// Naomi both Sundays available; Shada Tuesdays open, Wednesdays/Thursdays blocked.
function screenshotRows(danielSecond = '10.11-8.12', election = true) {
  const columns = [
    ['הוד', 'תאריך:18-24.10', '', "א' - לא יכול", "ב' -", "ג' -", "ד' -", "ה' -", 'שבת -', '', '', 'תאריך:25-31.10', '', "א' -", "ב' -", election ? "ג' - יום בחירות" : "ג' -", "ד' -", "ה' -", 'שבת -'],
    ['אשרקת', 'תאריך:18-24.10', "א' -", "ב' -", "ג' -", "ד' -", "ה' -", 'שבת -', '', '', '', 'תאריך:25-31.10', '', "א' - לא יכולה", "ב' -", "ג' -", "ד' -", "ה' -", 'שבת -'],
    ['דניאל', 'תאריך:25-31.10', "א' - לא יכול", "ב' - יכול", "ג' - יכול", "ד' - לא יכול", "ה' - יכול", 'שבת - יכול', '', `תאריך: ${danielSecond}`, "א' - לא יכול", "ב' - יכול", "ג' - לא יכול", "ד' - לא יכול", "ה' - יכול", 'שבת - יכול'],
    ['סיוואר'],
    ['הדס', 'תאריך:18-24.10', "א' -", "ב' -", "ג' - לא יכולה", "ד' - לא יכולה", "ה' -", 'שבת - לא יכולה', '', 'תאריך:25-31.10', "א' -", "ב' - לא יכולה", "ג' -", "ד' - לא יכולה", "ה' -", 'שבת -'],
    ['יהלי', 'תאריך:18-24.10', "א' - לא יכולה", "ב' - לא יכולה", "ג' - לא יכולה", "ד' - לא יכולה", "ה' - לא יכולה", 'שבת -', '', '', 'תאריך:25-31.10', "א' - לא יכולה", "ב' - לא יכולה", "ג' -", "ד' - לא יכולה", "ה' - לא יכולה", 'שבת -'],
    ['נעמי', 'תאריך:18-24.10', 'א- פנויה', 'ב- פנויה', 'ג- לא פנויה', 'ד- לא פנויה', 'ה- לא פנויה', 'ש- לא פנויה', '', 'תאריך:25-31.10', 'א- פנויה', 'ב- לא פנויה', 'ג- פנויה', 'ד- לא פנויה', 'ה- לא פנויה', 'ש- לא פנויה'],
    ['שדא', 'תאריך:18-24.10', "א' - לא יכולה", "ב' -", "ג' -", "ד' - לא יכולה", "ה' - לא יכולה", 'שבת -', '', 'תאריך:25-31.10', "א' - לא יכולה", "ב' -", "ג' -", "ד' - לא יכולה", "ה' - לא יכולה", 'שבת -']
  ];
  return Array.from({ length: Math.max(...columns.map(column => column.length)) }, (_, row) => columns.map(column => column[row] || ''));
}
function parse(rows, options = {}) {
  const chosen = options.period || period;
  return service.interpret({ workers, period: chosen, sources: [{ rawText: rows.map(row => row.join('\t')).join('\n'), rowsJson: JSON.stringify(rows), anchorPeriod: chosen }], ...options }, dates);
}
const find = (plan, workerName, date) => plan.applied.find(record => record.workerName === workerName && record.date === date);

function run() {
  let passed = 0;
  function test(name, fn) { fn(); console.log('[PASS] ' + name); passed++; }
  test('Actual screenshot layout maps both blocks for Daniel, Hod and Naomi without date warnings', () => {
    const plan = parse(screenshotRows());
    assert.equal(plan.version, 3); assert.equal(plan.mappingMode, 'block-sequence');
    assert.equal(plan.issues.length, 0);
    assert.equal(plan.employees.length, 8);
    assert.equal(find(plan,'דניאל','2026-11-01').status,'unavailable');
    assert.equal(find(plan,'דניאל','2026-11-04').status,'unavailable');
    assert.equal(find(plan,'הוד','2026-10-25').status,'unavailable');
    assert.equal(find(plan,'הוד','2026-11-03').status,'available');
    assert(plan.notes.some(n=>n.workerName==='הוד'&&n.date==='2026-11-03'&&n.text==='יום בחירות'));
    assert.equal(find(plan,'נעמי','2026-10-31').status,'unavailable');
    assert.equal(find(plan,'נעמי','2026-11-07').status,'unavailable');
  });
  test('Employee matching survives reordered columns, whitespace and aliases', () => {
    const rows=screenshotRows();const shuffled=rows.map(r=>[r[7],r[2],r[0],r[6],r[4],r[3],r[5],r[1]]);
    shuffled[0][2]=' ה ו ד ';
    const entries=p=>p.applied.map(e=>[e.workerName,e.date,e.status].join('|')).sort();
    assert.deepEqual(entries(parse(rows)),entries(parse(shuffled)));
  });
  test('Audited Daniel entries keep Tuesday available in week 1 and blocked in week 2', () => {
    const plan = parse(screenshotRows());
    for (const [date, status, raw, blockNumber] of [
      ['2026-10-27', 'available', "ג' - יכול", 1],
      ['2026-11-03', 'unavailable', "ג' - לא יכול", 2]
    ]) {
      assert.equal(find(plan, 'דניאל', date).status, status, date);
      assert(plan.records.some(entry => entry.workerName === 'דניאל' && entry.date === date && entry.raw === raw && entry.blockNumber === blockNumber));
    }
  });
  test('Audited Yahli second block preserves all six exact weekday entries', () => {
    const plan = parse(screenshotRows());
    for (const [date, status, raw] of [
      ['2026-11-01', 'unavailable', "א' - לא יכולה"],
      ['2026-11-02', 'unavailable', "ב' - לא יכולה"],
      ['2026-11-03', 'available', "ג' -"],
      ['2026-11-04', 'unavailable', "ד' - לא יכולה"],
      ['2026-11-05', 'unavailable', "ה' - לא יכולה"],
      ['2026-11-07', 'available', 'שבת -']
    ]) {
      assert.equal(find(plan, 'יהלי', date).status, status, date);
      assert(plan.records.some(entry => entry.workerName === 'יהלי' && entry.date === date && entry.raw === raw && entry.blockNumber === 2));
    }
  });
  test('Audited Naomi is explicitly available both Sundays and blocked both Saturdays', () => {
    const plan = parse(screenshotRows());
    for (const date of ['2026-10-25', '2026-11-01']) {
      assert.equal(find(plan, 'נעמי', date).status, 'available', date);
      assert(plan.records.some(entry => entry.workerName === 'נעמי' && entry.date === date && entry.raw === 'א- פנויה'));
    }
    for (const date of ['2026-10-31', '2026-11-07']) {
      assert.equal(find(plan, 'נעמי', date).status, 'unavailable', date);
      assert(plan.records.some(entry => entry.workerName === 'נעמי' && entry.date === date && entry.raw === 'ש- לא פנויה'));
    }
  });
  test('Audited Shada has open Tuesdays and blocked Wednesdays and Thursdays in both blocks', () => {
    const plan = parse(screenshotRows());
    for (const [date, status, raw] of [
      ['2026-10-27', 'available', "ג' -"],
      ['2026-10-28', 'unavailable', "ד' - לא יכולה"],
      ['2026-10-29', 'unavailable', "ה' - לא יכולה"],
      ['2026-11-03', 'available', "ג' -"],
      ['2026-11-04', 'unavailable', "ד' - לא יכולה"],
      ['2026-11-05', 'unavailable', "ה' - לא יכולה"]
    ]) {
      assert.equal(find(plan, 'שדא', date).status, status, date);
      assert(plan.records.some(entry => entry.workerName === 'שדא' && entry.date === date && entry.raw === raw));
    }
  });
  test('Malformed, inconsistent, outdated and numbered headers only delimit blocks', () => {
    for (const label of ['תאריך: טעות','31/02/1999 - 88/14/2001','שבוע 7','10.11-8.12','18-24.10','2020-01-01 - 2020-02-01']) {
      const plan=parse([['דניאל'],[label],["א' - לא יכול"],['תאריך: ???'],["ד' - לא יכול"]]);
      assert.equal(plan.issues.length,0,label);
      assert.equal(find(plan,'דניאל','2026-10-25').status,'unavailable');
      assert.equal(find(plan,'דניאל','2026-11-04').status,'unavailable');
    }
  });
  test('Different employee block counts require no padding or alignment by row', () => {
    const plan=parse([['הוד','דניאל'],['תאריך: ישן',''],["א' - לא יכול",'תאריך: טעות'],['',"ב' - לא יכול"],['','תאריך: טעות נוספת'],['',"ש - לא יכול"]]);
    assert.equal(plan.issues.length,0);
    assert(!find(plan,'הוד','2026-11-01'));
    assert.equal(find(plan,'דניאל','2026-11-07').status,'unavailable');
  });
  test('Saturday aliases ש, ש׳, ש apostrophe, שבת and יום שבת map identically', () => {
    for(const day of ['ש','ש׳',"ש'",'שבת','יום שבת']) assert.equal(parse([['נעמי'],['תאריך: ישן'],[day+' - לא פנויה']]).applied[0].date,'2026-10-31');
  });
  test('Neutral comments use default availability and preserve notes; explicit negatives remain blocked', () => {
    for(const text of ['יום בחירות','יום הולדת']) {
      const plan=parse([['הוד'],['תאריך: ישן'],["ג' - "+text]]);
      assert.equal(plan.issues.length,0);assert.equal(find(plan,'הוד','2026-10-27').status,'available');assert.equal(plan.notes[0].text,text);
    }
    for(const text of ['לא יכול - יום בחירות','אין לי אפשרות - יום בחירות','לא יכול יום בחירות']) {
      const plan=parse([['הוד'],['תאריך: ישן'],["ג' - "+text]]);
      assert.equal(find(plan,'הוד','2026-10-27').status,'unavailable');assert(plan.notes.length);
    }
  });
  test('Ambiguous availability and partial shift restrictions still block', () => {
    for(const text of ['אולי','יכול אחרי 18:00','רק נייט 2','יכול ולא יכול']) {
      const plan=parse([['הוד'],['תאריך: ישן'],["א' - "+text]]);assert.equal(plan.issues.length,1,text);assert.equal(plan.applied.length,0,text);
    }
  });
  test('Weekday labels determine dates even when weekdays are not in row order', () => {
    const plan=parse([['הוד'],['תאריך: 18-24.10'],["ד' - לא יכול"],["א' - לא יכול"]]);
    assert.equal(plan.issues.length,0);assert(find(plan,'הוד','2026-10-28'));assert(find(plan,'הוד','2026-10-25'));
  });
  test('Headerless complete weekday cycles establish consecutive blocks', () => {
    const plan=parse([['הוד'],["א' - לא יכול"],['שבת -'],["א' - לא יכול"]]);
    assert.equal(plan.issues.length,0);assert(find(plan,'הוד','2026-11-01'));
  });
  test('Unclear repeated days require an explicit block number instead of guessing', () => {
    const rows=[['הוד'],["ב' - לא יכול"],["ב' - יכול"]];const p=parse(rows);
    assert.equal(p.issues[0].type,'block');
    const resolved=parse(rows,{resolutions:{[p.issues[0].id]:{blockNumber:2}}});
    assert.equal(resolved.issues.length,0);assert.equal(find(resolved,'הוד','2026-11-02').status,'available');
    assert.equal(parse(rows,{resolutions:{[p.issues[0].id]:{action:'defer'}}}).issues[0].type,'block');
  });
  test('Consecutive empty headers require review, but split label/date is one header', () => {
    assert.equal(parse([['הוד'],['תאריך: ישן'],['תאריך: אחר'],["א' - לא יכול"]]).issues[0].type,'block');
    const p=parse([['הוד'],["תאריך:\n18-24.10\nא' - לא יכול"]]);assert.equal(p.issues.length,0);assert(find(p,'הוד','2026-10-25'));
  });
  test('Unknown weekday labels require manager weekday selection', () => {
    const rows=[['הוד'],['תאריך: ישן'],['ז - לא יכול']];const p=parse(rows);
    assert.equal(p.issues[0].type,'entry');
    const r=parse(rows,{resolutions:{[p.issues[0].id]:{weekday:'6',status:'unavailable'}}});assert.equal(r.issues.length,0);assert(find(r,'הוד','2026-10-31'));
  });
  test('An isolated time restriction is not silently swallowed as a date header', () => {
    const p=parse([['הוד'],['תאריך: ישן'],['18:00-22:00']]);
    assert.equal(p.issues[0].type,'entry');assert.equal(p.applied.length,0);
  });
  test('Extra blocks remain preserved as skipped when selected period is shorter', () => {
    const one=dates.createPeriod({startDate:'2026-10-25',weekCount:1});const p=parse(screenshotRows(),{period:one});
    assert.equal(p.issues.length,0);assert(p.skipped.some(e=>e.workerName==='דניאל'&&e.date==='2026-11-01'));assert.equal(p.detectedWeekCount,2);
  });
  test('Changing canonical period deliberately remaps block positions, never header dates', () => {
    const old=parse([['הוד'],['18-24.10'],["א' - לא יכול"]]);
    const p=service.interpret({...old,workers,period:dates.createPeriod({startDate:'2026-11-01',weekCount:2})},dates);
    assert.equal(p.applied[0].date,'2026-11-01');assert.equal(p.skipped.length,0);assert.equal(p.sources[0].anchorPeriod.startDate,'2026-10-25');
  });
  test('Canonical month/year rollover provides all dates', () => {
    const p=parse([['הוד'],['שבוע ישן'],["א' - לא יכול"],['שבוע ישן'],["ב' - לא יכול"]],{period:dates.createPeriod({startDate:'2026-12-27',weekCount:2})});
    assert.equal(p.issues.length,0);assert(find(p,'הוד','2027-01-04'));
  });
  test('Duplicate employee columns merge compatible records; contradictions require resolution', () => {
    const rows=[['הוד','הוד'],['תאריך: טעות','תאריך: אחר'],["א' - לא יכול","א' -"]];const p=parse(rows);
    assert.equal(p.employees.length,1);assert.equal(p.issues[0].type,'conflict');assert.equal(p.applied.length,0);
    const r=parse(rows,{resolutions:{[p.issues[0].id]:{status:'unavailable',evidenceKey:p.issues[0].evidenceKey}}});assert.equal(r.issues.length,0);assert.equal(r.applied[0].status,'unavailable');
    const next=service.interpret({...r,workers,period,sources:[...r.sources,{rowsJson:JSON.stringify([['הוד'],['תאריך: אחר'],["א' - לא יכול"]])}]},dates);
    assert.equal(next.issues.length,1,'new evidence invalidates old decision');
  });
  test('Shared aliases and unsafe/missing names require identity resolution', () => {
    for(const name of ['','<img onerror=alert(1)>','משותף']) {
      const p=parse([[name],['תאריך: ישן'],["א' - לא יכול"]],{workers:[{name:'הוד',aliases:['משותף']},{name:'דניאל',aliases:['משותף']}]});assert.equal(p.issues[0].type,'employee');
    }
    assert.equal(parse([['אהוד'],["א' - לא יכול"]]).employees[0].name,'אהוד');
  });
  test('Exclusive and full-week restrictions retain existing semantics', () => {
    const p=parse([['הוד'],['תאריך: ישן'],["יכול רק ביום ג'"]]);assert.equal(p.issues.length,0);assert.equal(find(p,'הוד','2026-10-25').status,'unavailable');assert.equal(find(p,'הוד','2026-10-27').status,'available');
    assert.equal(parse([['הוד'],['לא יכולה כל השבוע']]).applied.filter(e=>e.status==='unavailable').length,7);
  });
  test('Quoted TSV retains original cells and source text', () => {
    const raw="הוד\tדניאל\r\n\"תאריך: טעות\nא' - לא יכול\"\t\r\n";const rows=service.parseTsv(raw);
    const p=parse(rows,{sources:[{rawText:raw,rowsJson:JSON.stringify(rows)}]});assert.equal(p.sources[0].rawText,raw);assert.equal(p.applied[0].date,'2026-10-25');
  });
  test('Separately dated one-time notes remain explicit and do not define weekly period', () => {
    const p=parse([['הוד'],['תאריך: ישן'],["א' -"],['הערות'],['הוד לא יכול 27.10']]);assert.equal(p.issues.length,0);assert.equal(find(p,'הוד','2026-10-27').status,'unavailable');
  });
  console.log('Constraint import: '+passed+' passed');
}
module.exports={screenshotRows,workers};
if(require.main===module)run();
