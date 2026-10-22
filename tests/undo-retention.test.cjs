const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../PDFGenerator.gs'),'utf8');
function harness(){
  const store=new Map([['TRACKER_PDF_UNDO_FOLDER','undo-folder']]),files=new Map(),warnings=[];let seq=0,backupSeq=0;
  const props={getProperty:key=>store.get(key)||null,setProperty:(key,value)=>store.set(key,value),deleteProperty:key=>store.delete(key)};
  const c=vm.createContext({console:{warn:text=>warnings.push(text)},
    SpreadsheetApp:{getActiveSpreadsheet:()=>({getId:()=> 'journal'})},PropertiesService:{getScriptProperties:()=>props},
    Utilities:{getUuid:()=> 'run'+(++seq)},DriveApp:{getFileById:id=>{if(!files.has(id))throw Error('Missing file');return files.get(id);}}});
  vm.runInContext(source,c);
  function backup({parent='undo-folder',name='BACKUP original.pdf',denied=false}={}){
    const id='backup'+(++backupSeq),f={id,trashed:false,denied,getName:()=>name,
      getParents:()=>{let used=false;return {hasNext:()=>!used,next:()=>{used=true;return {getId:()=>parent};}};},
      isTrashed:()=>f.trashed,setTrashed:value=>{if(f.denied)throw Error('Access denied');f.trashed=value;}};
    files.set(id,f);return f;
  }
  function action(count=1,{created=false}={}){
    const id=c.beginTrackerRun_('10-10'),backups=[];
    for(let i=0;i<count;i++){
      const b=created?null:backup();if(b)backups.push(b);
      c.addTrackerUndoRecord_(id,{tab:'10-10',fileId:'student-'+id+'-'+i,backupId:b?.id,
        created,archiveId:'old-belt',folderId:'student-folder'});
    }
    return {id,backups};
  }
  return {c,store,files,warnings,props,backup,action};
}

test('retains five successful generation actions and trashes the oldest backups on action six',()=>{
  const h=harness(),runs=Array.from({length:5},()=>h.action());
  assert.ok(runs.every(run=>!run.backups[0].trashed));
  const sixth=h.action();assert.equal(runs[0].backups[0].trashed,true);
  assert.ok(runs.slice(1).every(run=>!run.backups[0].trashed));assert.equal(sixth.backups[0].trashed,false);
  assert.equal(h.store.has(h.c.undoRecordKey_(runs[0].id,0)),false);
  const history=JSON.parse(h.store.get(h.c.trackerUndoHistoryKey_()));assert.equal(history.length,5);
  assert.equal(h.c.lastTrackerRun_().id,sixth.id);
});

test('a whole day counts once even when it produces several backup PDFs',()=>{
  const h=harness(),day=h.action(3);for(let i=0;i<4;i++)h.action();
  assert.ok(day.backups.every(file=>!file.trashed));h.action();
  assert.ok(day.backups.every(file=>file.trashed));
});

test('empty or failed actions do not age successful backup history',()=>{
  const h=harness(),first=h.action();for(let i=0;i<8;i++)h.c.beginTrackerRun_('10-10');
  assert.equal(first.backups[0].trashed,false);
  assert.equal(JSON.parse(h.store.get(h.c.trackerUndoHistoryKey_())).length,1);
  for(let i=0;i<4;i++)h.action();assert.equal(first.backups[0].trashed,false);
  h.action();assert.equal(first.backups[0].trashed,true);
});

test('new-belt folder actions count but their student PDFs, folders and archived belt copies are never deleted',()=>{
  const h=harness(),first=h.action();
  for(let i=0;i<6;i++)h.action(1,{created:true});
  assert.equal(first.backups[0].trashed,true);assert.equal(h.files.size,1);
});

test('cleanup denial does not fail generation and is retried without dropping the five recent actions',()=>{
  const h=harness(),first=h.action();first.backups[0].denied=true;
  for(let i=0;i<5;i++)assert.doesNotThrow(()=>h.action());
  assert.equal(first.backups[0].trashed,false);assert.ok(h.warnings.some(w=>w.includes('Access denied')));
  assert.equal(JSON.parse(h.store.get(h.c.trackerUndoHistoryKey_())).length,6);
  first.backups[0].denied=false;h.c.retainTrackerUndoRun_(h.c.lastTrackerRun_());
  assert.equal(first.backups[0].trashed,true);
  assert.equal(JSON.parse(h.store.get(h.c.trackerUndoHistoryKey_())).length,5);
});

test('the last successful run from older versions is registered before beginning a new action',()=>{
  const h=harness(),b=h.backup();
  h.props.setProperty(h.c.trackerRunKey_(),JSON.stringify({id:'legacy',tab:'10-10',count:1}));
  h.props.setProperty(h.c.undoRecordKey_('legacy',0),JSON.stringify({fileId:'student',backupId:b.id}));
  for(let i=0;i<4;i++)h.action();assert.equal(b.trashed,false);
  h.action();assert.equal(b.trashed,true);
});

test('cleanup refuses any file outside the Undo folder or whose ID matches the student tracker',()=>{
  for(const invalid of ['outside','tracker']){
    const h=harness(),b=h.backup({parent:invalid==='outside'?'student-folder':'undo-folder'});
    const id=h.c.beginTrackerRun_('10-10');
    h.c.addTrackerUndoRecord_(id,{tab:'10-10',fileId:invalid==='tracker'?b.id:'student',backupId:b.id});
    for(let i=0;i<5;i++)h.action();assert.equal(b.trashed,false);assert.ok(h.warnings.length>0);
  }
});
