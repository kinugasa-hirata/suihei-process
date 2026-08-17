// One-off cleanup script.
// Finds inspection records that are part of a run of 4+ CONSECUTIVE file
// numbers sharing the exact same weight value — the signature of the old
// bad import (an Excel drag-fill/copy-paste mistake stamped one value across
// many rows). Real measurements vary by tenths of a gram between parts, so a
// long run of identical values is not a plausible real reading.
// Clears weight back to null on those records so they show as unmeasured
// again until a real measurement is imported.
//
// Usage:
//   node cleanup_corrupted_weights.js         # dry run, just prints what it would change
//   node cleanup_corrupted_weights.js --apply # actually clears the weight field

require('dotenv').config();
const { Client, Databases, Query } = require('node-appwrite');

const client = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1")
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const databases = new Databases(client);
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;
const COLLECTION_INSPECTIONS = process.env.APPWRITE_COLLECTION_INSPECTIONS_ID;

const APPLY = process.argv.includes('--apply');

async function main() {
  const all = [];
  let lastId = null;
  while (true) {
    const queries = [Query.orderAsc('$id'), Query.limit(100)];
    if (lastId) queries.push(Query.cursorAfter(lastId));
    const page = await databases.listDocuments(DATABASE_ID, COLLECTION_INSPECTIONS, queries);
    all.push(...page.documents);
    if (page.documents.length < 100) break;
    lastId = page.documents[page.documents.length - 1].$id;
  }

  // Sort by numeric file number
  const withNum = all
    .filter(doc => doc.weight !== null && doc.weight !== undefined && doc.filename)
    .map(doc => ({ doc, fileNum: parseFloat(String(doc.filename).replace(/\.txt$/i, '')) }))
    .filter(x => !isNaN(x.fileNum))
    .sort((a, b) => a.fileNum - b.fileNum);

  // Find runs of consecutive (by sort order) records sharing the exact same weight.
  // A real measurement run of 4+ identical values back-to-back is essentially
  // impossible for this process (weights vary by tenths of a gram between
  // parts) — this is the actual signature of the fill/copy-paste mistake,
  // not just "weight equals its own file number".
  const MIN_RUN_LENGTH = 4;
  const suspects = [];
  let i = 0;
  while (i < withNum.length) {
    let j = i;
    while (j + 1 < withNum.length && parseFloat(withNum[j + 1].doc.weight) === parseFloat(withNum[i].doc.weight)) {
      j++;
    }
    const runLength = j - i + 1;
    if (runLength >= MIN_RUN_LENGTH) {
      for (let k = i; k <= j; k++) suspects.push(withNum[k].doc);
    }
    i = j + 1;
  }

  console.log(`Found ${suspects.length} suspicious records (part of a run of ${MIN_RUN_LENGTH}+ identical consecutive weights):`);
  suspects.forEach(d => console.log(`  ${d.filename}  weight=${d.weight}  status=${d.status}`));

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to actually clear these weight fields.');
    return;
  }

  let cleared = 0;
  for (const doc of suspects) {
    const updateData = { weight: null };
    // Only roll status back if it's still sitting at 'finished_inspection'
    // (the state the bad import promoted it to). If something else already
    // changed the status since, leave it alone.
    if (doc.status === 'finished_inspection') {
      updateData.status = 'inspection';
    }
    await databases.updateDocument(DATABASE_ID, COLLECTION_INSPECTIONS, doc.$id, updateData);
    cleared++;
  }
  console.log(`\nCleared weight on ${cleared} records (status reset to 'inspection' where it was 'finished_inspection').`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});