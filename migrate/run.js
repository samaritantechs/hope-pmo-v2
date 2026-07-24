// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node migrate/run.js <csv-file> <sheet-type> [extra-args...]
//
// Examples:
//   node migrate/run.js "Defaulters Current - Wednesday.csv" defaulters-current WED 2026-07-22
//   node migrate/run.js "Expected Monday.csv" expected-today 2026-07-20
//   node migrate/run.js "Approved (Processed).csv" loans approved
//   node migrate/run.js "Defaulters Followup.csv" followup
//   node migrate/run.js "Comments Log.csv" comments
//   node migrate/run.js "Leaders.csv" teams
//   node migrate/run.js "Received Payments.csv" received
//
// Each run is one file -> one table. This is intentionally simple and inspectable rather
// than one big "migrate everything" script -- for a first migration of live financial
// data, being able to run one sheet, check the row count and a few rows in the Supabase
// table editor, THEN move to the next sheet is worth more than speed. See MIGRATION.md
// for the full run order across all ~29 Expected/Defaulters day-keyed tabs.

import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { supabase, insertBatched } from './lib/supabase.js';
import {
  importDefaulters, importExpected, importFollowup, importComments,
  importLoans, importTeams, importReceivedPayments,
} from './importers.js';

const [, , file, type, ...extra] = process.argv;

if (!file || !type) {
  console.error('Usage: node migrate/run.js <csv-file> <sheet-type> [extra-args...]');
  console.error('See the comment at the top of this file for examples per sheet type.');
  process.exit(1);
}

const csvText = fs.readFileSync(file, 'utf8');
const rows = parse(csvText, { skip_empty_lines: false, relax_column_count: true });

let table, records;

switch (type) {
  case 'defaulters-initial':
  case 'defaulters-current': {
    const [weekday, snapshotDate] = extra;
    if (!weekday || !snapshotDate) throw new Error('Need: <weekday MON-SUN> <snapshot-date yyyy-mm-dd>');
    table = 'defaulter_snapshots';
    records = importDefaulters(rows, { snapshotType: type === 'defaulters-initial' ? 'initial' : 'current', weekday, snapshotDate });
    break;
  }
  case 'expected-today':
  case 'expected-tomorrow':
  case 'expected-yesterday':
  case 'expected-initial': {
    const [snapshotDate] = extra;
    if (!snapshotDate) throw new Error('Need: <snapshot-date yyyy-mm-dd>');
    table = 'repayment_snapshots';
    records = importExpected(rows, { snapshotType: type.replace('expected-', ''), snapshotDate });
    break;
  }
  case 'followup':
    table = 'followup_status';
    records = importFollowup(rows);
    break;
  case 'comments':
    table = 'followup_comments';
    records = importComments(rows);
    break;
  case 'loans': {
    const [stage] = extra;
    if (!stage) throw new Error('Need: <stage> e.g. unassigned/assigned/unassessed/assessed/pending_approval/approved/pending_disb/disbursed');
    table = 'loans';
    records = importLoans(rows, stage);
    break;
  }
  case 'teams':
    table = 'teams';
    records = importTeams(rows);
    break;
  case 'received':
    table = 'received_payments';
    records = importReceivedPayments(rows);
    break;
  default:
    console.error(`Unknown sheet type "${type}". See the top of this file for the supported list.`);
    process.exit(1);
}

if (!records.length) {
  console.log('No rows to import (file was empty, or every row was missing its key field).');
  process.exit(0);
}

console.log(`Parsed ${records.length} rows from ${file} -> ${table}`);
const n = await insertBatched(table, records);
console.log(`Done. Inserted ${n} rows into ${table}.`);

const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
console.log(`${table} now has ${count} total rows.`);
