const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const lib=require('pdf-lib');
const script=fs.readFileSync(require.resolve('../PDFGenerator.gs'),'utf8');
const iterator=items=>{let i=0;return {hasNext:()=>i<items.length,next:()=>items[i++]};};

async function harness({folderLink=false,currentOrange=false,wrongStudent=false,logFailure=false,blankLink=false}={}) {
  const files=new Map(),folders=new Map(),records=[],events=[];
  let seq=0,failLog=logFailure;
  const blob=(bytes,name)=>({getBytes:()=>Array.from(bytes),getName:()=>name});
  function file(name,bytes,id='f'+(++seq),folder=null) {
    const f={id,name,bytes:Buffer.from(bytes),trashed:false,
      getId:()=>id,getName:()=>f.name,setName:n=>{f.name=n;events.push('rename');return f;},
      getMimeType:()=> 'application/pdf',getUrl:()=>`https://drive.google.com/file/d/${id}/view`,
      getBlob:()=>blob(f.bytes,f.name),getParents:()=>iterator(folder?[folder]:[]),
      setTrashed:t=>{f.trashed=t;},makeCopy:(n,d)=>file(n,f.bytes,undefined,d)};
    f.folder=folder;files.set(id,f);return f;
  }
  function folder(name,id='d'+(++seq)) {
    const d={id,name,trashed:false,getId:()=>id,getUrl:()=>`https://drive.google.com/drive/folders/${id}`,
      createFile:b=>{events.push('create');return file(b.getName(),b.getBytes(),undefined,d);},
      createFolder:n=>{const child=folder(n);child.parent=d;return child;},
      getFiles:()=>iterator([...files.values()].filter(f=>f.folder===d&&!f.trashed)),
      getFolders:()=>iterator([...folders.values()].filter(f=>f.parent===d&&!f.trashed)),setTrashed:t=>{d.trashed=t;}};
    folders.set(id,d);return d;
  }
  const c=vm.createContext({Uint8Array,Int8Array,console});vm.runInContext(script,c);
  vm.runInContext("CONFIG.TEMPLATES.IMPACT_Orange='templateOrange'",c);
  const meta=vm.runInContext('TRACKER_FIELDS.IMPACT_Orange',c);
  async function fixture(course,student) {
    const pdf=await lib.PDFDocument.create();pdf.addPage();const form=pdf.getForm();
    for(const name of ['Text1','Text2','Date3_af_date','Text3','Text4',course+'Only']) form.createTextField(name);
    if(student) form.getTextField('Text1').setText(student);
    if(course==='Orange') meta.levels.forEach(names=>names.forEach((name,i)=>{
      form.createDropdown(name).addOptions(i===names.length-1?['R','L',' ']:['W','C','S',' ']);
    }));
    return Buffer.from(await pdf.save());
  }
  const blueBytes=await fixture('Blue',wrongStudent?'Other Student':'Naveed F');
  const orangeBytes=await fixture('Orange');
  const root=folder('Root'),history=folder('History','history');
  const source=file('PREVIEW Naveed F Blue Belt IMPACT Tracker.pdf',blueBytes,'oldBlue',folderLink?history:root);
  const template=file('Orange Belt IMPACT Template.pdf',orangeBytes,'templateOrange');
  let orange=null;
  if(currentOrange) orange=file('Naveed F Orange Belt IMPACT Tracker.pdf',orangeBytes,'currentOrange',history);
  const originalLink=blankLink?'':folderLink?history.getUrl():source.getUrl();
  let link=originalLink;
  const cell={getRichTextValue:()=>null,getFormula:()=>'',getDisplayValue:()=>link,getColumn:()=>9,setValue:v=>{events.push('link');link=v;}};
  const sh={getName:()=> '10-10',getParent:()=>({}),getRange:(row,col,width,height)=>{
    if(col===1&&width===1&&height===5) return {getDisplayValues:()=>[['Naveed F','','','IMPACT_Orange','Lvl 1 Build 1']]};
    if(col===1) return {getDisplayValue:()=> 'Naveed F'};
    if(col===9) return cell;
    return {getDisplayValue:()=> 'PDF UPDATED'};
  }};
  const ss={getSheetByName:()=>sh};
  Object.assign(c,{
    DriveApp:{getFileById:id=>{if(!files.has(id))throw Error('Missing '+id);return files.get(id);},
      getFolderById:id=>folders.get(id),createFolder:folder},MimeType:{PDF:'application/pdf'},
    Utilities:{newBlob:(bytes,type,name)=>blob(bytes,name)},
    getPdfLib_:()=>lib,getSessionDate_:()=>({short:'10/10/26'}),
    getCurriculum_:()=>({course:'IMPACT_Orange',tasks:['Lvl 1 Build 1','Lvl 1 Build 2','Lvl 1 Solve 1']}),
    assertTrackerRun_:()=>{},setTrackerIndicator_:()=>{},getUndoFolder_:()=>folder('Backups'),
    hashPdfBytes_:bytes=>crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
    updateDrivePdf_:(id,b)=>{events.push('upload');files.get(id).bytes=Buffer.from(b.getBytes());},
    addTrackerUndoRecord_:(id,record)=>{if(failLog)throw Error('Undo log unavailable');records.push(record);}
  });
  return {c,source,template,orange,history,files,folders,records,events,cell,ss,originalLink,
    get link(){return link;},run:keepHistory=>c.generateForRow_(sh,3,'W',0,{sensei:'Amber',runId:'run',keepHistory}),
    allowLog:()=>{failLog=false;}};
}

test('Blue direct link is replaced with filled Orange template at the same Drive ID',async()=>{
  const h=await harness();const result=await h.run(false);
  assert.equal(result.url,h.originalLink);assert.equal(h.link,h.originalLink);
  assert.match(h.source.name,/Orange Belt/);
  const pdf=await lib.PDFDocument.load(h.source.bytes),form=pdf.getForm();
  assert.ok(form.getFieldMaybe('OrangeOnly'));assert.equal(form.getFieldMaybe('BlueOnly'),undefined);
  assert.equal(form.getTextField('Text1').getText(),'Naveed F');
  assert.equal(form.getDropdown('Dropdown2').getSelected()[0],'W');
  assert.equal(form.getTextField('Text3').getText(),'Working on Lvl 1 Build 1!');
  assert.equal(h.records[0].previousFileName,'PREVIEW Naveed F Blue Belt IMPACT Tracker.pdf');
  const backup=h.files.get(h.records[0].backupId);
  const original=await lib.PDFDocument.load(backup.bytes);
  assert.ok(original.getForm().getFieldMaybe('BlueOnly'));
  assert.ok(h.events.indexOf('create')<h.events.indexOf('upload'));
});

test('level-up creates history folder and new Orange PDF, preserving the Blue original',async()=>{
  const h=await harness();const before=Buffer.from(h.source.bytes);await h.run(true);
  assert.deepEqual(h.source.bytes,before);assert.match(h.source.name,/Blue Belt/);
  assert.match(h.link,/folders\//);const rec=h.records[0];assert.equal(rec.created,true);
  assert.equal(h.files.get(rec.archiveId).folder,h.folders.get(rec.folderId));
  assert.equal(h.c.locateTracker_(h.link,'IMPACT_Blue','Naveed F').file.getId(),rec.archiveId);
  const pdf=await lib.PDFDocument.load(h.files.get(rec.fileId).bytes);
  assert.equal(pdf.getForm().getDropdown('Dropdown2').getSelected()[0],'W');
  h.c.undoCreatedTracker_(rec,h.files.get(rec.fileId),h.ss);
  assert.equal(h.link,h.originalLink);assert.equal(h.files.get(rec.fileId).trashed,true);
  assert.equal(h.files.get(rec.archiveId).trashed,true);assert.equal(h.folders.get(rec.folderId).trashed,true);
  assert.equal(h.source.trashed,false);
});

test('existing folder adds missing Orange tracker without replacing earlier belts',async()=>{
  const h=await harness({folderLink:true});const before=Buffer.from(h.source.bytes);await h.run(false);
  assert.deepEqual(h.source.bytes,before);assert.equal(h.link,h.originalLink);
  assert.equal(h.records[0].folderId,'history');assert.equal(h.records[0].archiveId,null);
});

test('folder with earlier belts updates existing Orange PDF rather than making duplicates',async()=>{
  const h=await harness({folderLink:true,currentOrange:true});await h.run(true);
  assert.equal(h.records[0].fileId,'currentOrange');assert.equal(h.records[0].created,undefined);
  assert.equal(h.link,h.originalLink);assert.match(h.source.name,/Blue Belt/);
});

test('wrong student and inaccessible template do not change the linked file',async()=>{
  const h=await harness({wrongStudent:true});const before=Buffer.from(h.source.bytes);
  await assert.rejects(h.run(false),/differs from journal/);assert.deepEqual(h.source.bytes,before);
  const h2=await harness();h2.files.delete('templateOrange');const original=Buffer.from(h2.source.bytes);
  await assert.rejects(h2.run(false),/Missing templateOrange/);assert.deepEqual(h2.source.bytes,original);
  assert.equal(h2.records.length,0);
});

test('undo-log failure rolls back replacements, filenames, folder additions and links',async()=>{
  for(const keepHistory of [false,true]) {
    const h=await harness({logFailure:true});const before=Buffer.from(h.source.bytes);
    await assert.rejects(h.run(keepHistory),/Undo log unavailable/);
    assert.deepEqual(h.source.bytes,before);assert.match(h.source.name,/Blue Belt/);
    assert.equal(h.link,h.originalLink);
    if(keepHistory) assert.equal([...h.files.values()].filter(f=>f.folder?.name==='Naveed F Tracker PDFs'&&!f.trashed).length,0);
  }
});

test('folder undo preserves files and links changed after generation',async()=>{
  const h=await harness();await h.run(true);const rec=h.records[0];
  h.cell.setValue('https://drive.google.com/drive/folders/different');
  assert.throws(()=>h.c.undoCreatedTracker_(rec,h.files.get(rec.fileId),h.ss),/link changed/);
  assert.equal(h.files.get(rec.fileId).trashed,false);
});

test('Undo restores the replaced belt PDF contents and original filename',async()=>{
  const h=await harness();const before=Buffer.from(h.source.bytes);await h.run(false);
  const rec=h.records[0];let deleted=false;
  Object.assign(h.c,{
    LockService:{getDocumentLock:()=>({waitLock(){},releaseLock(){}})},
    lastTrackerRun_:()=>({id:'run',count:1}),
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>JSON.stringify(rec),deleteProperty:()=>{deleted=true;}})},
    SpreadsheetApp:{getActiveSpreadsheet:()=>h.ss},trackerRunKey_:()=> 'last'
  });
  const result=h.c.restoreLastTrackerRun_('run');
  assert.equal(result.restored,1);assert.equal(result.skipped,0);assert.equal(deleted,true);
  assert.deepEqual(h.source.bytes,before);assert.equal(h.source.name,rec.previousFileName);
});

test('email link helper extracts folder URLs from labels and HYPERLINK formulas',()=>{
  const c=vm.createContext({});vm.runInContext(script,c);
  const url='https://drive.google.com/drive/folders/history';
  assert.equal(c.getLink_({getRichTextValue:()=>({getLinkUrl:()=>url})}),url);
  assert.equal(c.getLink_({getRichTextValue:()=>null,getFormula:()=>`=HYPERLINK("${url}","Trackers")`}),url);
  assert.equal(c.getLink_({getRichTextValue:()=>null,getFormula:()=>'',getDisplayValue:()=>url}),url);
});


test('blank tracker link creates a filled Orange PDF and folder; Undo restores the blank link',async()=>{
  const h=await harness({blankLink:true});await h.run(false);
  const rec=h.records[0];assert.equal(rec.created,true);assert.equal(rec.archiveId,null);
  assert.match(h.link,/folders\//);
  const pdf=await lib.PDFDocument.load(h.files.get(rec.fileId).bytes);
  assert.ok(pdf.getForm().getFieldMaybe('OrangeOnly'));
  assert.equal(pdf.getForm().getDropdown('Dropdown2').getSelected()[0],'W');
  h.c.undoCreatedTracker_(rec,h.files.get(rec.fileId),h.ss);
  assert.equal(h.link,'');assert.equal(h.folders.get(rec.folderId).trashed,true);
});

test('failed missing-tracker creation restores the blank link and cleans generated files',async()=>{
  const h=await harness({blankLink:true,logFailure:true});
  await assert.rejects(h.run(false),/Undo log unavailable/);
  assert.equal(h.link,'');
  assert.equal([...h.folders.values()].filter(f=>f.name==='Naveed F Tracker PDFs'&&!f.trashed).length,0);
});

test('popup confirmation gates selected and entire-day server requests',()=>{
  const submit=script.slice(script.indexOf('  function submitCards(){'),script.indexOf('  function processNextBatch('));
  for(const scope of ['selected','day']) for(const confirmed of [false,true]) {
    const calls=[],prompts=[];
    const fields={sensei:{value:'Amber'},notes:{value:'Session notes'},keepHistory:{checked:true},summary:{textContent:''},results:{textContent:''}};
    const run={withSuccessHandler(){return run;},withFailureHandler(){return run;},
      generateFromPopup(...args){calls.push({kind:'selected',args});},beginDayTrackerRun_(...args){calls.push({kind:'day',args});}};
    const c=vm.createContext({scope,running:false,undoBusy:false,isScratchJr:false,isCS1:false,rows:[3,4],
      tab:'10-10',chosenRow:3,selectedName:'Naveed F',selectedCourse:'IMPACT_Orange',selectedProject:'Lvl 4 Build 2',
      completed:0,failed:0,cursor:0,el:id=>fields[id],buttonsDisabled(){},processNextBatch(){},
      google:{script:{run}},window:{confirm:message=>{prompts.push(message);return confirmed;}}});
    vm.runInContext(submit+';submitCards();',c);
    assert.equal(prompts.length,1);assert.match(prompts[0],/Missing trackers will be created/);
    assert.equal(calls.length,confirmed?1:0);
    if(confirmed) assert.equal(calls[0].kind,scope);
    if(confirmed&&scope==='selected')assert.equal(calls[0].args.at(-1),true);
  }
});
