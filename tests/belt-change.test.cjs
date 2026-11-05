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
      getSharingAccess:()=>f.sharing?.access||'PRIVATE',getSharingPermission:()=>f.sharing?.permission||'NONE',
      setSharing:(access,permission)=>{if(sharingDenied)throw Error('Public sharing disabled');f.sharing={access,permission};return f;},
      getMimeType:()=> 'application/pdf',getUrl:()=>`https://drive.google.com/file/d/${id}/view`,
      getBlob:()=>blob(f.bytes,f.name),getParents:()=>iterator(folder?[folder]:[]),
      setTrashed:t=>{f.trashed=t;},makeCopy:(n,d)=>file(n,f.bytes,undefined,d)};
    f.folder=folder;files.set(id,f);return f;
  }
  function folder(name,id='d'+(++seq)) {
    const d={id,name,trashed:false,getName:()=>name,getSharingAccess:()=>d.sharing?.access||'PRIVATE',getSharingPermission:()=>d.sharing?.permission||'NONE',setSharing:(access,permission)=>{if(sharingDenied)throw Error('Public sharing disabled');d.sharing={access,permission};return d;},getId:()=>id,getUrl:()=>`https://drive.google.com/drive/folders/${id}`,
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
  let link=originalLink,ready=false;
  const readyCell={getValue:()=>ready,setValue:value=>{events.push('ready');ready=value;}};
  const cell={getRichTextValue:()=>null,getFormula:()=>'',getDisplayValue:()=>link,getColumn:()=>9,setValue:v=>{events.push('link');link=v;}};
  const sh={getName:()=> '10-10',getLastRow:()=>3,getParent:()=>({}),getRange:(row,col,width,height)=>{
    if(col===1&&width===1&&height===5) return {getDisplayValues:()=>[['Naveed F','','','IMPACT_Orange','Lvl 1 Build 1']]};
    if(col===1) return {getDisplayValue:()=> 'Naveed F'};
    if(col===9) return cell;
    if(col===11) return readyCell;
    return {getDisplayValue:()=> 'PDF UPDATED'};
  }};
  const ss={getSheetByName:()=>sh};
  Object.assign(c,{
    DriveApp:{Access:{ANYONE_WITH_LINK:'ANYONE_WITH_LINK',ANYONE:'ANYONE'},Permission:{VIEW:'VIEW',COMMENT:'COMMENT',EDIT:'EDIT'},getFileById:id=>{if(!files.has(id))throw Error('Missing '+id);return files.get(id);},
      getFolderById:id=>folders.get(id),createFolder:folder},MimeType:{PDF:'application/pdf'},
    Utilities:{newBlob:(bytes,type,name)=>blob(bytes,name)},
    getPdfLib_:()=>lib,getSessionDate_:()=>({short:'10/10/26'}),
    getCurriculum_:()=>({course:'IMPACT_Orange',tasks:['Lvl 1 Build 1','Lvl 1 Build 2','Lvl 1 Solve 1']}),
    assertTrackerRun_:()=>{},setTrackerIndicator_:()=>{},getUndoFolder_:()=>folder('Backups'),
    hashPdfBytes_:bytes=>crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
    updateDrivePdf_:(id,b)=>{events.push('upload');files.get(id).bytes=Buffer.from(b.getBytes());},
    addTrackerUndoRecord_:(id,record)=>{if(failLog)throw Error('Undo log unavailable');events.push('undo');records.push(record);}
  });
  return {c,source,template,orange,history,files,folders,records,events,cell,ss,originalLink,
    get link(){return link;},get ready(){return ready;},run:()=>c.generateForRow_(sh,3,'W',0,{sensei:'Amber',runId:'run'}),
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


test('already-public folder and PDFs update without permission to change sharing',async()=>{
  const h=await harness({folderLink:true,currentOrange:true,sharingDenied:true});
  for(const item of [h.history,h.source,h.orange])item.sharing={access:'ANYONE_WITH_LINK',permission:'VIEW'};
  await h.run();assert.equal(h.records.length,1);
  const pdf=await lib.PDFDocument.load(h.orange.bytes);
  assert.equal(pdf.getForm().getDropdown('Dropdown2').getSelected()[0],'W');
});

test('already-public direct PDF can be updated by an editor who cannot reshare it',async()=>{
  const h=await harness({sharingDenied:true});
  h.source.name='Naveed F Orange Belt IMPACT Tracker.pdf';h.source.bytes=Buffer.from(h.template.bytes);
  h.source.sharing={access:'ANYONE_WITH_LINK',permission:'VIEW'};
  await h.run();assert.equal(h.records.length,1);
});

test('public comment and edit access are preserved, while domain-only access must be changed',async()=>{
  const h=await harness();
  for(const access of ['ANYONE','ANYONE_WITH_LINK'])for(const permission of ['VIEW','COMMENT','EDIT']){
    h.c.shareTrackerViewLinks_({getSharingAccess:()=>access,getSharingPermission:()=>permission,
      setSharing(){throw Error('Must not change existing public access');}},null);
  }
  let changed=false;
  h.c.shareTrackerViewLinks_({getSharingAccess:()=> 'DOMAIN_WITH_LINK',getSharingPermission:()=> 'VIEW',
    setSharing:(access,permission)=>{changed=true;assert.equal(access,'ANYONE_WITH_LINK');assert.equal(permission,'VIEW');}},null);
  assert.equal(changed,true);
});

test('a denied sharing write is accepted only if a fresh read confirms public access',async()=>{
  const h=await harness();let reads=0;
  h.c.shareTrackerViewLinks_({getSharingAccess:()=>++reads>1?'ANYONE_WITH_LINK':'PRIVATE',
    getSharingPermission:()=> 'VIEW',setSharing(){throw Error('Access denied: DriveApp');}},null);
  assert.equal(reads,2);
});


test('successful PDF creation or update checks column K only after the PDF and Undo record are saved',async()=>{
  for(const config of [{},{folderLink:true,currentOrange:true},{blankLink:true}]){
    const h=await harness(config);assert.equal(h.ready,false);await h.run();
    assert.equal(h.ready,true);assert.ok(h.events.indexOf('ready')>h.events.indexOf('undo'));
  }
});

test('failed generation does not check Ready, including sharing and Undo-log failures',async()=>{
  for(const config of [{wrongStudent:true},{sharingDenied:true},{logFailure:true}]){
    const h=await harness(config);await assert.rejects(h.run());
    assert.equal(h.ready,false);assert.equal(h.events.includes('ready'),false);
  }
});

async function beltFixture(c,course,student='Naveed F') {
  const meta=vm.runInContext('TRACKER_FIELDS.'+course,c),pdf=await lib.PDFDocument.create(),page=pdf.addPage([612,2200]),form=pdf.getForm();
  const texts=meta.type==='UNITY'?['Ninjas Name',...meta.rows.map(r=>r.note)]:['Text1','Text2','Date3_af_date','Text3','Text4'];
  let y=2100;
  for(const name of new Set(texts)){form.createTextField(name).addToPage(page,{x:100,y:y-=25,width:400,height:20});}
  form.getTextField(meta.type==='UNITY'?'Ninjas Name':'Text1').setText(student);
  const groups=meta.type==='UNITY'?[meta.rows.map(r=>r.status)]:meta.levels;
  groups.forEach(names=>names.forEach((name,i)=>{
    const field=form.getFieldMaybe(name)||form.createDropdown(name);field.setOptions(meta.type==='IMPACT'&&i===names.length-1?['R','L',' ']:['W','C','S','R',' ']);
    field.addToPage(page,{x:20,y:y-=25,width:55,height:20});
  }));
  return {pdf,meta,bytes:Buffer.from(await pdf.save())};
}
function setJournalBelt(h,current,previous,project,tasks) {
  const sheet=h.ss.getSheetByName('10-10'),original=sheet.getRange;
  sheet.getRange=(r,c,nr,nc)=>nr===1&&nc===5?
    {getDisplayValues:()=>[['Naveed F',previous,'',current,project]]}:
    !nr && c===4?{getDisplayValue:()=>current}:!nr && c===5?{getDisplayValue:()=>project}:original(r,c,nr,nc);
  h.c.getCurriculum_=()=>({course:current,tasks});
  h.c.getSessionDate_=()=>({iso:'2026-10-24',short:'10/24/26'});
}
async function configureUnity(h,{previous='UNITY_Platinum',current='UNITY_Platinum'}={}) {
  const old=await beltFixture(h.c,previous),blank=await beltFixture(h.c,current,'');
  h.source.name=`Naveed F ${previous.split('_')[1]} Belt Unity Tracker.pdf`;h.source.bytes=old.bytes;
  h.template.name=`${current.split('_')[1]} Belt Unity Template.pdf`;h.template.bytes=blank.bytes;
  vm.runInContext(`CONFIG.TEMPLATES.${current}='templateOrange'`,h.c);
  const tasks=blank.meta.rows.map((r,i)=>'Unity project '+(i+1));
  setJournalBelt(h,current,previous,tasks[1],tasks);
  return {old,blank};
}

test('Unity current project saves visible Working date and preceding projects become C with dated text',async()=>{
  const h=await harness(),{old}=await configureUnity(h);await h.run();
  const saved=await lib.PDFDocument.load(h.source.bytes),form=saved.getForm();
  assert.equal(form.getDropdown(old.meta.rows[0].status).getSelected()[0],'C');
  assert.equal(form.getTextField(old.meta.rows[0].note).getText(),'10/24/26 Done');
  assert.equal(form.getDropdown(old.meta.rows[1].status).getSelected()[0],'W');
  assert.equal(form.getTextField(old.meta.rows[1].note).getText(),'10/24/26 WIP');
  assert.equal(form.getDropdown(old.meta.rows[2].status).getSelected()[0]||'','');
  const {PDFName,decodePDFRawStream}=lib;
  const widget=form.getTextField(old.meta.rows[1].note).acroField.getWidgets()[0];
  const stream=widget.dict.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
  const appearance=Buffer.from(decodePDFRawStream(stream).decode()).toString();
  assert.match(appearance,new RegExp(Buffer.from('10/24/26 WIP').toString('hex'),'i'));
});

test('Unity promotion puts an all-completed dated previous card in the child folder and keeps the original intact',async()=>{
  const h=await harness(),{old}=await configureUnity(h,{previous:'UNITY_Silver'}),before=Buffer.from(h.source.bytes);
  await h.run();const rec=h.records[0];assert.ok(rec.archiveId);assert.deepEqual(h.source.bytes,before);
  const archived=(await lib.PDFDocument.load(h.files.get(rec.archiveId).bytes)).getForm();
  for(const row of old.meta.rows){assert.equal(archived.getDropdown(row.status).getSelected()[0],'C');assert.equal(archived.getTextField(row.note).getText(),'10/24/26 Done');}
  const current=(await lib.PDFDocument.load(h.files.get(rec.fileId).bytes)).getForm();
  assert.equal(current.getTextField('undefined_2').getText(),'10/24/26 WIP');
  h.c.undoCreatedTracker_(rec,h.files.get(rec.fileId),h.ss);
  assert.equal(h.files.get(rec.archiveId).trashed,true);assert.deepEqual(h.source.bytes,before);assert.equal(h.link,h.originalLink);
});

test('IMPACT promotion also completes every prior work/level-up field and writes a dated Completed note',async()=>{
  const h=await harness(),old=await beltFixture(h.c,'IMPACT_Yellow');
  old.pdf.getForm().getDropdown('Dropdown1').select('S');
  h.source.bytes=Buffer.from(await old.pdf.save());h.source.name='Naveed F Yellow Belt IMPACT Tracker.pdf';
  const before=Buffer.from(h.source.bytes);await h.run();const rec=h.records[0];
  const archived=(await lib.PDFDocument.load(h.files.get(rec.archiveId).bytes)).getForm();
  for(const names of old.meta.levels)for(let i=0;i<names.length;i++)
    assert.equal(archived.getDropdown(names[i]).getSelected()[0],i===names.length-1?'L':'C');
  assert.equal(archived.getTextField('Text3').getText(),'Completed 10/10/2026');
  assert.deepEqual(h.source.bytes,before);
});

async function promotionInExistingFolder(options={}) {
  const h=await harness({folderLink:true,...options}),old=await beltFixture(h.c,'IMPACT_Yellow');
  h.source.name='Naveed F Yellow Belt IMPACT Tracker.pdf';h.source.bytes=old.bytes;
  setJournalBelt(h,'IMPACT_Orange','IMPACT_Yellow','Lvl 1 Build 1',['Lvl 1 Build 1']);
  return h;
}

test('existing student folder completes the prior belt in place and Undo restores it along with the new card/link',async()=>{
  const h=await promotionInExistingFolder(),before=Buffer.from(h.source.bytes);await h.run();const rec=h.records[0];
  assert.equal(rec.previousBeltCompletion.fileId,h.source.getId());assert.ok(rec.previousBeltCompletion.backupId);
  const old=(await lib.PDFDocument.load(h.source.bytes)).getForm();assert.equal(old.getTextField('Text3').getText(),'Completed 10/24/2026');
  h.c.undoCreatedTracker_(rec,h.files.get(rec.fileId),h.ss);
  assert.deepEqual(h.source.bytes,before);assert.equal(h.files.get(rec.fileId).trashed,true);assert.equal(h.link,h.originalLink);
});

test('failed generation rolls back the completed previous belt when the Undo log cannot be saved',async()=>{
  for(const currentOrange of [false,true]){
    const h=await promotionInExistingFolder({currentOrange,logFailure:true}),before=Buffer.from(h.source.bytes);
    const currentBefore=currentOrange?Buffer.from(h.orange.bytes):null;
    await assert.rejects(h.run(),/Undo log unavailable/);assert.deepEqual(h.source.bytes,before);
    if(currentOrange)assert.deepEqual(h.orange.bytes,currentBefore);
    assert.equal(h.link,h.originalLink);assert.equal(h.ready,false);
  }
});

test('Undo refuses to overwrite a previous belt edited since promotion',async()=>{
  const h=await promotionInExistingFolder();await h.run();const rec=h.records[0];
  h.source.bytes=Buffer.concat([h.source.bytes,Buffer.from('changed')]);
  assert.throws(()=>h.c.undoCreatedTracker_(rec,h.files.get(rec.fileId),h.ss),/Previous belt PDF changed/);
  assert.equal(h.files.get(rec.fileId).trashed,false);assert.equal(h.link,h.originalLink);
});

test('repeated generation preserves previous completion dates and does not complete a higher belt on downgrade',async()=>{
  const h=await promotionInExistingFolder({currentOrange:true});await h.run();
  const previous=Buffer.from(h.source.bytes);
  h.c.getSessionDate_=()=>({iso:'2026-10-25',short:'10/25/26'});
  await h.c.generateForRow_(h.ss.getSheetByName('10-10'),3,'W',0,{sensei:'Different Sensei',runId:'run'});
  assert.deepEqual(h.source.bytes,previous);assert.equal(h.records[1].previousBeltCompletion,null);
  const down=await harness(),before=Buffer.from(down.source.bytes);await down.run();
  assert.deepEqual(down.files.get(down.records[0].archiveId).bytes,before);
});


test('Brown promotion completes shared source widgets without treating all-completed values as ambiguous',async()=>{
  const h=await harness(),old=await beltFixture(h.c,'IMPACT_Brown'),next=await beltFixture(h.c,'IMPACT_Red','');
  h.source.name='Naveed F Brown Belt IMPACT Tracker.pdf';h.source.bytes=old.bytes;
  h.template.name='Red Belt IMPACT Template.pdf';h.template.bytes=next.bytes;
  vm.runInContext("CONFIG.TEMPLATES.IMPACT_Red='templateOrange'",h.c);
  setJournalBelt(h,'IMPACT_Red','IMPACT_Brown','Lvl 1 Build 1',['Lvl 1 Build 1']);
  await h.run();const saved=(await lib.PDFDocument.load(h.files.get(h.records[0].archiveId).bytes)).getForm();
  assert.equal(saved.getDropdown('Dropdown4A').getSelected()[0],'C');
  assert.equal(saved.getDropdown('Dropdown4A').acroField.getWidgets().length,2);
  assert.match(saved.getTextField('Text3').getText(),/^Completed /);
});

test('Undo of an existing current-belt update restores both current and previously completed belt PDFs',async()=>{
  const h=await promotionInExistingFolder({currentOrange:true});
  const beforeOld=Buffer.from(h.source.bytes),beforeCurrent=Buffer.from(h.orange.bytes);await h.run();const rec=h.records[0];
  Object.assign(h.c,{LockService:{getDocumentLock:()=>({waitLock(){},releaseLock(){}})},
    lastTrackerRun_:()=>({id:'run',count:1}),PropertiesService:{getScriptProperties:()=>({getProperty:()=>JSON.stringify(rec),deleteProperty(){}})},
    SpreadsheetApp:{getActiveSpreadsheet:()=>h.ss},trackerRunKey_:()=> 'last'});
  assert.equal(h.c.restoreLastTrackerRun_('run').restored,1);
  assert.deepEqual(h.source.bytes,beforeOld);assert.deepEqual(h.orange.bytes,beforeCurrent);
});


test('single-student Unity generation accepts no Sensei and uses automatic text without supplied notes',async()=>{
  const h=await harness();await configureUnity(h);
  Object.assign(h.c,{SpreadsheetApp:{getActiveSpreadsheet:()=>h.ss},
    LockService:{getDocumentLock:()=>({waitLock(){},releaseLock(){}})},
    confirmNewTrackerBelts_:()=>true,ensurePdfStatusColumn_(){},beginTrackerRun_:()=> 'run'});
  await h.c.generateFromPopup('10-10',3,'',0,'Do not add this note',null,'');
  const saved=(await lib.PDFDocument.load(h.source.bytes)).getForm();
  assert.equal(saved.getTextField('undefined_2').getText(),'10/24/26 WIP');assert.equal(h.ready,true);
});

test('Unity-only day generation and level-ups accept an empty Sensei',async()=>{
  const h=await harness({folderLink:true});await configureUnity(h,{previous:'UNITY_Silver'});
  Object.assign(h.c,{SpreadsheetApp:{getActiveSpreadsheet:()=>h.ss},
    LockService:{getDocumentLock:()=>({waitLock(){},releaseLock(){}})},reportDayTrackerProgress_(){}});
  const result=await h.c.generateDayBatch('10-10',[3],'','run');
  assert.equal(result[0].ok,true,JSON.stringify(result));assert.equal(h.ready,true);
  const old=(await lib.PDFDocument.load(h.source.bytes)).getForm();
  assert.equal(old.getTextField('undefined').getText(),'10/24/26 Done');
});

test('non-Unity programs still require Sensei before any tracker is changed',async()=>{
  const h=await harness();const before=Buffer.from(h.source.bytes);
  await assert.rejects(h.c.generateForRow_(h.ss.getSheetByName('10-10'),3,'W',0,{sensei:'',runId:'run'}),/Sensei/);
  assert.deepEqual(h.source.bytes,before);assert.equal(h.ready,false);
});

test('Unity uses compact date-first labels at 12 points while preserving historical dates and the name font',async()=>{
  const h=await harness(),{old}=await configureUnity(h);
  const sourcePdf=await lib.PDFDocument.load(h.source.bytes),form=sourcePdf.getForm();
  form.getTextField('Ninjas Name').setFontSize(24);
  form.getDropdown(old.meta.rows[0].status).select('C');
  form.getTextField(old.meta.rows[0].note).setText('Completed 09/12/2025');
  form.getTextField(old.meta.rows[0].note).setFontSize(28);
  const current=form.getTextField(old.meta.rows[1].note);current.setText('Working 10/10/2026');current.setFontSize(28);
  const widget=current.acroField.getWidgets()[0];widget.setRectangle({...widget.getRectangle(),width:130});
  form.getDropdown(old.meta.rows[3].status).select('W');
  form.getTextField(old.meta.rows[3].note).setText('10/11/26 WIP');
  h.source.bytes=Buffer.from(await sourcePdf.save());await h.run();
  const saved=await lib.PDFDocument.load(h.source.bytes),result=saved.getForm();
  assert.equal(result.getTextField(old.meta.rows[0].note).getText(),'09/12/25 Done');
  assert.equal(result.getTextField(old.meta.rows[1].note).getText(),'10/10/26 WIP');
  for(const index of [0,1])assert.match(result.getTextField(old.meta.rows[index].note).acroField.getDefaultAppearance(),/12 Tf/);
  assert.match(result.getTextField('Ninjas Name').acroField.getDefaultAppearance(),/24 Tf/);
  assert.equal(result.getTextField(old.meta.rows[3].note).getText(),'10/11/26 WIP');
  assert.equal((result.getDropdown(old.meta.rows[3].status).getSelected()[0]||'').trim(),'');
  const font=await saved.embedFont(lib.StandardFonts.Helvetica);
  assert.ok(font.widthOfTextAtSize('10/24/26 WIP',12)<126);
});

test('completed Unity cards convert old Completed text to short dated labels and cap the font',async()=>{
  const h=await harness(),{old}=await configureUnity(h,{previous:'UNITY_Silver'});
  const pdf=await lib.PDFDocument.load(h.source.bytes),field=pdf.getForm().getTextField(old.meta.rows[0].note);
  field.setText('Completed 09/12/2025');field.setFontSize(28);h.source.bytes=Buffer.from(await pdf.save());
  await h.run();const result=(await lib.PDFDocument.load(h.files.get(h.records[0].archiveId).bytes)).getForm();
  assert.equal(result.getTextField(old.meta.rows[0].note).getText(),'09/12/25 Done');
  assert.match(result.getTextField(old.meta.rows[0].note).acroField.getDefaultAppearance(),/12 Tf/);
  assert.equal(result.getTextField(old.meta.rows[1].note).getText(),'10/24/26 Done');
});


test('Unity preserves Timothy-style dated comments during repeated updates instead of inserting the journal date',async()=>{
  const h=await harness(),{old}=await configureUnity(h);
  const original=await lib.PDFDocument.load(h.source.bytes),form=original.getForm();
  form.getDropdown(old.meta.rows[0].status).select('C');
  form.getTextField(old.meta.rows[0].note).setText('7/21/2026 Complete!');
  form.getDropdown(old.meta.rows[1].status).select('W');
  form.getTextField(old.meta.rows[1].note).setText('10/23/26 Making very impressive progress');
  h.source.bytes=Buffer.from(await original.save());
  for(const short of ['11/04/26','11/05/26']){
    h.c.getSessionDate_=()=>({short});await h.run();
    const saved=(await lib.PDFDocument.load(h.source.bytes)).getForm();
    assert.equal(saved.getTextField(old.meta.rows[0].note).getText(),'7/21/2026 Complete!');
    assert.equal(saved.getTextField(old.meta.rows[1].note).getText(),'10/23/26 Making very impressive progress');
    assert.equal(saved.getDropdown(old.meta.rows[1].status).getSelected()[0],'W');
  }
});

test('Unity automatic WIP labels retain their original date on repeated updates',async()=>{
  const h=await harness(),{old}=await configureUnity(h);await h.run();
  h.c.getSessionDate_=()=>({iso:'2026-11-04',short:'11/04/26'});await h.run();
  const saved=(await lib.PDFDocument.load(h.source.bytes)).getForm();
  assert.equal(saved.getTextField(old.meta.rows[1].note).getText(),'10/24/26 WIP');
});

test('Unity level-up completion preserves dates from working and custom dated notes',async()=>{
  const h=await harness(),{old}=await configureUnity(h,{previous:'UNITY_Silver'});
  const pdf=await lib.PDFDocument.load(h.source.bytes),form=pdf.getForm();
  form.getTextField(old.meta.rows[0].note).setText('7/21/2026 Complete!');
  form.getTextField(old.meta.rows[1].note).setText('10/23/26 Making very impressive progress');
  form.getTextField(old.meta.rows[2].note).setText('Working 10/10/2026');
  h.source.bytes=Buffer.from(await pdf.save());await h.run();
  const archived=(await lib.PDFDocument.load(h.files.get(h.records[0].archiveId).bytes)).getForm();
  assert.equal(archived.getTextField(old.meta.rows[0].note).getText(),'07/21/26 Done');
  assert.equal(archived.getTextField(old.meta.rows[1].note).getText(),'10/23/26 Done');
  assert.equal(archived.getTextField(old.meta.rows[2].note).getText(),'10/10/26 Done');
});
