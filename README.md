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

The fix removes obsolete W/R markers in later IMPACT levels, supports clearing
dropdowns without a blank option, and refreshes preceding C/L appearances.
Recorded C/S/L history remains preserved. Current-level quest approval behavior
is unchanged.

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
