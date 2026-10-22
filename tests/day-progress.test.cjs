const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../PDFGenerator.gs'),'utf8');
function dialog(){
  const elements=Object.fromEntries(['summary','currentAction','dayProgress','done'].map(id=>[id,{textContent:'',value:0,hidden:true}]));
  const calls=[],results=[],cancelledTimers=[],timers=[];let closes=0;
  const script={host:{close:()=>closes++}};
  Object.defineProperty(script,'run',{get:()=>{
    const handlers={};const chain={withSuccessHandler:f=>{handlers.success=f;return chain;},withFailureHandler:f=>{handlers.failure=f;return chain;}};
    for(const method of ['generateDayBatch','getDayTrackerProgress'])chain[method]=(...args)=>calls.push({method,args,...handlers});
    return chain;
  }});
  const c=vm.createContext({running:true,activeDayRun:'run',progressTimer:null,cursor:0,completed:0,failed:0,rows:[3,4],
    studentNames:{3:'Oliver P',4:'Naveed F'},tab:'10-10',el:id=>elements[id],buttonsDisabled(){},
    addResult:(label,url,error)=>results.push({label,url,error}),google:{script},
    setTimeout:f=>{timers.push(f);return timers.length;},clearTimeout:id=>cancelledTimers.push(id)});
  const client=source.slice(source.indexOf('  function stopDayProgress(){'),source.indexOf('  </script></body></html>'));
  vm.runInContext(client,c);
  return {c,elements,calls,results,timers,cancelledTimers,get closes(){return closes;}};
}

test('day dialog processes every student through public RPCs and keeps the final summary open',()=>{
  const h=dialog();h.c.processNextBatch('Amber','run');
  assert.equal(h.calls[0].method,'generateDayBatch');assert.deepEqual(Array.from(h.calls[0].args[1]),[3]);
  assert.match(h.elements.currentAction.textContent,/Oliver P/);
  h.calls[0].success([{row:3,name:'Oliver P',ok:true,url:'folder-url',message:'Created tracker in folder.'}]);
  assert.equal(h.elements.dayProgress.value,1);assert.match(h.elements.currentAction.textContent,/Naveed F/);
  h.calls[1].success([{row:4,name:'Naveed F',ok:true,url:'pdf-url',message:'Updated existing tracker PDF.'}]);
  assert.match(h.elements.summary.textContent,/Finished: 2 updated, 0 failed.*2 of 2/);
  assert.equal(h.elements.dayProgress.value,2);assert.equal(h.elements.done.hidden,false);
  assert.equal(h.closes,0);assert.equal(h.c.running,false);
  assert.match(h.results[0].label,/Created tracker in folder/);assert.equal(h.results.length,2);
});

test('day progress shows the actual stage and ignores old student or completed-run responses',()=>{
  const h=dialog();h.c.pollDayProgress('run');
  assert.equal(h.calls[0].method,'getDayTrackerProgress');
  h.calls[0].success({row:3,name:'Oliver P',stage:'Uploading the updated PDF'});
  assert.equal(h.elements.currentAction.textContent,'Oliver P — Uploading the updated PDF');assert.equal(h.timers.length,1);
  h.c.cursor=1;h.timers[0]();h.calls[1].success({row:3,name:'Oliver P',stage:'Completed'});
  assert.doesNotMatch(h.elements.currentAction.textContent,/Completed/);
  h.c.running=false;h.c.stopDayProgress();const before=h.elements.currentAction.textContent;
  h.calls[1].success({row:4,name:'Naveed F',stage:'Saving'});
  assert.equal(h.elements.currentAction.textContent,before);assert.ok(h.cancelledTimers.length);
});

test('a student failure remains visible and does not prevent processing the next student',()=>{
  const h=dialog();h.c.processNextBatch('Amber','run');
  h.calls[0].success([{row:3,name:'Oliver P',ok:false,error:'Drive denied access'}]);
  assert.equal(h.results[0].error,true);assert.match(h.results[0].label,/Drive denied access/);
  h.calls[1].success([{row:4,name:'Naveed F',ok:true}]);
  assert.match(h.elements.summary.textContent,/1 updated, 1 failed/);assert.match(h.elements.currentAction.textContent,/Review/);
  assert.equal(h.closes,0);
});

test('RPC failure stops progress and displays the error with completed counts',()=>{
  const h=dialog();h.c.processNextBatch('Amber','run');h.calls[0].failure({message:'Execution timed out'});
  assert.match(h.elements.summary.textContent,/Stopped: 0 of 2/);assert.match(h.elements.currentAction.textContent,/Execution timed out/);
  assert.equal(h.c.running,false);assert.equal(h.c.activeDayRun,null);assert.equal(h.elements.done.hidden,false);
});

test('progress reads are scoped to the current undo run and tolerate unavailable progress storage',()=>{
  const store=new Map();const c=vm.createContext({console:{warn(){}},SpreadsheetApp:{getActiveSpreadsheet:()=>({getId:()=> 'journal'})},
    PropertiesService:{getScriptProperties:()=>({setProperty:(k,v)=>store.set(k,v),getProperty:k=>store.get(k)})}});
  vm.runInContext(source,c);c.lastTrackerRun_=()=>({id:'run',tab:'10-10'});
  c.reportDayTrackerProgress_('run','10-10',3,'Oliver P','Validating PDF');
  assert.equal(c.getDayTrackerProgress('10-10','run').stage,'Validating PDF');
  assert.equal(c.getDayTrackerProgress('10-10','older-run'),null);assert.equal(c.getDayTrackerProgress('10-11','run'),null);
  c.PropertiesService.getScriptProperties=()=>{throw Error('Unavailable');};
  assert.doesNotThrow(()=>c.reportDayTrackerProgress_('run','10-10',3,'Oliver P','Completed'));
});

test('HTML calls public day entry points rather than Apps Script private functions',()=>{
  const html=source.slice(source.indexOf('  const html=`'),source.indexOf('// Ask only when a new belt'));
  assert.match(html,/\.beginDayTrackerRun\(tab\)/);assert.match(html,/\.generateDayBatch\(tab,batch,s,runId\)/);
  assert.doesNotMatch(html,/\.(beginDayTrackerRun_|generateDayBatch_)\(/);
});

test('one invalid student cannot prevent whole-day confirmation from reaching generation',()=>{
  const c=vm.createContext({console:{warn(){}}});vm.runInContext(source,c);
  c.getCurriculum_=()=>{throw Error('Unsupported course');};
  const sheet={getParent:()=>({}),getRange:()=>({getDisplayValues:()=>[['Student','','','Fundamentals','Maze']]})};
  assert.equal(c.confirmNewTrackerBelts_(sheet,[3],true),true);
  assert.throws(()=>c.confirmNewTrackerBelts_(sheet,[3]),/Unsupported course/);
});

test('whole-day warning appears immediately and scope selection has no missing-element references',()=>{
  const ids=['dayWarning','choose','details','detailTitle','singleFields','summary','results','dayProgress','currentAction','done'];
  const elements=Object.fromEntries(ids.map(id=>[id,{hidden:true,textContent:'',value:0}]));
  const choice={value:'day'};
  const c=vm.createContext({scope:'selected',selectedName:'Oliver P',rows:[3,4],
    document:{querySelector:()=>choice},el:id=>{assert.ok(elements[id],'Missing element '+id);return elements[id];}});
  const functions=source.slice(source.indexOf('  function showDayWarning(){'),source.indexOf('  function goBack(){'));
  vm.runInContext(functions,c);c.showDayWarning();assert.equal(elements.dayWarning.hidden,false);
  c.chooseScope();assert.equal(elements.details.hidden,false);assert.equal(elements.dayWarning.hidden,false);
  assert.equal(elements.singleFields.hidden,true);
  choice.value='selected';c.chooseScope();assert.equal(elements.dayWarning.hidden,true);
  assert.equal(elements.singleFields.hidden,false);
  assert.match(source,/DO NOT CLOSE THIS DIALOG/);assert.match(source,/position:sticky;top:0/);
});

test('rendered popup includes a visible warning on the day option and valid client JavaScript',()=>{
  let html='',title='';
  const cells={1:'Oliver P',4:'IMPACT_Yellow',5:'Lvl 4 Explore 2'};
  const ss={getName:()=> 'Journal 10-2026'};
  const sh={getName:()=> '10-10',getParent:()=>ss,getActiveRange:()=>({getRow:()=>3}),getLastRow:()=>3,
    getRange:(r,c,nr=1)=>({getDisplayValue:()=>cells[c]||'',getDisplayValues:()=>Array.from({length:nr},()=>[cells[c]||''])})};
  const c=vm.createContext({SpreadsheetApp:{getActiveSheet:()=>sh,getUi:()=>({showModalDialog:(output,t)=>title=t})},
    HtmlService:{createHtmlOutput:text=>{html=text;const output={setWidth:()=>output,setHeight:()=>output};return output;}}});
  vm.runInContext(source,c);c.initializePdfStatuses_=()=>{};c.lastTrackerRun_=()=>null;c.getSuggestedNote_=()=>'';
  c.openTrackerPopup();
  const option=html.match(/<label class="radio"><input[^>]*value="day"[\s\S]*?<\/label>/)[0];
  assert.match(option,/DO NOT CLOSE THIS DIALOG/);assert.doesNotMatch(option,/\bhidden\b/);
  const client=html.match(/<script>([\s\S]*?)<\/script>/)[1];assert.doesNotThrow(()=>new vm.Script(client));
  assert.equal(title,'Generate Tracker PDFs');
});
