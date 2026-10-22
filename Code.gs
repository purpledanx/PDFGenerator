// Journal and parent-email workflow. Install alongside PDFGenerator.gs (v18+).
const MAX_ROWS = 300;
const DATA_START_ROW = 2; // Clients and Courses data start at row 2.
const JOURNAL_DATA_START_ROW = 2; // Preserve the original journal/email starting row.
const PENDING_MSG = 'NOT SENT';
const COMPLETE_MSG = 'EMAIL SENT';
const BG_COLOR = 'green';

/**
 * andrew.daniels: date in format: "MM-dd"
 * @param {DateTime}  date  A date-time object, can be acquired by using
 *                          ``Date()``
 * @return {string}         A date string in format: "MM-dd"
 */
function getDateMd(date = new Date()) {
  return String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
}
function getDateLong(date = new Date()) {
  return journalMonths_()[date.getMonth()]+' '+date.getDate()+', '+date.getFullYear();
}
function journalMonths_() {
  return ['January','February','March','April','May','June','July','August','September','October','November','December'];
}
function journalIsDateTab_(name) { return /^\d{1,2}-\d{1,2}$/.test(name); }
function journalSessionDate_(sheet) {
  const md=sheet.getName().match(/^(\d{1,2})-(\d{1,2})$/);
  const year=sheet.getParent().getName().match(/\b(20\d{2})\b/);
  if(!md || !year) throw new Error('Use a dated journal tab and a journal filename containing the year.');
  const y=Number(year[1]),m=Number(md[1]),d=Number(md[2]);
  const order=Date.UTC(y,m-1,d),date=new Date(order);
  if(date.getUTCFullYear()!==y || date.getUTCMonth()!==m-1 || date.getUTCDate()!==d)
    throw new Error('Invalid journal date: '+sheet.getName());
  return {order,long:journalMonths_()[m-1]+' '+d+', '+y};
}
function getRow(sheet,rowNumber) { return sheet.getRange(rowNumber,1,1,sheet.getLastColumn()); }
function getCells(sheet,headingName,rowNumber,exactMatch=false) {
  const headerRow=typeof HEADING_ROW==='undefined'?1:HEADING_ROW;
  return getRow(sheet,headerRow).getValues()[0].flatMap((c,i)=>{
    const text=String(c),match=exactMatch?text===headingName:text.toUpperCase().includes(String(headingName).toUpperCase());
    return match?[sheet.getRange(rowNumber,i+1)]:[];
  });
}
function journalNames_(clients) {
  const count=clients.getLastRow()-DATA_START_ROW+1;
  return count>0?clients.getRange(DATA_START_ROW,1,count,1).getValues():[];
}
function journalClientIndex_(name,names) {
  const wanted=String(name).trim();
  const matches=names.map((r,i)=>String(r[0]).trim()===wanted?i:-1).filter(i=>i>=0);
  if(matches.length>1) throw new Error('Duplicate student in Clients: '+wanted);
  return matches.length?matches[0]:-1;
}
function journalLink_(cell) {
  const rich=cell.getRichTextValue();
  if(rich) {
    if(rich.getLinkUrl()) return rich.getLinkUrl();
    for(const run of rich.getRuns()) if(run.getLinkUrl()) return run.getLinkUrl();
  }
  const formula=cell.getFormula();
  const match=formula.match(/HYPERLINK\(\s*"([^"]+)"/i);
  return match?match[1]:String(cell.getValue()||'').trim();
}
function journalProjects_(courses,course) {
  const header=courses.getRange(1,1,1,courses.getLastColumn()).getDisplayValues()[0];
  const col=header.findIndex(value=>String(value).trim().toLowerCase()===String(course).trim().toLowerCase());
  if(col<0) return [];
  const count=Math.min(MAX_ROWS,Math.max(0,courses.getLastRow()-1));
  return count?courses.getRange(2,col+1,count,1).getDisplayValues().map(r=>r[0].trim()).filter(Boolean):[];
}
function journalSetCourseDropdown_(cell,courses) {
  const names=courses.getRange(1,1,1,courses.getLastColumn()).getDisplayValues()[0].map(v=>v.trim()).filter(Boolean);
  cell.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(names,true).build());
}
function journalSetProjectDropdown_(sheet,row,courses) {
  const values=journalProjects_(courses,sheet.getRange(row,4).getDisplayValue());
  const cell=sheet.getRange(row,5);
  if(values.length) cell.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(values,true).build());
  else cell.clearDataValidations();
}
function journalMarkPdfStale_(sheet,row) {
  if(typeof ensurePdfStatusColumn_==='function') ensurePdfStatusColumn_(sheet);
  const header=sheet.getRange(1,14);
  if(!header.getDisplayValue().trim()) {
    const count=sheet.getLastRow()-JOURNAL_DATA_START_ROW+1;
    if(count>0 && sheet.getRange(JOURNAL_DATA_START_ROW,14,count,1).getDisplayValues().some(r=>r[0].trim()))
      throw new Error('Column N has existing data; reserve it for PDF STATUS before using PDF tracking.');
    header.setValue('PDF STATUS');
  }
  if(header.getDisplayValue().trim()!=='PDF STATUS') throw new Error('Column N must be PDF STATUS.');
  sheet.getRange(row,14).setValue('NEEDS UPDATE').setBackground('#fff2cc');
}
function onEdit(e) {
  if(!e || !e.range) return;
  const sheet=e.range.getSheet();
  if(!journalIsDateTab_(sheet.getName())) return;
  const first=e.range.getColumn(),last=e.range.getLastColumn();
  if(![1,4,5,9,10].some(c=>c>=first&&c<=last)) return;
  const ss=sheet.getParent(),courses=ss.getSheetByName('Courses'),clients=ss.getSheetByName('Clients');
  if(!courses || !clients) throw new Error('Missing Courses or Clients tab.');
  const names=first===1?journalNames_(clients):null;
  for(let row=Math.max(JOURNAL_DATA_START_ROW,e.range.getRow());row<=e.range.getLastRow();row++) {
    const name=sheet.getRange(row,1).getDisplayValue().trim();
    if(!name) continue;
    if(first===1) {
      const index=journalClientIndex_(name,names);
      if(index>=0) {
        const clientRow=DATA_START_ROW+index;
        const data=clients.getRange(clientRow,1,1,8).getValues()[0];
        // Keep values explicitly included with a pasted student row.
        for(const [col,value] of [[2,data[4]],[3,data[5]],[6,data[6]],[8,data[1]],
          [9,journalLink_(clients.getRange(clientRow,3))],[10,journalLink_(clients.getRange(clientRow,4))]]) {
          if(col>last) sheet.getRange(row,col).setValue(value);
        }
        sheet.getRange(row,12).setValue(PENDING_MSG);sheet.getRange(row,13).setValue(data[7]);
        sheet.getRange(row,11).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build()).setValue(false);
        journalSetCourseDropdown_(sheet.getRange(row,4),courses);
        // A newly selected name must not inherit another student's current project.
        if(last<4) sheet.getRange(row,4).clearContent();
        if(last<5) sheet.getRange(row,5).clearContent();
      }
    }
    if(first<=4&&last>=4) {
      // Preserve projects explicitly included in a multi-column paste.
      if(last<5) sheet.getRange(row,5).clearContent();
      journalSetProjectDropdown_(sheet,row,courses);
    }
    journalMarkPdfStale_(sheet,row);
  }
}
function confirmSend() {
  const ui=SpreadsheetApp.getUi();
  return ui.alert('Send emails for ready students on the selected journal tab?',ui.ButtonSet.OK_CANCEL)===ui.Button.OK;
}
function getHtmlTemplate(courseName) {
  const levels=[{Name:'JR',Value:'scratchJr'},{Name:'CS_1',Value:'cs1AndFundamentals'},
    {Name:'Fundamentals',Value:'cs1AndFundamentals'},{Name:'IMPACT',Value:'impact'},{Name:'',Value:'belts'}];
  return HtmlService.createTemplateFromFile(levels.find(c=>String(courseName).includes(c.Name)).Value);
}
function saveClientProgressByRow(sheet,rowNumber,names,clients) {
  const index=journalClientIndex_(sheet.getRange(rowNumber,1).getValue(),names);
  if(index<0) return false;
  const target=DATA_START_ROW+index;
  for(const [source,destination] of [[4,5],[5,6],[6,7],[13,8]]) {
    const value=sheet.getRange(rowNumber,source).getValue();
    if(value!=='' && value!==null) clients.getRange(target,destination).setValue(value);
  }
  // Persist PDF/folder URLs so the next session loads the current tracker links.
  for(const [source,destination] of [[9,3],[10,4]]) {
    const link=journalLink_(sheet.getRange(rowNumber,source));
    if(link) clients.getRange(target,destination).setValue(link);
  }
  return true;
}
function saveClientsProgress(sheet,clients) {
  const names=journalNames_(clients);
  for(let row=JOURNAL_DATA_START_ROW;row<=sheet.getLastRow();row++) {
    if(sheet.getRange(row,1).getDisplayValue().trim()) saveClientProgressByRow(sheet,row,names,clients);
  }
}
function reupdateClientsProgress() {
  const lock=LockService.getDocumentLock()||LockService.getScriptLock();lock.waitLock(30000);
  try {
    const ss=SpreadsheetApp.getActiveSpreadsheet(),clients=ss.getSheetByName('Clients');
    if(!clients) throw new Error('Missing Clients tab.');
    // Resolve all dates before writing. Newer session values overwrite older ones.
    const sheets=ss.getSheets().filter(s=>journalIsDateTab_(s.getName()))
      .map(sheet=>({sheet,date:journalSessionDate_(sheet).order})).sort((a,b)=>a.date-b.date);
    for(const item of sheets) saveClientsProgress(item.sheet,clients);
  } finally {lock.releaseLock();}
}
function journalRequiresPdf_(course) {
  return /^(IMPACT_|UNITY_|CS_1$|JR$)/i.test(String(course).trim());
}
function journalEmailSubject_(courses,ninja,level,date) {
  const configured=String(courses.getRange(2,1).getValue()).trim();
  const heading=courses.getRange(1,1).getDisplayValue().trim();
  // In the supplied heading-row Courses layout A2 is a curriculum project,
  // not the legacy subject setting. Keep explicitly configured placeholders.
  const isCurriculum=journalRequiresPdf_(heading) || heading==='Fundamentals';
  const pattern=configured && (!isCurriculum || /<(ninja|level|date)>/.test(configured))
    ?configured:'<ninja> — <level> Progress Update — <date>';
  return pattern.replace(/<ninja>/g,()=>ninja).replace(/<level>/g,()=>level).replace(/<date>/g,()=>date);
}
function sendEmails(confirm=false) {
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  try {
    const result=journalSendEmails_(confirm);
    const message=result.cancelled?'Email sending cancelled.':result.sent?
      result.sent+' email(s) submitted to Google Mail. Column L is now EMAIL SENT.':
      'No emails sent on '+ss.getActiveSheet().getName()+'. Check K (Ready) and L (NOT SENT). Rows marked EMAIL SENT are skipped.';
    ss.toast(message,'Parent emails',12);
    console.log(message);
    return result;
  } catch(error) {
    ss.toast(String(error.message||error).slice(0,1200),'Email sending stopped',20);
    console.error(String(error.message||error));
    throw error;
  }
}
function journalSendEmails_(confirm=false) {
  if(confirm && !confirmSend()) return {sent:0,cancelled:true};
  const lock=LockService.getDocumentLock()||LockService.getScriptLock();lock.waitLock(30000);
  try {
    const ss=SpreadsheetApp.getActiveSpreadsheet(),sheet=ss.getActiveSheet();
    const session=journalSessionDate_(sheet);
    const courses=ss.getSheetByName('Courses'),clients=ss.getSheetByName('Clients');
    if(!courses || !clients) throw new Error('Missing Courses or Clients tab.');
    const names=journalNames_(clients),pending=[],errors=[];
    // Preflight every ready row and render every email before sending any email.
    for(let row=JOURNAL_DATA_START_ROW;row<=sheet.getLastRow();row++) {
      if(sheet.getRange(row,12).getValue()!==PENDING_MSG || sheet.getRange(row,11).getValue()!==true) continue;
      const ninja=sheet.getRange(row,1).getDisplayValue().trim();
      const level=sheet.getRange(row,4).getDisplayValue().trim();
      const project=sheet.getRange(row,5).getDisplayValue().trim();
      const email=sheet.getRange(row,8).getDisplayValue().trim();
      const trackerLink=journalLink_(sheet.getRange(row,9)),jrLink=journalLink_(sheet.getRange(row,10));
      try {
        if(!ninja || !level || !project || !email) throw new Error('Missing student, current belt/project, or parent email.');
        if(journalClientIndex_(ninja,names)<0) throw new Error('Student is not in Clients.');
        if(journalRequiresPdf_(level)) {
          if(sheet.getRange(1,14).getDisplayValue().trim()!=='PDF STATUS' ||
             sheet.getRange(row,14).getDisplayValue().trim()!=='PDF UPDATED')
            throw new Error('Regenerate the tracker first: PDF STATUS must be PDF UPDATED.');
        }
        const link=level==='JR'?(jrLink||trackerLink):trackerLink;
        if(!/^https:\/\/drive\.google\.com\//i.test(link)) throw new Error('Missing or invalid Google Drive tracker/folder URL.');
        const template=getHtmlTemplate(level);template.trackerLink=trackerLink;
        template.jrLink=level==='JR'?(jrLink||trackerLink):jrLink;
        const subject=journalEmailSubject_(courses,ninja,level,session.long);
        pending.push({row,email,subject,body:template.evaluate().getContent()});
      } catch(error) {errors.push('Row '+row+' ('+ninja+'): '+error.message);}
    }
    if(errors.length) throw new Error('No emails sent. Fix these rows first:\n'+errors.join('\n'));
    let sent=0;
    for(const item of pending) {
      MailApp.sendEmail({to:item.email,subject:item.subject,htmlBody:item.body});
      // Record success immediately so a later Clients write failure cannot resend it.
      sheet.getRange(item.row,12).setValue(COMPLETE_MSG).setBackground(BG_COLOR);
      sent++;
      saveClientProgressByRow(sheet,item.row,names,clients);
    }
    return {sent,cancelled:false};
  } finally {lock.releaseLock();}
}
