/* EVERY PNG AND JPEG IN THE PACKAGE.  node brand/build-raster.mjs
   Sizes chosen for where each file actually goes, not as round numbers for their own sake. */
import { png, jpg } from './render.mjs';
const made = [];
const P = (...a) => made.push('png/' + png(...a));
const J = (...a) => made.push('jpg/' + jpg(...a));

/* THE LOCKUP. 2400 is a banner and a roll-up; 1200 an email signature or a letterhead; 600 a
   slide; 300 the smallest anybody should set the full lockup, below which the word closes up. */
for (const w of [2400, 1200, 600, 300]) {
  P('logo-horizontal.svg', w, `samaritantechs-logo-${w}.png`);
  P('logo-horizontal-on-navy.svg', w, `samaritantechs-logo-on-navy-${w}.png`);
}
P('logo-horizontal-white.svg', 2400, 'samaritantechs-logo-white-2400.png');
P('logo-stacked.svg', 1200, 'samaritantechs-logo-stacked-1200.png');
P('logo-stacked.svg', 600,  'samaritantechs-logo-stacked-600.png');
P('logo-stacked-white.svg', 1200, 'samaritantechs-logo-stacked-white-1200.png');

/* THE MARK ALONE, down to the sizes where it has to survive on its own. */
for (const w of [1024, 512, 256, 128, 64, 32]) P('mark.svg', w, `samaritantechs-mark-${w}.png`);
P('mark-white.svg', 1024, 'samaritantechs-mark-white-1024.png');
P('mark-black.svg', 1024, 'samaritantechs-mark-black-1024.png');

/* PROFILE PICTURES. 1000 is above every platform's requirement, so one file serves WhatsApp
   Business, LinkedIn, Facebook, X and Google. The 400 is for anything that refuses a big one. */
P('profile.svg', 1000, 'samaritantechs-profile-1000.png');
P('profile.svg', 400,  'samaritantechs-profile-400.png');
P('profile-light.svg', 1000, 'samaritantechs-profile-light-1000.png');

/* FAVICON AND APP TILE. 512 for the web manifest, 192 for Android, then the small ones. */
for (const w of [512, 192, 180, 64, 32, 16]) P('icon.svg', w, `favicon-${w}.png`);

/* JPEG, for the places that refuse a PNG -- some print shops, some older Office templates, and
   every "upload your logo" form that checks the extension rather than the file. White ground
   stated explicitly: see the note in render.mjs. */
J('logo-horizontal.svg', 2400, 'samaritantechs-logo-2400.jpg');
J('logo-horizontal.svg', 1200, 'samaritantechs-logo-1200.jpg');
J('logo-horizontal-on-navy.svg', 2400, 'samaritantechs-logo-on-navy-2400.jpg', '#0B2A6B');
J('logo-stacked.svg', 1200, 'samaritantechs-logo-stacked-1200.jpg');
J('profile.svg', 1000, 'samaritantechs-profile-1000.jpg', '#0B2A6B');
J('mark.svg', 1024, 'samaritantechs-mark-1024.jpg');

console.log(made.length + ' raster files');
console.log(made.join('\n'));
