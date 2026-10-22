# PDFGenerator

Google Apps Script updater for existing student tracker PDFs. `PDFGenerator.gs`
contains the supplied script with progress reconciliation fixes.

## Apply the fix

In the journal's Apps Script project, replace the existing PDFGenerator script
with `PDFGenerator.gs`. Keep the journal's separate `Code.gs` unchanged. Replace
the old generator file rather than adding a second copy with duplicate functions
and constants. Save, then reload the spreadsheet.

Set the student's program in column D and current project in E. Use
**Tracker PDFs → Generate / Update Tracker** to update the PDF linked in I
(or J for Scratch Jr). Changing E alone marks the tracker as needing an update;
it does not automatically rewrite the PDF. Existing backup and undo behavior
remains available.

The popup title should show **v18** after replacing the script and reloading the
sheet. Column D chooses the template; column E chooses the project.

## Belt changes and history folders

For a direct PDF link, a different belt in column D loads that belt's verified
blank template, fills it, and replaces the existing file's contents and filename.
The Drive ID and link stay the same. The old PDF is backed up first. Undo restores
both its previous contents and filename. This also supports switching to an
earlier belt; it does not assume students always advance in belt order.

For the selected student, check **Level-up: keep previous trackers in a folder**
to preserve history instead. When the linked PDF is a different belt, the script
creates a student folder alongside the old PDF (or in My Drive if no parent is
available), copies the old tracker into it, and adds the filled new belt PDF.
The original old PDF stays intact. Column I (J for Scratch Jr when used) changes
to the folder URL. Undo removes the generated files and restores the prior link.

If I/J already links to a folder, previous belt PDFs remain there automatically.
The script updates the PDF matching column D, or adds it from its template if
that belt is missing. It does not create another copy when that belt already
exists. Multiple matching PDFs are reported as ambiguous. Folder mode is chosen
per selected student; day batches use existing folders automatically and replace
mismatched direct PDF links using backups.

The script verifies the student's name before replacing a different belt PDF.
It validates the filled result before uploading or creating files. It never
overwrites a configured blank template. A folder you create must be accessible
to the intended parents; the generator does not change sharing permissions.

## Email links

The supplied `sendEmails` function puts column I into `levelTemplate.trackerLink`
and J into `levelTemplate.jrLink`. It sends an HTML email without attachments.
With a folder URL, the tracker link opens that folder, where parents can select
the current or earlier belts. It does not automatically select or attach a PDF.
The HTML template must use these properties as its links.

To support plain URLs, HYPERLINK formulas, and linked cell labels, replace these
two assignments inside your existing `sendEmails` function:

```js
const trackerLink = getLink_(monthDay.getRange(i, TRACKER_COL));
const jrLink = getLink_(monthDay.getRange(i, JR_TRACKER_COL));
```

`getLink_` is provided in `PDFGenerator.gs` in the same Apps Script project. Leave
the rest of `sendEmails` unchanged. Generating PDFs does not send emails or reset
an EMAIL SENT status. Your existing ready/pending checks still control sending.
No email has been sent as part of this change.

Blue numbered Solve projects map directly to the printed wrench fields, regardless
of Courses list order. Earlier activities become C and earlier levels receive L.
Later IMPACT C/W/R/L markers are cleared to match the journal project; explicit S
skips remain. Dropdowns without blank options can also be cleared. Quest level-up
still requires approval. Moving the journal project backwards resets later progress,
so use Undo Last PDF Update to restore the prior tracker if needed.

## Local checks

Use Node.js 24 and run from this directory:

```sh
npm ci --cache /tmp/pdfgenerator-npm-cache --no-audit --no-fund
npm test
```

The tests create editable PDF fixtures with pdf-lib 1.17.1, move projects forward
and backward, and save/reopen PDFs to check marker values and visible appearance
streams. No local server is required. Live spreadsheet, Drive, and undo operations
must be checked in the authorized Google Apps Script runtime; these tests do not
connect to Google or modify student PDFs.
