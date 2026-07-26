import fs from 'node:fs';
import path from 'node:path';
import { withApi } from './_lib/auth.js';

// GET /api/app-version
// What the installed Android app polls on every launch to decide whether to update itself.
// The numbers come from app-version.json at the repo root -- the SAME file android/app/
// build.gradle reads at build time, so the app's own versionCode and the one advertised here
// can never drift apart (a mismatch would mean phones either update in a loop or never).
//
// No access code required: an out-of-date app must be able to ask before anyone signs in.
let cached = null;
export default withApi(async (req, res) => {
  if (!cached) {
    // Vercel bundles files the function references; process.cwd() is the project root there.
    const p = path.join(process.cwd(), 'app-version.json');
    cached = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return { ...cached };
});
