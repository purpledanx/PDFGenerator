const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { PDFDocument, StandardFonts, PDFName, decodePDFRawStream } = require('pdf-lib');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(require.resolve('../PDFGenerator.gs'), 'utf8'), context);
const meta = vm.runInContext('TRACKER_FIELDS.IMPACT_Blue', context);
const tasks = [1, 2, 3, 4, 5, 6].flatMap(level =>
  (level === 6 ? [] : [`Lvl ${level} Discovery`]).concat([1, 2, 3].map(project => `Lvl ${level} Solve ${project}`)));

async function fixture() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  const form = pdf.getForm();
  for (const name of ['Text1', 'Text2', 'Date3_af_date', 'Text3', 'Text4']) {
    form.createTextField(name);
  }
  meta.levels.forEach((names, level) => names.forEach((name, index) => {
    const field = form.createDropdown(name);
    // Deliberately omit a blank option to exercise imported templates that
    // cannot clear a stale W by selecting a literal space.
    // Match the uploaded Blue form: levels 1–4 have TWO R/L-only
    // fields, including the dropdown printed beside the last wrench.
    const reviewStart = level < 4 ? names.length - 2 : names.length - 1;
    field.addOptions(index >= reviewStart ? ['R', 'L'] : ['W', 'C', 'S']);
    field.addToPage(page, { x: 20 + index * 60, y: 700 - level * 60, width: 45, height: 20 });
  }));
  return pdf;
}

async function update(pdf, task) {
  context.applyImpact_(pdf.getForm(), meta, 'IMPACT_Blue', task, tasks,
    'W', 'Sensei', { short: '10/21/26' }, 'Student', `Working on ${task}!`, []);
  pdf.getForm().updateFieldAppearances(await pdf.embedFont(StandardFonts.Helvetica));
  return PDFDocument.load(await pdf.save());
}
const selected = (pdf, name) => pdf.getForm().getDropdown(name).getSelected()[0] || '';
function appearance(pdf, name) {
  const widget = pdf.getForm().getDropdown(name).acroField.getWidgets()[0];
  const stream = widget.dict.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
  return Buffer.from(decodePDFRawStream(stream).decode()).toString();
}

test('moving from level 6 to level 5 clears future W/R and writes visible C/W/L', async () => {
  let pdf = await fixture();
  pdf.getForm().getDropdown('Dropdown35').select('W');
  pdf.getForm().getDropdown('Dropdown45').select('R');
  pdf.getForm().getDropdown('Dropdown14').select('S');
  pdf = await update(pdf, 'Lvl 5 Solve 1');
  assert.equal(selected(pdf, 'Dropdown45'), '');
  assert.equal(selected(pdf, 'Dropdown35'), '');
  assert.equal(selected(pdf, 'Dropdown14'), 'S');
  assert.equal(selected(pdf, 'Dropdown34'), 'W');
  assert.equal(selected(pdf, 'Dropdown13'), 'C');
  assert.equal(selected(pdf, 'Dropdown63'), 'L');
  for (const [name, letter] of [['Dropdown34', 'W'], ['Dropdown13', 'C'], ['Dropdown63', 'L']]) {
    assert.match(appearance(pdf, name), new RegExp(`<${letter.charCodeAt(0).toString(16)}> Tj`, 'i'));
  }
  assert.doesNotMatch(appearance(pdf, 'Dropdown35'), /<57> Tj/);
});

test('advancing, repeating and moving backwards reconcile later completion markers', async () => {
  let pdf = await fixture();
  for (const task of ['Lvl 5 Solve 1', 'Lvl 5 Solve 2', 'Lvl 6 Solve 1', 'Lvl 6 Solve 1', 'Lvl 5 Solve 1']) {
    pdf = await update(pdf, task);
    const working = meta.levels.flat().filter(name => selected(pdf, name) === 'W');
    assert.deepEqual(Array.from(working), [task.startsWith('Lvl 6') ? 'Dropdown25' :
      task.endsWith('2') ? 'Dropdown44' : 'Dropdown34']);
  }
  assert.equal(selected(pdf, 'Dropdown54'), '');
  assert.equal(selected(pdf, 'Dropdown44'), '');
});


test('Blue level 5 Solve 1 uses the first wrench regardless of Courses list order', async () => {
  // Actual IMPACT_Blue Level 5 entries supplied from the journal's Courses tab.
  const journalLevel5 = [
    'Lvl 5 Build 1', 'Lvl 5 Build 2', 'Lvl 5 Solve 1', 'Lvl 5 Solve 2',
    'Lvl 5 Explore 1', 'Lvl 5 Explore 2', 'Lvl 5 Quest / Adventure',
  ];
  for (const entries of [journalLevel5, tasks, [...tasks].reverse(), ['Lvl 5 Solve 1']]) {
    let pdf = await fixture();
    for (const name of ['Dropdown34', 'Dropdown44', 'Dropdown25']) {
      pdf.getForm().getDropdown(name).select('C');
    }
    pdf.getForm().getDropdown('Dropdown54').select('L');
    context.applyImpact_(pdf.getForm(), meta, 'IMPACT_Blue', 'Lvl 5 Solve 1', entries,
      'W', 'Sensei', { short: '10/21/26' }, 'Student', 'Working on Lvl 5 Solve 1!', []);
    pdf.getForm().updateFieldAppearances(await pdf.embedFont(StandardFonts.Helvetica));
    pdf = await PDFDocument.load(await pdf.save());
    assert.deepEqual(Array.from(meta.levels[4], name => selected(pdf, name)), ['C', 'C', 'W', '', '']);
    assert.deepEqual(Array.from(meta.levels[5], name => selected(pdf, name)), ['', '', '']);
    assert.match(appearance(pdf, 'Dropdown34'), /<57> Tj/);
    assert.doesNotMatch(appearance(pdf, 'Dropdown54'), /<4c> Tj/i);
  }
});

test('Yellow Quest / Adventure gains a visible W without awarding current-level L', async () => {
  const yellow=vm.runInContext('TRACKER_FIELDS.IMPACT_Yellow',context);
  let pdf=await PDFDocument.create();const page=pdf.addPage();
  const form=pdf.getForm();
  for(const name of ['Text1','Text2','Date3_af_date','Text3','Text4']) form.createTextField(name);
  yellow.levels.forEach((names,level)=>names.forEach((name,index)=>{
    const field=form.createDropdown(name);
    field.addOptions(index===names.length-1?['R','L',' ']:['W','C','S',' ']);
    field.addToPage(page,{x:20+index*60,y:700-level*60,width:45,height:20});
  }));
  form.getDropdown('Dropdown51').select('L');
  const task='Lvl 2 Quest / Adventure';
  context.applyImpact_(form,yellow,'IMPACT_Yellow',task,[task],'W','Sensei',
    {short:'10/10/26'},'Student','Working on '+task+'!',[]);
  form.updateFieldAppearances(await pdf.embedFont(StandardFonts.Helvetica));
  pdf=await PDFDocument.load(await pdf.save());
  assert.equal(selected(pdf,'Dropdown51'),'W');
  assert.equal(selected(pdf,'Dropdown5'),'L');
  assert.deepEqual(Array.from(yellow.levels[1],name=>selected(pdf,name)),['C','C','C','C','W']);
  assert.match(appearance(pdf,'Dropdown51'),/<57> Tj/);
  assert.deepEqual(Array.from(yellow.levels.flat()).filter(name=>selected(pdf,name)==='W'),['Dropdown51']);
  assert.equal(context.impactTarget_(pdf.getForm(),yellow,'IMPACT_Yellow',task,[task]).name,'Dropdown51');
});

test('Blue quest handles preceding R/L-only fields and does not shift later project mapping',async()=>{
  let pdf=await fixture();
  pdf=await update(pdf,'Lvl 5 Solve 1');
  pdf.getForm().getDropdown('Dropdown53').clear();
  const task='Lvl 4 Quest / Adventure';
  context.applyImpact_(pdf.getForm(),meta,'IMPACT_Blue',task,[...tasks,task],'W','Sensei',
    {short:'10/10/26'},'Student','Working on '+task+'!',[]);
  pdf.getForm().updateFieldAppearances(await pdf.embedFont(StandardFonts.Helvetica));
  pdf=await PDFDocument.load(await pdf.save());
  assert.equal(selected(pdf,'Dropdown63'),'W');
  assert.equal(selected(pdf,'Dropdown53'),'');
  // Quest's newly added W option must not be counted as a work slot.
  const entries=['Lvl 4 Build 1','Lvl 4 Build 2','Lvl 4 Build 3','Lvl 4 Explore 1'];
  assert.throws(()=>context.impactTarget_(pdf.getForm(),meta,'IMPACT_Blue',entries[3],entries),/No unambiguous/);
  pdf=await update(pdf,'Lvl 5 Solve 1');
  assert.equal(selected(pdf,'Dropdown63'),'L');
  assert.equal(selected(pdf,'Dropdown34'),'W');
});
