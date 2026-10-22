const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync(require.resolve('../Code.gs'),'utf8');

class Sheet {
  constructor(name,data){this.name=name;this.data=data;this.cells=new Map();this.parent=null;}
  getName(){return this.name;}getParent(){return this.parent;}
  getLastRow(){return this.data.length;}getLastColumn(){return Math.max(1,...this.data.map(r=>r.length));}
  getRange(row,col,nr=1,nc=1){
    const sheet=this,key=row+':'+col;
    const state=()=>{if(!sheet.cells.has(key))sheet.cells.set(key,{});return sheet.cells.get(key);};
    const range={getSheet:()=>sheet,getRow:()=>row,getLastRow:()=>row+nr-1,getColumn:()=>col,getLastColumn:()=>col+nc-1,
      getValue:()=>sheet.data[row-1]?.[col-1]??'',getDisplayValue:()=>String(range.getValue()),
      getValues:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>sheet.data[row+i-1]?.[col+j-1]??'')),
      getDisplayValues:()=>range.getValues().map(r=>r.map(String)),
      setValue:value=>{while(sheet.data.length<row)sheet.data.push([]);sheet.data[row-1][col-1]=value;state().rich=null;state().formula='';return range;},
      setBackground:value=>{state().color=value;return range;},
      getRichTextValue:()=>state().rich||null,getFormula:()=>state().formula||'',
      setDataValidation:value=>{state().validation=value;return range;},
      clearDataValidations:()=>{state().validation=null;return range;},clearContent:()=>range.setValue('')};
    return range;
  }
  labeled(row,col,text,url){this.getRange(row,col).setValue(text);this.cells.get(row+':'+col).rich={getLinkUrl:()=>url};}
  formula(row,col,text,formula){this.getRange(row,col).setValue(text);this.cells.get(row+':'+col).formula=formula;}
}
const folder='https://drive.google.com/drive/folders/new-history';
const oldPdf='https://drive.google.com/file/d/old-blue/view';
const jrPdf='https://drive.google.com/file/d/junior/view';
function row(name='Naveed F',overrides={}){
  const data=[name,'IMPACT_Blue','Lvl 6 Build 1','IMPACT_Orange','Lvl 4 Build 2','keep on task','','parent@example.com',folder,'',true,'NOT SENT','7/11/2026','PDF UPDATED'];
  for(const [col,value]of Object.entries(overrides))data[Number(col)-1]=value;return data;
}
function harness(rows=[row()]){
  const daily=new Sheet('10-10',[['Student','','','Belt','Project','','','Email','Tracker','Jr','Ready','Status','Updated','PDF STATUS'],[],...rows]);
  const clients=new Sheet('Clients',[['Name','Email','Tracker','Jr','Level','Project','Notes','Updated'],
    ['Naveed F','parent@example.com',oldPdf,jrPdf,'IMPACT_Blue','Lvl 6 Build 1','old note','7/11/2026'],
    ['Jack S','jack@example.com',oldPdf,'','IMPACT_White','Lvl 1 Build 1','old note','']]);
  const courses=new Sheet('Courses',[['CS_1','Fundamentals','IMPACT_Orange','IMPACT_Blue'],
    ['<ninja> / <level> / <date>','Maze','Lvl 4 Build 1','Lvl 5 Solve 1'],
    ['CS1 Project','Hide and Seek','Lvl 4 Build 2','Lvl 5 Solve 2']]);
  const sent=[],rendered=[],locks=[],notices=[];let response='OK',active=daily,sendFailure=false;
  const sheets=[daily,clients,courses];
  const ss={getName:()=> 'Journal 10-2026',getActiveSheet:()=>active,getSheetByName:name=>sheets.find(s=>s.name===name),getSheets:()=>sheets,
    toast:(message,title)=>notices.push({message,title})};
  for(const sheet of sheets)sheet.parent=ss;
  const c=vm.createContext({console:{log(){},error(){}}});
  const validation=()=>{const v={requireValueInList:values=>{v.values=Array.from(values);return v;},requireCheckbox:()=>{v.checkbox=true;return v;},build:()=>v};return v;};
  Object.assign(c,{
    SpreadsheetApp:{getActiveSpreadsheet:()=>ss,newDataValidation:validation,getUi:()=>({Button:{OK:'OK',CANCEL:'CANCEL'},ButtonSet:{OK_CANCEL:'both'},alert:()=>response})},
    LockService:{getDocumentLock:()=>({waitLock:()=>locks.push('lock'),releaseLock:()=>locks.push('unlock')})},
    HtmlService:{createTemplateFromFile:name=>{const t={evaluate:()=>{rendered.push({name,trackerLink:t.trackerLink,jrLink:t.jrLink});return {getContent:()=>`<a href="${t.trackerLink}">Tracker</a>`};}};return t;}},
    MailApp:{sendEmail:email=>{if(sendFailure)throw Error('Mail failure');sent.push(email);}}
  });
  vm.runInContext(code,c);
  return {c,daily,clients,courses,sent,rendered,locks,notices,sheets,ss,setCancel:()=>{response='CANCEL';},
    setActive:s=>{active=s;},failSend:()=>{sendFailure=true;},addSheet:s=>{s.parent=ss;sheets.push(s);}};
}

test('Cancel sends no email and performs no journal or Clients writes',()=>{
  const h=harness();h.setCancel();const before=JSON.stringify([h.daily.data,h.clients.data]);
  const result=h.c.sendEmails(true);
  assert.equal(result.cancelled,true);assert.equal(h.sent.length,0);assert.equal(h.locks.length,0);
  assert.equal(JSON.stringify([h.daily.data,h.clients.data]),before);
});

test('email uses journal date and labeled folder URL, then saves progress and tracker URLs to Clients',()=>{
  const h=harness();h.daily.labeled(3,9,'All belt trackers',folder);
  h.daily.formula(3,10,'Junior',`=HYPERLINK("${jrPdf}","Junior")`);
  const result=h.c.sendEmails(true);
  assert.equal(result.sent,1);assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].subject,'Naveed F / IMPACT_Orange / October 10, 2026');
  assert.ok(h.sent[0].htmlBody.includes(folder));assert.equal(h.sent[0].attachments,undefined);
  assert.equal(h.daily.getRange(3,12).getValue(),'EMAIL SENT');
  assert.equal(h.clients.getRange(2,3).getValue(),folder);assert.equal(h.clients.getRange(2,4).getValue(),jrPdf);
  assert.equal(h.clients.getRange(2,5).getValue(),'IMPACT_Orange');
  assert.equal(h.clients.getRange(2,6).getValue(),'Lvl 4 Build 2');
  assert.equal(h.clients.getRange(2,7).getValue(),'keep on task');
  assert.deepEqual(h.locks,['lock','unlock']);
  h.c.sendEmails();assert.equal(h.sent.length,1);
});

test('one ready row with a stale PDF blocks all emails before any send',()=>{
  for(const status of ['FAILED','NEEDS UPDATE','GENERATING','UNDONE','NOT GENERATED','']){
    const h=harness([row(),row('Jack S',{14:status})]);
    assert.throws(()=>h.c.sendEmails(),/No emails sent.*\nRow 4.*PDF STATUS/s);
    assert.equal(h.sent.length,0);assert.equal(h.daily.getRange(3,12).getValue(),'NOT SENT');
    assert.deepEqual(h.locks,['lock','unlock']);
  }
});

test('unchecked rows and already sent rows are skipped, including their PDF validation',()=>{
  const h=harness([row('Naveed F',{11:false,14:'FAILED'}),row('Jack S',{12:'EMAIL SENT',14:'FAILED'})]);
  assert.equal(h.c.sendEmails().sent,0);assert.equal(h.sent.length,0);
});

test('non-journal active tabs, invalid session dates, duplicate Clients and template errors cannot send',()=>{
  const h=harness();h.setActive(h.clients);assert.throws(()=>h.c.sendEmails(),/dated journal tab/);
  h.setActive(h.daily);h.daily.name='02-30';assert.throws(()=>h.c.sendEmails(),/Invalid journal date/);
  h.daily.name='10-10';h.clients.data.push([...h.clients.data[1]]);
  assert.throws(()=>h.c.sendEmails(),/Duplicate student/);assert.equal(h.sent.length,0);
  const h2=harness();h2.c.HtmlService.createTemplateFromFile=()=>{throw Error('Missing HTML template');};
  assert.throws(()=>h2.c.sendEmails(),/No emails sent.*Missing HTML template/s);assert.equal(h2.sent.length,0);
});

test('Mail failure does not mark sent or update Clients; a Clients failure after sending does not resend',()=>{
  const h=harness();h.failSend();assert.throws(()=>h.c.sendEmails(),/Mail failure/);
  assert.equal(h.daily.getRange(3,12).getValue(),'NOT SENT');assert.equal(h.clients.getRange(2,3).getValue(),oldPdf);
  const h2=harness();h2.c.saveClientProgressByRow=()=>{throw Error('Clients write failed');};
  assert.throws(()=>h2.c.sendEmails(),/Clients write failed/);assert.equal(h2.sent.length,1);
  assert.equal(h2.daily.getRange(3,12).getValue(),'EMAIL SENT');h2.c.sendEmails();assert.equal(h2.sent.length,1);
});

test('editing an older journal loads saved folder links, resets readiness and stale current fields',()=>{
  const h=harness();h.clients.labeled(2,3,'Trackers',folder);h.daily.getRange(3,12).setValue('EMAIL SENT');
  h.c.onEdit({range:h.daily.getRange(3,1)});
  assert.equal(h.daily.getRange(3,9).getValue(),folder);
  assert.equal(h.daily.getRange(3,2).getValue(),'IMPACT_Blue');assert.equal(h.daily.getRange(3,3).getValue(),'Lvl 6 Build 1');
  assert.equal(h.daily.getRange(3,4).getValue(),'');assert.equal(h.daily.getRange(3,5).getValue(),'');
  assert.equal(h.daily.getRange(3,11).getValue(),false);assert.equal(h.daily.getRange(3,12).getValue(),'NOT SENT');
  assert.equal(h.daily.getRange(3,14).getValue(),'NEEDS UPDATE');
  assert.deepEqual(h.daily.cells.get('3:4').validation.values,['CS_1','Fundamentals','IMPACT_Orange','IMPACT_Blue']);
});

test('project dropdown reads heading-row course columns and multi-row edits invalidate every affected PDF',()=>{
  const h=harness([row(),row('Jack S')]);
  h.c.onEdit({range:h.daily.getRange(3,4,2,1)});
  for(const r of [3,4]){
    assert.equal(h.daily.getRange(r,5).getValue(),'');assert.equal(h.daily.getRange(r,14).getValue(),'NEEDS UPDATE');
    assert.deepEqual(h.daily.cells.get(r+':5').validation.values,['Lvl 4 Build 1','Lvl 4 Build 2']);
  }
  h.daily.getRange(3,5).setValue('Lvl 4 Build 2');h.c.onEdit({range:h.daily.getRange(3,4,1,2)});
  assert.equal(h.daily.getRange(3,5).getValue(),'Lvl 4 Build 2');
});

test('rebuilding Clients processes chronological dates, regardless of tab order',()=>{
  const h=harness();h.daily.name='10-20';h.daily.getRange(3,5).setValue('Lvl 4 Build 2');
  const earlier=new Sheet('10-01',[h.daily.data[0],[],row('Naveed F',{4:'IMPACT_White',5:'Lvl 1 Build 1',9:oldPdf})]);
  h.addSheet(earlier);h.c.reupdateClientsProgress();
  assert.equal(h.clients.getRange(2,5).getValue(),'IMPACT_Orange');
  assert.equal(h.clients.getRange(2,6).getValue(),'Lvl 4 Build 2');assert.equal(h.clients.getRange(2,3).getValue(),folder);
});

test('Code.gs and PDFGenerator.gs load together without duplicate declarations',()=>{
  const c=vm.createContext({});
  vm.runInContext(code,c);vm.runInContext(fs.readFileSync(require.resolve('../PDFGenerator.gs'),'utf8'),c);
  assert.equal(typeof c.onEdit,'function');assert.equal(typeof c.onOpen,'function');assert.equal(typeof c.sendEmails,'function');
});

test('Courses project in A2 is not used as the email subject',()=>{
  const h=harness();h.courses.getRange(2,1).setValue('Storytelling 1: Dialogue');h.c.sendEmails();
  assert.equal(h.sent[0].subject,'Naveed F — IMPACT_Orange Progress Update — October 10, 2026');
});

test('pasted student row preserves explicit belt, project, email and folder URL',()=>{
  const h=harness();h.c.onEdit({range:h.daily.getRange(3,1,1,10)});
  assert.equal(h.daily.getRange(3,4).getValue(),'IMPACT_Orange');
  assert.equal(h.daily.getRange(3,5).getValue(),'Lvl 4 Build 2');
  assert.equal(h.daily.getRange(3,9).getValue(),folder);
  assert.equal(h.daily.getRange(3,11).getValue(),false);
});

test('JR uses its J link or falls back to I, while Fundamentals keeps its non-PDF workflow',()=>{
  for(const jrLink of [jrPdf,'']){
    const h=harness([row('Naveed F',{4:'JR',10:jrLink})]);h.c.sendEmails();
    assert.equal(h.rendered[0].name,'scratchJr');assert.equal(h.rendered[0].jrLink,jrLink||folder);
  }
  const h=harness([row('Naveed F',{4:'Fundamentals',14:''})]);h.c.sendEmails();
  assert.equal(h.sent.length,1);assert.equal(h.rendered[0].name,'cs1AndFundamentals');
});

test('first student on row 2 is sent and saved, matching the original email script',()=>{
  const h=harness();h.daily.data=[h.daily.data[0],row()];
  assert.equal(h.c.sendEmails().sent,1);assert.equal(h.sent.length,1);
  assert.equal(h.daily.getRange(2,12).getValue(),'EMAIL SENT');
  assert.equal(h.clients.getRange(2,3).getValue(),folder);
  assert.match(h.notices[0].message,/1 email\(s\) submitted/);
});

test('email outcomes are visible for skipped rows, validation failures and Mail errors',()=>{
  const h=harness([row('Naveed F',{11:false})]);h.c.sendEmails();
  assert.match(h.notices[0].message,/No emails sent.*Check K.*NOT SENT/);
  const h2=harness([row('Naveed F',{14:'FAILED'})]);
  assert.throws(()=>h2.c.sendEmails(),/Regenerate/);
  assert.equal(h2.notices[0].title,'Email sending stopped');assert.match(h2.notices[0].message,/Row 3/);
  const h3=harness();h3.failSend();assert.throws(()=>h3.c.sendEmails(),/Mail failure/);
  assert.match(h3.notices[0].message,/Mail failure/);
});
