/* THE SAME LINE, FOR THE SAME REASON. Not optional -- see RUN-ME-001's own note on this. */
set search_path = hopeloan, public;

/* =====================================================================================
   KYC CAPTURE AUDIT -- WHICH CAMERA TOOK IT.
   =====================================================================================
   "We now have a setback officers are using Ai photos so this comes as ronaldo" -- a field
   officer substituting a fake photo (a celebrity image, an AI render) for the live capture
   this screen deliberately only allows from the phone's own camera (no gallery picker --
   see openCameraOverlay_ in app.html). A genuine hardware camera and a virtual-camera app
   both answer getUserMedia() the same way from the page's point of view -- there is no way
   to tell them apart from inside the browser. What the browser DOES hand back is the
   device's own label for whichever camera answered ("back camera", but a spoofing app
   answers with ITS OWN name -- "Virtual Camera", "DroidCam", "IP Webcam", and the like).

   This is audit-only, on purpose: a label is not proof, an honest phone can have an odd
   camera name, and a screen that refuses to work over a string match is a screen that goes
   down in the field the first time it is wrong. What it buys is a trail -- every capture
   says which camera answered, so a suspicious one can be found and the officer who made it
   asked directly, the same as any other figure in this system that traces back to a name. */
create table if not exists kyc_captures (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid references loans(id),
  at timestamptz not null default now(),
  kind text,                                   -- 'photo' | 'signature' | 'thumbprint' | 'residence_verify' | 'business_verify' ...
  path text,                                    -- the storage path this capture landed at
  camera_label text,                            -- MediaStreamTrack.label, exactly as the browser reported it
  actor text, actor_role text                   -- who was signed in when it was taken
);
create index if not exists idx_kyc_captures_loan on kyc_captures(loan_id, at desc);
