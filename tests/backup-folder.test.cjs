const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../PDFGenerator.gs'),'utf8');
const iterator=list=>{let i=0;return {hasNext:()=>i<list.length,next:()=>list[i++]};};
function harness(){
  const values=new Map(),folders=new Map(),files=new Map(),alerts=[],warnings=[];let seq=0,created=0;
  const props={getProperty:key=>values.get(key)||null,setProperty:(key,value)=>values.set(key,value),getProperties:()=>Object.fromEntries(values)};
  function folder(id,name='Tracker PDF Undo Backups',date=0){
    const item={id,name,trashed:false,getId:()=>id,getName:()=>name,getDateCreated:()=>new Date(date),isTrashed:()=>item.trashed,
      getUrl:()=> 'https://drive.google.com/drive/folders/'+id,setTrashed:val=>item.trashed=val,
      getFiles:()=>iterator([...files.values()].filter(f=>f.folder===item&&!f.trashed)),getFolders:()=>iterator([])};
    folders.set(id,item);return item;
  }
  function file(parent,date=0,name=null){
    const id='file'+(++seq);const item={id,folder:parent,trashed:false,denied:false,getId:()=>id,
      getName:()=>name||'BACKUP '+String(1700000000000+date)+' Student.pdf',getDateCreated:()=>new Date(date),
      getMimeType:()=> 'application/pdf',isTrashed:()=>item.trashed,
      setTrashed:val=>{if(item.denied)throw Error('Access denied');item.trashed=val;},moveTo:f=>{item.folder=f;}};
    files.set(id,item);return item;
  }
  const c=vm.createContext({console:{warn:text=>warnings.push(text)},MimeType:{PDF:'application/pdf'},
    PropertiesService:{getScriptProperties:()=>props},
    SpreadsheetApp:{getUi:()=>({ButtonSet:{OK:'OK'},alert:(...args)=>alerts.push(args)})},
    LockService:{getDocumentLock:()=>({waitLock(){},releaseLock(){}})},
    DriveApp:{getFolderById:id=>{if(!folders.has(id))throw Error('Access denied');return folders.get(id);},
      getFoldersByName:name=>iterator([...folders.values()].filter(f=>f.name===name&&!f.trashed)),
      createFolder:name=>{created++;return folder('created'+created,name);}}});
  vm.runInContext(source,c);
  return {c,values,folder,file,folders,files,alerts,warnings,get created(){return created;}};
}

test('reuses one existing folder after properties are missing, and creates once if no folder exists',()=>{
  const h=harness(),original=h.folder('oldest','Tracker PDF Undo Backups',1);h.folder('newer','Tracker PDF Undo Backups',2);
  assert.equal(h.c.getUndoFolder_().getId(),original.getId());assert.equal(h.created,0);
  h.values.clear();assert.equal(h.c.getUndoFolder_().getId(),original.getId());assert.equal(h.created,0);
  const empty=harness();for(let i=0;i<4;i++)assert.equal(empty.c.getUndoFolder_().getId(),'created1');assert.equal(empty.created,1);
});

test('a saved inaccessible folder recovers an existing accessible folder and remembers it',()=>{
  const h=harness();h.values.set('TRACKER_PDF_UNDO_FOLDER','inaccessible');
  h.folder('recovered');
  assert.equal(h.c.getUndoFolder_().getId(),'recovered');assert.equal(h.created,0);
  assert.equal(h.values.get('TRACKER_PDF_UNDO_FOLDER'),'recovered');
  assert.equal(h.c.getUndoFolder_().getId(),'recovered');assert.equal(h.created,0);
});

test('a pinned folder ID is reused across projects regardless of the old saved folder property',()=>{
  const h=harness();h.folder('pinned','Central Undo');h.values.set('TRACKER_PDF_UNDO_FOLDER','other');
  vm.runInContext("CONFIG.UNDO_BACKUP_FOLDER_ID='pinned'",h.c);
  assert.equal(h.c.getUndoFolder_().getId(),'pinned');assert.equal(h.created,0);
});

test('PDF-count cleanup keeps 50 backups, removes oldest first, and protects current Undo backups',()=>{
  const h=harness(),folder=h.folder('backups'),all=Array.from({length:60},(_,i)=>h.file(folder,i));
  h.values.set('TRACKER_PDF_UNDO_FOLDER','backups');
  h.values.set('TRACKER_LAST_UNDO_RUN_journal',JSON.stringify({id:'current',count:1}));
  h.values.set('TRACKER_UNDO_current_0',JSON.stringify({fileId:'student',backupId:all[0].id,previousBeltCompletion:{fileId:'old-student',backupId:all[1].id}}));
  const result=h.c.pruneTrackerUndoPdfCount_();assert.equal(result.removed,10);assert.equal(result.remaining,50);
  assert.equal(all[0].trashed,false);assert.equal(all[1].trashed,false);
  assert.ok(all.slice(2,12).every(f=>f.trashed));assert.ok(all.slice(12).every(f=>!f.trashed));
});

test('oversized current day action is kept intact even when it exceeds the 50-PDF limit',()=>{
  const h=harness(),folder=h.folder('backups'),all=Array.from({length:55},(_,i)=>h.file(folder,i));
  h.values.set('TRACKER_PDF_UNDO_FOLDER','backups');h.values.set('TRACKER_LAST_UNDO_RUN_journal',JSON.stringify({id:'day',count:55}));
  all.forEach((f,i)=>h.values.set('TRACKER_UNDO_day_'+i,JSON.stringify({fileId:'student'+i,backupId:f.id})));
  const result=h.c.pruneTrackerUndoPdfCount_();assert.equal(result.removed,0);assert.equal(result.remaining,55);
  assert.ok(all.every(f=>!f.trashed));assert.ok(h.warnings.length>0);
});

test('manual consolidation moves old backups into one folder, removes empty duplicates, and leaves student/unknown PDFs untouched',()=>{
  const h=harness(),primary=h.folder('primary'),duplicate=h.folder('duplicate'),mixed=h.folder('mixed');
  h.values.set('TRACKER_PDF_UNDO_FOLDER','primary');
  const old=h.file(duplicate,1),other=h.file(mixed,2),student=h.file(mixed,3,'Student Yellow Belt Tracker.pdf');
  const unknown=h.file(primary,4,'Personal document.pdf');
  const result=h.c.consolidateTrackerUndoBackups();
  assert.equal(result.moved,2);assert.equal(old.folder,primary);assert.equal(other.folder,primary);
  assert.equal(duplicate.trashed,true);assert.equal(mixed.trashed,false);assert.equal(student.folder,mixed);assert.equal(unknown.trashed,false);
  assert.equal(h.alerts.length,1);
});

test('cleanup excludes tracker/template IDs even if they were incorrectly placed in the Undo folder with backup-like names',()=>{
  const h=harness(),folder=h.folder('backups');h.values.set('TRACKER_PDF_UNDO_FOLDER','backups');
  const student=h.file(folder,0),template=h.file(folder,1);for(let i=0;i<55;i++)h.file(folder,i+2);
  h.values.set('TRACKER_UNDO_old_0',JSON.stringify({fileId:student.id}));
  vm.runInContext(`CONFIG.TEMPLATES.IMPACT_Yellow='${template.id}'`,h.c);
  h.c.pruneTrackerUndoPdfCount_();assert.equal(student.trashed,false);assert.equal(template.trashed,false);
});

test('missing saved folder with no accessible alternative creates only one reusable replacement',()=>{
  const h=harness();h.values.set('TRACKER_PDF_UNDO_FOLDER','deleted');
  for(let i=0;i<5;i++)assert.equal(h.c.getUndoFolder_().getId(),'created1');
  assert.equal(h.created,1);assert.ok(h.warnings.some(message=>message.includes('replacement')));
});

test('bad configured folder ID falls back to the valid saved folder, including PDF-count cleanup',()=>{
  const h=harness(),folder=h.folder('saved');h.values.set('TRACKER_PDF_UNDO_FOLDER','saved');
  vm.runInContext("CONFIG.UNDO_BACKUP_FOLDER_ID='unavailable';CONFIG.UNDO_BACKUP_MAX_PDFS=1",h.c);
  const first=h.file(folder,1),second=h.file(folder,2);
  assert.equal(h.c.getUndoFolder_().getId(),'saved');assert.equal(h.created,0);
  assert.equal(h.c.pruneTrackerUndoPdfCount_().removed,1);
  assert.equal(first.trashed,true);assert.equal(second.trashed,false);
});

test('a trashed saved folder is replaced by another existing folder, without making a duplicate',()=>{
  const h=harness(),old=h.folder('trashed');old.trashed=true;h.folder('accessible');
  h.values.set('TRACKER_PDF_UNDO_FOLDER','trashed');
  assert.equal(h.c.getUndoFolder_().getId(),'accessible');assert.equal(h.created,0);
});

test('a Drive listing failure does not create new folders when existing folders cannot be checked',()=>{
  const h=harness();h.values.set('TRACKER_PDF_UNDO_FOLDER','inaccessible');
  h.c.DriveApp.getFoldersByName=()=>{throw Error('Drive unavailable');};
  assert.throws(()=>h.c.getUndoFolder_(),/Drive unavailable/);assert.equal(h.created,0);
});
