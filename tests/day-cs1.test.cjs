const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),lib=require('pdf-lib');
const source=fs.readFileSync(require.resolve('../PDFGenerator.gs'),'utf8');
const tasks=['Storytelling 1: Dialogue','Storytelling 2: Check It Out','Storytelling 3: Setting'];

function render(selectedRow=3,unityOnly=false){
  const data=unityOnly?{3:['Parker N','','','UNITY_Platinum','Codey Raceway'],4:['Other Student','','','UNITY_Silver','Robomania'],5:['Another Student','','','UNITY_Bronze','Dropping Bombs']}:{3:['Oliver P','','','IMPACT_Yellow','Lvl 2 Build 1'],4:['Easton G','','','CS_1',tasks[1]],5:['Ada S','','','CS_1',tasks[2]]};
  const ss={getName:()=> 'Journal 10-2026'};
  const sheet={getName:()=> '10-29',getParent:()=>ss,getActiveRange:()=>({getRow:()=>selectedRow}),getLastRow:()=>5,
    getRange:(row,col,nr=1,nc=1)=>({getDisplayValue:()=>data[row]?.[col-1]||'',
      getDisplayValues:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>data[row+i]?.[col+j-1]||''))})};
  let html='';
  const c=vm.createContext({SpreadsheetApp:{getActiveSheet:()=>sheet,getUi:()=>({showModalDialog(){}})},
    HtmlService:{createHtmlOutput:text=>{html=text;const output={setWidth:()=>output,setHeight:()=>output};return output;}}});
  vm.runInContext(source,c);c.initializePdfStatuses_=()=>{};c.lastTrackerRun_=()=>null;
  c.getCurriculum_=()=>({course:'CS_1',tasks});c.getSuggestedNote_=(sh,row,project)=>'Working on '+project+'!';
  c.openTrackerPopup();return {html,c};
}

test('whole-day CS1 forms render even when the selected student is on a different program',()=>{
  const {html}=render();
  assert.match(html,/Easton G — CS1/);assert.match(html,/Ada S — CS1/);
  assert.match(html,/id="dayCs14Complete"/);assert.doesNotMatch(html,/type="date"/);assert.doesNotMatch(html,/id="dayCs14Notes"/);
  assert.match(html,/<option value="1" disabled>Storytelling 2: Check It Out/);
  assert.doesNotThrow(()=>new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  const elements=Object.fromEntries(['dayWarning','choose','details','detailTitle','singleFields','senseiFields','dayCs1Fields','summary','results','dayProgress','currentAction','done'].map(id=>[id,{}]));
  const choice={value:'day'};
  const c=vm.createContext({document:{querySelector:()=>choice},scope:'selected',selectedName:'Oliver P',rows:[3,4,5],
    dayCs1Students:[{row:4},{row:5}],isUnity:false,isCS1:false,dayNeedsSensei:true,el:id=>elements[id]});
  vm.runInContext(source.slice(source.indexOf('  function showDayWarning(){'),source.indexOf('  function goBack(){')),c);
  c.chooseScope();assert.equal(elements.dayCs1Fields.hidden,false);assert.equal(elements.singleFields.hidden,true);
  choice.value='selected';c.chooseScope();assert.equal(elements.dayCs1Fields.hidden,true);
});

test('completion choices are collected per student without date or notes inputs',()=>{
  const students=[{row:4,name:'Easton G',project:tasks[1]},{row:5,name:'Ada S',project:tasks[2]}];
  const fields={dayCs14Complete:{value:'0'},dayCs14Date:{value:'2026-10-20'},dayCs14Notes:{value:'Good work'},
    dayCs15Complete:{value:''},dayCs15Date:{value:''},dayCs15Notes:{value:'Keep practicing'}};
  const c=vm.createContext({dayCs1Students:students,el:id=>fields[id]});
  vm.runInContext(source.slice(source.indexOf('  function collectDayCs1Selections(){'),source.indexOf('  function submitCards(){')),c);
  const result=c.collectDayCs1Selections();
  assert.equal(result[4].cs1CompleteIndex,0);assert.equal(result[4].cs1CompletionDate,undefined);assert.equal(result[4].notes,undefined);
  assert.equal(result[5].cs1CompleteIndex,null);assert.equal(result[5].notes,undefined);
  delete fields.dayCs14Date;delete fields.dayCs15Date;assert.doesNotThrow(()=>c.collectDayCs1Selections());
});

async function server({completeIndex=0,changed=false,alreadyComplete=false,legacyText=false,startedChosen=false,repeat=false,customDescription=false}={}){
  const c=vm.createContext({Uint8Array,Int8Array});vm.runInContext(source,c);const meta=vm.runInContext('TRACKER_FIELDS.CS_1',c);
  const pdf=await lib.PDFDocument.create(),page=pdf.addPage(),form=pdf.getForm();
  form.createTextField("Student's Name").setText('Easton G');
  for(let i=0;i<3;i++){
    const fields=meta.rows[i];form.createCheckBox(fields.check).addToPage(page,{x:20,y:700-i*50,width:15,height:15});
    form.createTextField(fields.date);form.createTextField(fields.by);
  }
  if(alreadyComplete){form.getCheckBox(meta.rows[0].check).check();form.getTextField(meta.rows[0].date).setText('09/01/26');form.getTextField(meta.rows[0].by).setText('Previous Sensei');}
  if(legacyText){
    form.getCheckBox(meta.rows[2].check).check();form.getTextField(meta.rows[2].date).setText('10/10/26');form.getTextField(meta.rows[2].by).setText('ji');
    form.getTextField(meta.rows[1].date).setText('10/01/26');form.getTextField(meta.rows[1].by).setText('Old Sensei');
  }
  if(startedChosen){form.getTextField(meta.rows[0].date).setText('09/14/26');form.getTextField(meta.rows[0].by).setText('Working!');}
  if(customDescription){form.getTextField(meta.rows[1].by).setText('Making very impressive progress');form.getTextField(meta.rows[0].by).setText('Great teamwork');}
  const bytes=await pdf.save();let saved=null,ready=false;
  const file={getId:()=> 'student',getName:()=> 'Easton G CS1 Tracker.pdf',getBlob:()=>({getBytes:()=>Array.from(saved||bytes)})};
  const sheet={getName:()=> '10-29',getLastRow:()=>4,getParent:()=>({}),getRange:(row,col,nr,nc)=>{
    const values=['Easton G','','','CS_1',tasks[1]];
    if(nr===1&&nc===5)return {getDisplayValues:()=>[values]};
    if(col===11)return {setValue:value=>ready=value};
    return {getDisplayValue:()=>col===14?'PDF UPDATED':values[col-1]||'',getRichTextValue:()=>null,getFormula:()=>''};
  }};
  Object.assign(c,{SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>sheet})},
    LockService:{getDocumentLock:()=>({waitLock(){},releaseLock(){}})},assertTrackerRun_(){},reportDayTrackerProgress_(){},setTrackerIndicator_(){},
    getSessionDate_:()=>({short:'10/29/26'}),getSuggestedNote_:()=>'',getCurriculum_:()=>({course:'CS_1',tasks}),
    locateTracker_:()=>({file,folder:null}),getPdfLib_:()=>lib,
    Utilities:{newBlob:values=>({getBytes:()=>values})},hashPdfBytes_:()=> 'hash',
    persistTrackerPdf_:(location,blob)=>{saved=Uint8Array.from(blob.getBytes());return {url:'tracker-url'};}});
  const choices={4:{student:changed?'Different Student':'Easton G',project:tasks[1],cs1CompleteIndex:completeIndex,
    cs1CompletionDate:completeIndex===null?'':'2026-10-20',notes:'Session note'}};
  let results=await c.generateDayBatch('10-29',[4],'','run',choices);
  if(repeat && results[0].ok){c.getSessionDate_=()=>({short:'11/04/26'});results=await c.generateDayBatch('10-29',[4],'','run',choices);}
  return {results,pdf:saved?await lib.PDFDocument.load(saved):null,meta,ready};
}

test('whole-day choices mark only the chosen CS1 project and preserve the current working project',async()=>{
  const h=await server();assert.equal(h.results[0].ok,true,JSON.stringify(h.results));assert.equal(h.ready,true);
  const f=h.pdf.getForm();assert.equal(f.getCheckBox(h.meta.rows[0].check).isChecked(),true);
  assert.equal(f.getTextField(h.meta.rows[0].date).getText(),'10/29/26');assert.equal(f.getTextField(h.meta.rows[0].by).getText(),'Nice!');
  assert.equal(f.getCheckBox(h.meta.rows[1].check).isChecked(),false);assert.equal(f.getTextField(h.meta.rows[1].by).getText(),'Working!');
  assert.equal(f.getTextField(h.meta.rows[1].date).getText(),'10/29/26');
  assert.equal(f.getCheckBox(h.meta.rows[2].check).isChecked(),false);
});

test('None leaves CS1 completions unchanged and existing completions preserve their historical date and existing By text',async()=>{
  const none=await server({completeIndex:null});assert.equal(none.results[0].ok,true,JSON.stringify(none.results));
  assert.equal(none.pdf.getForm().getCheckBox(none.meta.rows[0].check).isChecked(),false);
  const done=await server({alreadyComplete:true});assert.equal(done.results[0].ok,true);
  assert.equal(done.pdf.getForm().getTextField(done.meta.rows[0].date).getText(),'09/01/26');
  assert.equal(done.pdf.getForm().getTextField(done.meta.rows[0].by).getText(),'Previous Sensei');
});

test('changed students and attempts to complete the current project fail before saving a PDF',async()=>{
  for(const config of [{changed:true},{completeIndex:1}]){
    const h=await server(config);assert.equal(h.results[0].ok,false);assert.equal(h.pdf,null);assert.equal(h.ready,false);
  }
});

test('mixed whole-day batches keep each CS1 selection isolated from other students',async()=>{
  const rows={3:['Oliver P','','','IMPACT_Yellow','Lvl 2 Build 1'],4:['Easton G','','','CS_1',tasks[1]]},calls=[];
  const sheet={getName:()=> '10-29',getLastRow:()=>4,getRange:(row,col)=>({getDisplayValue:()=>rows[row][col-1]})};
  const c=vm.createContext({SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>sheet})},
    LockService:{getDocumentLock:()=>({waitLock(){},releaseLock(){}})}});
  vm.runInContext(source,c);c.assertTrackerRun_=()=>{};c.getSuggestedNote_=(sh,row)=>'Default notes for '+row;
  c.generateForRow_=async(sh,row,status,stars,overrides)=>{calls.push({row,overrides});return {url:'tracker',message:'Updated'};};
  const result=await c.generateDayBatch('10-29',[3,4],'Amber','run',{
    4:{student:'Easton G',project:tasks[1],cs1CompleteIndex:0,cs1CompletionDate:'2026-10-20',notes:'Easton notes'}});
  assert.equal(result.every(r=>r.ok),true);assert.equal(calls[0].overrides.notes,'Default notes for 3');
  assert.equal(calls[0].overrides.cs1CompleteIndex,undefined);
  assert.equal(calls[1].overrides.cs1CompleteIndex,0);assert.equal(calls[1].overrides.cs1CompletionDate,undefined);
  assert.equal(calls[1].overrides.notes,'');assert.equal(calls[1].overrides.sensei,'Amber');
});


test('CS1 popup shows only completion controls without Sensei, Notes or explanatory descriptions',()=>{
  const {html}=render(4);
  assert.match(html,/<div id="senseiFields" hidden>/);
  assert.doesNotMatch(html,/Notes for the PDF|Only the selected project gets|Sensei above|updateCs1Notes/);
  assert.match(html,/id="cs1Complete"/);assert.doesNotMatch(html,/id="cs1Date"/);
  assert.match(html,/id="dayCs14Complete"/);assert.doesNotMatch(html,/id="dayCs14Date"/);
});

test('Unity forms hide Sensei and omit the Notes section, including Unity-only whole-day runs',()=>{
  const {html}=render(3,true);
  assert.match(html,/<div id="senseiFields" hidden>/);assert.doesNotMatch(html,/Notes for the PDF/);
  const ids=['dayWarning','choose','details','detailTitle','singleFields','senseiFields','dayCs1Fields','summary','results','dayProgress','currentAction','done'];
  const fields=Object.fromEntries(ids.map(id=>[id,{}])),choice={value:'selected'};
  const c=vm.createContext({document:{querySelector:()=>choice},el:id=>fields[id],scope:'selected',selectedName:'Parker N',
    rows:[3,4,5],isUnity:true,isCS1:false,dayNeedsSensei:false,dayCs1Students:[]});
  vm.runInContext(source.slice(source.indexOf('  function showDayWarning(){'),source.indexOf('  function goBack(){')),c);
  c.chooseScope();assert.equal(fields.senseiFields.hidden,true);
  choice.value='day';c.chooseScope();assert.equal(fields.senseiFields.hidden,true);
  c.dayNeedsSensei=true;c.chooseScope();assert.equal(fields.senseiFields.hidden,false);
});

test('dialog submits Unity updates with an empty Sensei and no Notes input, while mixed days still require Sensei',()=>{
  for(const [scope,dayNeedsSensei,expected,cs1]of [['selected',false,'selected',false],['selected',false,'selected',true],['day',false,'day',false],['day',true,null,false]]){
    const calls=[],fields={sensei:{value:''},summary:{textContent:''},results:{textContent:''},done:{hidden:true},dayProgress:{value:0},currentAction:{textContent:''},cs1Complete:{value:cs1?'0':''}};
    const run={withSuccessHandler(){return run;},withFailureHandler(){return run;},
      generateFromPopup(...args){calls.push({kind:'selected',args});},beginDayTrackerRun(...args){calls.push({kind:'day',args});}};
    const c=vm.createContext({scope,dayNeedsSensei,isUnity:!cs1,isCS1:cs1,isScratchJr:false,running:false,undoBusy:false,
      tab:'10-10',chosenRow:3,dayCs1Selections:{},completed:0,failed:0,cursor:0,
      el:id=>{assert.ok(fields[id],'Unexpected field '+id);return fields[id];},buttonsDisabled(){},collectDayCs1Selections:()=>({}),
      google:{script:{run}},processNextBatch(){},pollDayProgress(){}});
    vm.runInContext(source.slice(source.indexOf('  function submitCards(){'),source.indexOf('  function stopDayProgress(){')),c);
    c.submitCards();assert.equal(calls.length,expected?1:0);
    if(expected)assert.equal(calls[0].kind,expected);else assert.match(fields.summary.textContent,/Sensei/);
    if(expected==='selected'){assert.equal(calls[0].args[2],'');assert.equal(calls[0].args[4],'');if(cs1){assert.equal(calls[0].args[5],0);assert.equal(calls[0].args.length,6);}}
  }
});


test('CS1 preserves existing By text and dates instead of replacing them with automatic labels',async()=>{
  const h=await server({legacyText:true});assert.equal(h.results[0].ok,true,JSON.stringify(h.results));
  const form=h.pdf.getForm();
  assert.equal(form.getCheckBox(h.meta.rows[2].check).isChecked(),true);
  assert.equal(form.getTextField(h.meta.rows[2].by).getText(),'ji');
  assert.equal(form.getTextField(h.meta.rows[2].date).getText(),'10/10/26');
  assert.equal(form.getCheckBox(h.meta.rows[1].check).isChecked(),false);
  assert.equal(form.getTextField(h.meta.rows[1].by).getText(),'Old Sensei');
  assert.equal(form.getTextField(h.meta.rows[1].date).getText(),'10/01/26');
});


test('CS1 repeating a working-project update preserves the first start date',async()=>{
  const h=await server({completeIndex:null,repeat:true});assert.equal(h.results[0].ok,true,JSON.stringify(h.results));
  const form=h.pdf.getForm();assert.equal(form.getTextField(h.meta.rows[1].date).getText(),'10/29/26');
  assert.equal(form.getTextField(h.meta.rows[1].by).getText(),'Working!');
  assert.equal(form.getCheckBox(h.meta.rows[1].check).isChecked(),false);
});

test('new CS1 completion records the journal date automatically, replacing its earlier working date',async()=>{
  const h=await server({startedChosen:true});assert.equal(h.results[0].ok,true,JSON.stringify(h.results));
  const form=h.pdf.getForm();assert.equal(form.getTextField(h.meta.rows[0].date).getText(),'10/29/26');
  assert.equal(form.getTextField(h.meta.rows[0].by).getText(),'Nice!');
  assert.equal(form.getCheckBox(h.meta.rows[0].check).isChecked(),true);
});


test('repeating a completed CS1 project preserves the date of its first completion',async()=>{
  const h=await server({repeat:true});assert.equal(h.results[0].ok,true,JSON.stringify(h.results));
  assert.equal(h.pdf.getForm().getTextField(h.meta.rows[0].date).getText(),'10/29/26');
  assert.equal(h.pdf.getForm().getTextField(h.meta.rows[0].by).getText(),'Nice!');
});


test('CS1 custom descriptions survive current-project updates and selected completions',async()=>{
  const h=await server({customDescription:true,repeat:true});assert.equal(h.results[0].ok,true,JSON.stringify(h.results));
  const form=h.pdf.getForm();
  assert.equal(form.getTextField(h.meta.rows[1].by).getText(),'Making very impressive progress');
  assert.equal(form.getTextField(h.meta.rows[0].by).getText(),'Great teamwork');
  assert.equal(form.getCheckBox(h.meta.rows[0].check).isChecked(),true);
  assert.equal(form.getCheckBox(h.meta.rows[1].check).isChecked(),false);
});
