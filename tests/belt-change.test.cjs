const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const lib=require('pdf-lib');
const script=fs.readFileSync(require.resolve('../PDFGenerator.gs'),'utf8');
const iterator=items=>{let i=0;return {hasNext:()=>i<items.length,next:()=>items[i++]};};

async function harness({folderLink=false,currentOrange=false,wrongStudent=false,logFailure=false,blankLink=false,sharingDenied=false}={}) {
  const files=new Map(),folders=new Map(),records=[],events=[];
  let seq=0,failLog=logFailure;
  const blob=(bytes,name)=>({getBytes:()=>Array.from(bytes),getName:()=>name});
  function file(name,bytes,id='f'+(++seq),folder=null) {
    const f={id,name,bytes:Buffer.from(bytes),trashed:false,
      getId:()=>id,getName:()=>f.name,setName:n=>{f.name=n;events.push('rename');return f;},
      setSharing:(access,permission)=>{if(sharingDenied)throw Error('Public sharing disabled');f.sharing={access,permission};return f;},
      getMimeType:()=> 'application/pdf',getUrl:()=>`https://drive.google.com/file/d/${id}/view`,
      getBlob:()=>blob(f.bytes,f.name),getParents:()=>iterator(folder?[folder]:[]),
      setTrashed:t=>{f.trashed=t;},makeCopy:(n,d)=>file(n,f.bytes,undefined,d)};
    f.folder=folder;files.set(id,f);return f;
  }
  function folder(name,id='d'+(++seq)) {
    const d={id,name,trashed:false,getName:()=>name,setSharing:(access,permission)=>{if(sharingDenied)throw Error('Public sharing disabled');d.sharing={access,permission};return d;},getId:()=>id,getUrl:()=>`https://drive.google.com/drive/folders/${id}`,
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
  const sh={getName:()=> '10-10',getLastRow:()=>3,getParent:()=>({}),getRange:(row,col,width,height)=>{
    if(col===1&&width===1&&height===5) return {getDisplayValues:()=>[['Naveed F','','','IMPACT_Orange','Lvl 1 Build 1']]};
    if(col===1) return {getDisplayValue:()=> 'Naveed F'};
    if(col===9) return cell;
    return {getDisplayValue:()=> 'PDF UPDATED'};
  }};
  const ss={getSheetByName:()=>sh};
  Object.assign(c,{
    DriveApp:{Access:{ANYONE_WITH_LINK:'ANYONE_WITH_LINK'},Permission:{VIEW:'VIEW'},getFileById:id=>{if(!files.has(id))throw Error('Missing '+id);return files.get(id);},
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
    get link(){return link;},run:()=>c.generateForRow_(sh,3,'W',0,{sensei:'Amber',runId:'run'}),
    allowLog:()=>{failLog=false;}};
}

test('new belt automatically creates a child-named folder with a filled Orange PDF and the old Blue tracker',async()=>{
  const h=await harness();const original=Buffer.from(h.source.bytes);const result=await h.run();
  assert.notEqual(result.url,h.originalLink);assert.equal(h.link,result.url);
  const rec=h.records[0],folder=h.folders.get(rec.folderId);
  assert.equal(folder.name,'Naveed F');
  assert.equal(h.files.get(rec.archiveId).folder,folder);
  assert.equal(h.files.get(rec.fileId).folder,folder);
  assert.deepEqual(h.source.bytes,original);assert.match(h.source.name,/Blue Belt/);
  const pdf=await lib.PDFDocument.load(h.files.get(rec.fileId).bytes),form=pdf.getForm();
  assert.ok(form.getFieldMaybe('OrangeOnly'));assert.equal(form.getFieldMaybe('BlueOnly'),undefined);
  assert.equal(form.getTextField('Text1').getText(),'Naveed F');
  assert.equal(form.getDropdown('Dropdown2').getSelected()[0],'W');
  assert.equal(form.getTextField('Text3').getText(),'Working on Lvl 1 Build 1!');
  assert.equal(h.events.includes('upload'),false);
});

test('level-up creates history folder and new Orange PDF, preserving the Blue original',async()=>{
  const h=await harness();const before=Buffer.from(h.source.bytes);await h.run();
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
  const h=await harness({folderLink:true});const before=Buffer.from(h.source.bytes);await h.run();
  assert.deepEqual(h.source.bytes,before);assert.equal(h.link,h.originalLink);
  assert.equal(h.records[0].folderId,'history');assert.equal(h.records[0].archiveId,null);
});

test('folder with earlier belts updates existing Orange PDF rather than making duplicates',async()=>{
  const h=await harness({folderLink:true,currentOrange:true});await h.run();
  assert.equal(h.records[0].fileId,'currentOrange');assert.equal(h.records[0].created,undefined);
  assert.equal(h.link,h.originalLink);assert.match(h.source.name,/Blue Belt/);
});

test('wrong student and inaccessible template do not change the linked file',async()=>{
  const h=await harness({wrongStudent:true});const before=Buffer.from(h.source.bytes);
  await assert.rejects(h.run(),/differs from journal/);assert.deepEqual(h.source.bytes,before);
  const h2=await harness();h2.files.delete('templateOrange');const original=Buffer.from(h2.source.bytes);
  await assert.rejects(h2.run(),/Missing templateOrange/);assert.deepEqual(h2.source.bytes,original);
  assert.equal(h2.records.length,0);
});

test('undo-log failure rolls back ordinary updates, folder additions and links',async()=>{
  for(const existing of [false,true]) {
    const h=await harness({logFailure:true,folderLink:existing,currentOrange:existing});
    const target=existing?h.orange:h.source,before=Buffer.from(target.bytes);
    await assert.rejects(h.run(),/Undo log unavailable/);
    assert.deepEqual(target.bytes,before);assert.equal(h.link,h.originalLink);
    if(!existing) assert.equal([...h.files.values()].filter(f=>f.folder?.name==='Naveed F'&&!f.trashed).length,0);
  }
});

test('folder undo preserves files and links changed after generation',async()=>{
  const h=await harness();await h.run();const rec=h.records[0];
  h.cell.setValue('https://drive.google.com/drive/folders/different');
  assert.throws(()=>h.c.undoCreatedTracker_(rec,h.files.get(rec.fileId),h.ss),/link changed/);
  assert.equal(h.files.get(rec.fileId).trashed,false);
});

test('Undo restores an ordinary tracker update from its backup',async()=>{
  const h=await harness({folderLink:true,currentOrange:true});const before=Buffer.from(h.orange.bytes);await h.run();
  const rec=h.records[0];let deleted=false;
  Object.assign(h.c,{
    LockService:{getDocumentLock:()=>({waitLock(){},releaseLock(){}})},
    lastTrackerRun_:()=>({id:'run',count:1}),
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>JSON.stringify(rec),deleteProperty:()=>{deleted=true;}})},
    SpreadsheetApp:{getActiveSpreadsheet:()=>h.ss},trackerRunKey_:()=> 'last'
  });
  const result=h.c.restoreLastTrackerRun_('run');
  assert.equal(result.restored,1);assert.equal(result.skipped,0);assert.equal(deleted,true);
  assert.deepEqual(h.orange.bytes,before);assert.equal(h.orange.name,rec.previousFileName);
});

test('email link helper extracts folder URLs from labels and HYPERLINK formulas',()=>{
  const c=vm.createContext({});vm.runInContext(script,c);
  const url='https://drive.google.com/drive/folders/history';
  assert.equal(c.getLink_({getRichTextValue:()=>({getLinkUrl:()=>url})}),url);
  assert.equal(c.getLink_({getRichTextValue:()=>null,getFormula:()=>`=HYPERLINK("${url}","Trackers")`}),url);
  assert.equal(c.getLink_({getRichTextValue:()=>null,getFormula:()=>'',getDisplayValue:()=>url}),url);
});


test('blank tracker link creates a filled Orange PDF and folder; Undo restores the blank link',async()=>{
  const h=await harness({blankLink:true});await h.run();
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
  await assert.rejects(h.run(),/Undo log unavailable/);
  assert.equal(h.link,'');
  assert.equal([...h.folders.values()].filter(f=>f.name==='Naveed F'&&!f.trashed).length,0);
});

test('new belt confirmation is shown only for additions and Cancel prevents student/day mutations',async()=>{
  for(const config of [{},{blankLink:true},{folderLink:true}]) {
    const h=await harness(config),prompts=[];
    h.c.SpreadsheetApp={getActiveSpreadsheet:()=>h.ss,getUi:()=>({
      ButtonSet:{OK_CANCEL:'buttons'},Button:{OK:'OK'},
      alert:(title,message)=>{prompts.push({title,message});return 'CANCEL';}})};
    h.c.LockService={getDocumentLock:()=>{throw Error('Cancelled request must not lock or write');}};
    const result=await h.c.generateFromPopup('10-10',3,'Amber',0,'',null,'');
    assert.equal(result.cancelled,true);assert.equal(h.records.length,0);assert.equal(h.link,h.originalLink);
    assert.match(prompts[0].title,/Add new belt/);assert.match(prompts[0].message,/Naveed F/);
    assert.equal(h.c.beginDayTrackerRun_('10-10'),null);
  }
  const h=await harness({folderLink:true,currentOrange:true});
  h.c.SpreadsheetApp={getUi:()=>{throw Error('Existing belt should not prompt');}};
  assert.equal(h.c.confirmNewTrackerBelts_(h.ss.getSheetByName('10-10'),[3]),true);
  const n=await harness();let message='';
  n.c.SpreadsheetApp={getUi:()=>({ButtonSet:{OK_CANCEL:'buttons'},Button:{OK:'OK'},alert:(title,text)=>{message=text;return 'OK';}})};
  assert.equal(n.c.confirmNewTrackerBelts_(n.ss.getSheetByName('10-10'),[3]),true);
  assert.match(message,/folder named "Naveed F"/);assert.match(message,/copy of the old tracker/);
});


test('new child folder, archived old tracker and new PDF all allow anyone with link to view',async()=>{
  const h=await harness();await h.run();const rec=h.records[0];
  for(const item of [h.folders.get(rec.folderId),h.files.get(rec.archiveId),h.files.get(rec.fileId)])
    assert.deepEqual(item.sharing,{access:'ANYONE_WITH_LINK',permission:'VIEW'});
  assert.equal(h.template.sharing,undefined);
  assert.equal(h.source.sharing,undefined); // Original stays outside the new shared folder.
});

test('updating existing folders shares previous and current belt PDFs, with no public backups',async()=>{
  const h=await harness({folderLink:true,currentOrange:true});
  h.source.name='Naveed F Blue Belt IMPACT Tracker.pdf';
  await h.run();
  for(const item of [h.history,h.source,h.orange])
    assert.deepEqual(item.sharing,{access:'ANYONE_WITH_LINK',permission:'VIEW'});
  assert.equal(h.files.get(h.records[0].backupId).sharing,undefined);
});

test('same-belt direct PDF gets link-view access',async()=>{
  const h=await harness();h.source.name='Naveed F Orange Belt IMPACT Tracker.pdf';
  h.source.bytes=Buffer.from(h.template.bytes);await h.run();
  assert.deepEqual(h.source.sharing,{access:'ANYONE_WITH_LINK',permission:'VIEW'});
});

test('sharing failure prevents success and cleans newly generated files without changing the old PDF',async()=>{
  const h=await harness({sharingDenied:true});const before=Buffer.from(h.source.bytes);
  await assert.rejects(h.run(),/Could not enable anyone-with-link viewing.*Public sharing disabled/);
  assert.equal(h.records.length,0);assert.equal(h.link,h.originalLink);assert.deepEqual(h.source.bytes,before);
  assert.equal([...h.folders.values()].filter(f=>f.name==='Naveed F'&&!f.trashed).length,0);
});

test('public whole-day entry points generate a real PDF and expose processing stages to the dialog',async()=>{
  const h=await harness();const values=new Map(),stages=[];
  h.ss.getId=()=> 'journal';
  h.c.SpreadsheetApp={getActiveSpreadsheet:()=>h.ss};
  h.c.PropertiesService={getScriptProperties:()=>({setProperty:(key,value)=>{
    values.set(key,value);if(key.startsWith('TRACKER_DAY_PROGRESS'))stages.push(JSON.parse(value).stage);
  },getProperty:key=>values.get(key)})};
  h.c.LockService={getDocumentLock:()=>({waitLock(){},releaseLock(){}})};
  h.c.confirmNewTrackerBelts_=()=>true;h.c.ensurePdfStatusColumn_=()=>{};
  h.c.beginTrackerRun_=()=> 'run';h.c.lastTrackerRun_=()=>({id:'run',tab:'10-10'});
  h.c.getSuggestedNote_=()=> 'Working on Lvl 1 Build 1!';
  assert.equal(h.c.beginDayTrackerRun('10-10'),'run');
  const results=await h.c.generateDayBatch('10-10',[3],'Amber','run');
  assert.equal(results.length,1);assert.equal(results[0].ok,true);assert.match(results[0].message,/Created tracker/);
  const progress=h.c.getDayTrackerProgress('10-10','run');
  assert.equal(progress.name,'Naveed F');assert.equal(progress.stage,'Completed');
  for(const expected of ['Finding the student tracker','Filling project markers and notes','Saving and validating PDF markers',
    'Creating the student folder and keeping the old tracker','Enabling anyone-with-link viewing','Completed'])assert.ok(stages.includes(expected),expected);
});
